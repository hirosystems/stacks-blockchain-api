import supertest from 'supertest';
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { STACKS_TESTNET } from '@stacks/network';
import { Pox5EventName } from '@stacks/codec';
import { ApiServer, startApiServer } from '../../../src/api/init.ts';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { migrate } from '../../test-helpers.ts';
import { TestBlockBuilder } from '../test-builders.ts';

/**
 * pox-5 bond event log (`GET /extended/v3/staking/bonds/:bond_index/events`) — simulated ingestion
 * tests. Builds blocks with `TestBlockBuilder`, attaches the full bond lifecycle as synthetic pox-5
 * events (all eight bond-scoped event types), and asserts the event log endpoint: canonical
 * newest-first ordering, the curated payload shapes (v3 vocabulary, `bond_index` hoisted to the
 * envelope, L1 lockup outputs summarized as a count), exclusion of null-`bond_index` events,
 * cursor pagination, and the reorg behavior of the materialized `bonds.event_count` total.
 */

const ADMIN = 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP';
const ALICE = 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6';
const BOB = 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y';
const SIGNER = `${ADMIN}.signer-manager`;
const NEW_SIGNER = `${ADMIN}.signer-manager-2`;

const SETUP_TX_ID = '0x' + '11'.repeat(32);
const REGISTER_TX_ID = '0x' + '22'.repeat(32);
const REGISTER_L1_TX_ID = '0x' + '33'.repeat(32);
const CYCLE_TX_ID = '0x' + '44'.repeat(32);
const EARLY_EXIT_TX_ID = '0x' + '55'.repeat(32);

const BOND_INDEX = 0;

const SETUP_BOND_DATA = {
  bond_index: String(BOND_INDEX),
  target_rate: '300',
  stx_value_ratio: '10000000',
  min_ustx_ratio: '1000',
  early_unlock_bytes: '',
  first_reward_cycle: '8',
  bond_start_height: '160',
  unlock_cycle: '20',
  unlock_burn_height: '410',
};

// Alice locks sBTC (an L2 lockup).
const REGISTER_L2_DATA = {
  bond_index: String(BOND_INDEX),
  signer: SIGNER,
  staker: ALICE,
  amount_ustx: '10000000',
  sats_total: '1000',
  first_reward_cycle: '8',
  unlock_burn_height: '410',
  unlock_cycle: '20',
  is_l1_lock: false,
  btc_lockup: { type: 'l2', txs: null },
};

// Bob proves two L1 lockup outputs: the event log must summarize them as a
// count instead of embedding the (unbounded) output list.
const REGISTER_L1_DATA = {
  bond_index: String(BOND_INDEX),
  signer: SIGNER,
  staker: BOB,
  amount_ustx: '20000000',
  sats_total: '2000',
  first_reward_cycle: '8',
  unlock_burn_height: '410',
  unlock_cycle: '20',
  is_l1_lock: true,
  btc_lockup: {
    type: 'l1',
    txs: [
      { txid: '0x' + 'aa'.repeat(32), output_index: '0' },
      { txid: '0x' + 'bb'.repeat(32), output_index: '1' },
    ],
  },
};

const UNSTAKE_SBTC_DATA = {
  bond_index: String(BOND_INDEX),
  staker: ALICE,
  signer: SIGNER,
  amount_withdrawn_sats: '400',
  new_amount_sats: '600',
};

const UPDATE_REGISTRATION_DATA = {
  bond_index: String(BOND_INDEX),
  staker: ALICE,
  signer: NEW_SIGNER,
  old_signer: SIGNER,
  amount_ustx: '9000000',
  amount_sats: '900',
  first_reward_cycle: '8',
  num_cycles: '12',
  is_l1_lock: false,
};

const DISTRIBUTION_DATA = {
  bond_index: String(BOND_INDEX),
  target_yield: '123',
  bond_rewards: '100',
  bond_staked_sats: '1600',
  accrued_rewards_per_sat: '62500000000000000',
  cumulative_rewards_per_sat: '62500000000000000',
};

const BOND_CLAIM_DATA = {
  signer_manager: SIGNER,
  staker: ALICE,
  reward_cycle: '9',
  bond_index: String(BOND_INDEX),
  rewards_claimed: '40',
};

const EARLY_EXIT_DATA = {
  bond_index: String(BOND_INDEX),
  staker: BOB,
  signer: SIGNER,
  amount_sats_released: '2000',
};

// A staker reward claim with a JSON-null bond_index (an STX-only staking claim):
// must NOT appear in the bond's event log or count toward its total.
const NULL_BOND_CLAIM_DATA = {
  signer_manager: SIGNER,
  staker: ALICE,
  reward_cycle: '9',
  bond_index: null,
  rewards_claimed: '50',
};

interface BondEventItem {
  name: string;
  bond_index: number;
  transaction: { tx_id: string; event_index: number };
  block: { height: number; hash: string; index_hash: string; time: number; tx_index: number };
  bitcoin_block: { height: number; time: number };
  data: Record<string, unknown>;
}
interface BondEventsPage {
  limit: number;
  total: number;
  cursor: { next: string | null; previous: string | null; current: string | null };
  results: BondEventItem[];
}

// Full expected log, newest first (block 3, then block 2's single tx by
// event_index DESC, then block 1's txs by tx_index / event_index DESC).
const EXPECTED_EVENT_ORDER = [
  Pox5EventName.AnnounceL1EarlyExit,
  Pox5EventName.ClaimStakerRewardsForSigner,
  Pox5EventName.BondDistribution,
  Pox5EventName.UpdateBondRegistration,
  Pox5EventName.UnstakeSbtc,
  Pox5EventName.RegisterForBond, // Bob, L1
  Pox5EventName.RegisterForBond, // Alice, L2
  Pox5EventName.AddToAllowlist, // Bob
  Pox5EventName.AddToAllowlist, // Alice
  Pox5EventName.SetupBond,
];

const EVENTS_PATH = `/extended/v3/staking/bonds/${BOND_INDEX}/events`;
const CURSOR_PATTERN = /^\d+:\d+:\d+:\d+$/;

const normalizeTxId = (txid: string) => txid.replace(/^0x/, '').toLowerCase();

describe('pox-5 bond events', () => {
  let db: PgWriteStore;
  let api: ApiServer;

  async function getJson<T>(path: string): Promise<T> {
    const res = await supertest(api.server).get(path);
    assert.equal(res.status, 200, `GET ${path} -> ${res.status}: ${res.text}`);
    assert.equal(res.type, 'application/json');
    return JSON.parse(res.text) as T;
  }

  /**
   * Ingests the shared three-block scenario:
   * - block 1 (`0x01`): setup-bond + 2× add-to-allowlist (setup tx), Alice's L2
   *   register-for-bond, Bob's L1 register-for-bond — 5 bond events.
   * - block 2 (`0x02`): a partial unstake-sbtc, an update-bond-registration, a
   *   bond-distribution, a bond staker reward claim, plus a null-bond_index
   *   claim-staker-rewards-for-signer — 4 bond events.
   * - block 3 (`0xa3`, "fork A"): announce-l1-early-exit — 1 bond event.
   */
  async function ingestScenario() {
    await db.update(
      new TestBlockBuilder({ block_height: 1, block_hash: '0x01', index_block_hash: '0x01' })
        .addTx({ tx_id: SETUP_TX_ID })
        .addTxPox5Event({ name: Pox5EventName.SetupBond, data: SETUP_BOND_DATA })
        .addTxPox5Event({
          name: Pox5EventName.AddToAllowlist,
          data: { bond_index: String(BOND_INDEX), staker: ALICE, max_sats: '100000000' },
        })
        .addTxPox5Event({
          name: Pox5EventName.AddToAllowlist,
          data: { bond_index: String(BOND_INDEX), staker: BOB, max_sats: '5000000' },
        })
        .addTx({ tx_id: REGISTER_TX_ID })
        .addTxPox5Event({ name: Pox5EventName.RegisterForBond, data: REGISTER_L2_DATA })
        .addTx({ tx_id: REGISTER_L1_TX_ID })
        .addTxPox5Event({ name: Pox5EventName.RegisterForBond, data: REGISTER_L1_DATA })
        .build()
    );
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        block_hash: '0x02',
        index_block_hash: '0x02',
        parent_block_hash: '0x01',
        parent_index_block_hash: '0x01',
      })
        .addTx({ tx_id: CYCLE_TX_ID })
        .addTxPox5Event({ name: Pox5EventName.UnstakeSbtc, data: UNSTAKE_SBTC_DATA })
        .addTxPox5Event({
          name: Pox5EventName.UpdateBondRegistration,
          data: UPDATE_REGISTRATION_DATA,
        })
        .addTxPox5Event({ name: Pox5EventName.BondDistribution, data: DISTRIBUTION_DATA })
        .addTxPox5Event({
          name: Pox5EventName.ClaimStakerRewardsForSigner,
          data: BOND_CLAIM_DATA,
        })
        .addTxPox5Event({
          name: Pox5EventName.ClaimStakerRewardsForSigner,
          data: NULL_BOND_CLAIM_DATA,
        })
        .build()
    );
    await db.update(
      new TestBlockBuilder({
        block_height: 3,
        block_hash: '0xa3',
        index_block_hash: '0xa3',
        parent_block_hash: '0x02',
        parent_index_block_hash: '0x02',
      })
        .addTx({ tx_id: EARLY_EXIT_TX_ID })
        .addTxPox5Event({ name: Pox5EventName.AnnounceL1EarlyExit, data: EARLY_EXIT_DATA })
        .build()
    );
  }

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    api = await startApiServer({ datastore: db, chainId: STACKS_TESTNET.chainId });
    await ingestScenario();
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await migrate('down');
  });

  test('lists the full bond event log newest first, excluding null-bond_index events', async () => {
    const page = await getJson<BondEventsPage>(`${EVENTS_PATH}?limit=50`);
    assert.equal(page.total, 10, 'total reflects the materialized event_count');
    assert.deepEqual(
      page.results.map(r => r.name),
      EXPECTED_EVENT_ORDER,
      'canonical newest-first event order'
    );
    // The null-bond_index staker reward claim is not part of the bond's log.
    assert.equal(
      page.results.filter(r => r.name === Pox5EventName.ClaimStakerRewardsForSigner).length,
      1,
      'only the bond-scoped reward claim listed; the STX-only claim excluded'
    );
    for (const result of page.results) {
      assert.equal(result.bond_index, BOND_INDEX, 'bond_index hoisted to the envelope');
      assert.ok(!('bond_index' in result.data), 'bond_index not repeated inside the payload');
    }
  });

  test('payloads are curated into the v3 vocabulary', async () => {
    const page = await getJson<BondEventsPage>(`${EVENTS_PATH}?limit=50`);
    const [earlyExit, claim, distribution, update, unstake, registerL1, registerL2, , , setup] =
      page.results;

    assert.equal(earlyExit.name, Pox5EventName.AnnounceL1EarlyExit);
    assert.equal(normalizeTxId(earlyExit.transaction.tx_id), normalizeTxId(EARLY_EXIT_TX_ID));
    assert.equal(earlyExit.block.height, 3);
    assert.deepEqual(earlyExit.data, {
      staker: BOB,
      signer: SIGNER,
      released: { btc: '2000' },
    });

    assert.deepEqual(claim.data, {
      signer_manager: SIGNER,
      staker: ALICE,
      reward_cycle: 9,
      claimed: { btc: '40' },
    });

    assert.deepEqual(distribution.data, {
      target_yield: '123',
      rewards: { btc: '100' },
      staked: { btc: '1600' },
      accrued_rewards_per_sat: '62500000000000000',
      cumulative_rewards_per_sat: '62500000000000000',
    });

    assert.deepEqual(update.data, {
      staker: ALICE,
      signer: NEW_SIGNER,
      old_signer: SIGNER,
      type: 'l2',
      balances: { btc: '900', stx: '9000000' },
    });

    assert.equal(normalizeTxId(unstake.transaction.tx_id), normalizeTxId(CYCLE_TX_ID));
    assert.equal(unstake.block.height, 2);
    assert.deepEqual(unstake.data, {
      staker: ALICE,
      signer: SIGNER,
      withdrawn: { btc: '400' },
      remaining: { btc: '600' },
    });

    // Bob's L1 registration: the registration summary shape only — the proven
    // output list stays on the registration detail endpoint, never in the log.
    assert.equal(normalizeTxId(registerL1.transaction.tx_id), normalizeTxId(REGISTER_L1_TX_ID));
    assert.deepEqual(registerL1.data, {
      staker: BOB,
      signer: SIGNER,
      type: 'l1',
      balances: { btc: '2000', stx: '20000000' },
    });

    assert.equal(normalizeTxId(registerL2.transaction.tx_id), normalizeTxId(REGISTER_TX_ID));
    assert.deepEqual(registerL2.data, {
      staker: ALICE,
      signer: SIGNER,
      type: 'l2',
      balances: { btc: '1000', stx: '10000000' },
    });

    assert.equal(normalizeTxId(setup.transaction.tx_id), normalizeTxId(SETUP_TX_ID));
    assert.equal(setup.block.height, 1);
    assert.deepEqual(setup.data, {
      parameters: {
        target_rate_bps: 300,
        stx_value_ratio: 10000000,
        minimum_stx_ratio: 1000,
      },
      early_unlock_bytes: '',
      schedule: {
        activation: { bitcoin_height: 160, pox_cycle: 8 },
        unlock: { bitcoin_height: 410, pox_cycle: 20 },
      },
    });
  });

  test('paginates with event position cursors', async () => {
    // Walk the whole log two events at a time and check it reassembles exactly.
    const collected: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const cursorParam: string = cursor ? `&cursor=${cursor}` : '';
      const page: BondEventsPage = await getJson<BondEventsPage>(
        `${EVENTS_PATH}?limit=2${cursorParam}`
      );
      assert.equal(page.total, 10);
      assert.ok(page.results.length > 0 && page.results.length <= 2);
      if (page.cursor.current) assert.match(page.cursor.current, CURSOR_PATTERN);
      collected.push(...page.results.map(r => r.name));
      cursor = page.cursor.next;
      pages++;
    } while (cursor !== null);
    assert.equal(pages, 5, 'ten events over five pages of two');
    assert.deepEqual(collected, EXPECTED_EVENT_ORDER, 'pages reassemble the full log');

    // The previous cursor from the second page leads back to the top page.
    const page1 = await getJson<BondEventsPage>(`${EVENTS_PATH}?limit=2`);
    assert.equal(page1.cursor.previous, null, 'no previous page at the top');
    const page2 = await getJson<BondEventsPage>(
      `${EVENTS_PATH}?limit=2&cursor=${page1.cursor.next}`
    );
    assert.ok(page2.cursor.previous, 'second page links back');
    const backToTop = await getJson<BondEventsPage>(
      `${EVENTS_PATH}?limit=2&cursor=${page2.cursor.previous}`
    );
    assert.deepEqual(
      backToTop.results.map(r => r.name),
      EXPECTED_EVENT_ORDER.slice(0, 2)
    );
  });

  test('an unknown bond returns an empty log', async () => {
    const page = await getJson<BondEventsPage>(`/extended/v3/staking/bonds/99/events?limit=50`);
    assert.equal(page.total, 0);
    assert.equal(page.results.length, 0);
  });

  test('a reorg reverts the event log and the event_count total, and a restore reapplies them', async () => {
    // Fork B overtakes fork A's block 3 (the early exit) with two empty blocks.
    await db.update(
      new TestBlockBuilder({
        block_height: 3,
        block_hash: '0xb3',
        index_block_hash: '0xb3',
        parent_block_hash: '0x02',
        parent_index_block_hash: '0x02',
      }).build()
    );
    await db.update(
      new TestBlockBuilder({
        block_height: 4,
        block_hash: '0xb4',
        index_block_hash: '0xb4',
        parent_block_hash: '0xb3',
        parent_index_block_hash: '0xb3',
      }).build()
    );

    const orphaned = await getJson<BondEventsPage>(`${EVENTS_PATH}?limit=50`);
    assert.equal(orphaned.total, 9, 'event_count decremented for the orphaned block');
    assert.equal(orphaned.results.length, 9);
    assert.ok(
      !orphaned.results.some(r => r.name === Pox5EventName.AnnounceL1EarlyExit),
      'orphaned early exit gone from the log'
    );

    // Fork A wins again (extends past fork B) — the early exit is restored.
    await db.update(
      new TestBlockBuilder({
        block_height: 4,
        block_hash: '0xa4',
        index_block_hash: '0xa4',
        parent_block_hash: '0xa3',
        parent_index_block_hash: '0xa3',
      }).build()
    );
    await db.update(
      new TestBlockBuilder({
        block_height: 5,
        block_hash: '0xa5',
        index_block_hash: '0xa5',
        parent_block_hash: '0xa4',
        parent_index_block_hash: '0xa4',
      }).build()
    );

    const restored = await getJson<BondEventsPage>(`${EVENTS_PATH}?limit=50`);
    assert.equal(restored.total, 10, 'event_count restored with the fork');
    assert.equal(restored.results[0].name, Pox5EventName.AnnounceL1EarlyExit);
  });
});
