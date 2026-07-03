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
 * GET /extended/v3/staking/signers/{principal}/stakers — the stakers that
 * belong to a signer, unioned across pox-5 STX staking (`stake` events →
 * `stx_locked_balances.signer`) and bond staking (`register-for-bond` events →
 * `bond_registrations.signer`), deduplicated with a per-staking-type flag.
 */

const SIGNER_A = 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP.signer-manager';
const SIGNER_B = 'ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5.signer-manager';

// Stakers, chosen so ASC principal order is ALICE < CAROL < BOB.
const ALICE = 'ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5'; // STX only, SIGNER_A
const CAROL = 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C'; // STX + bond, SIGNER_A
const BOB = 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP'; // bond only, SIGNER_A
const DAVE = 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6'; // STX only, SIGNER_B (excluded)

const BOND_INDEX = 0;

const stakeData = (signer: string, staker: string, amount_ustx: string) => ({
  signer,
  staker,
  amount_ustx,
  num_cycles: '6',
  first_reward_cycle: '8',
  unlock_burn_height: '10000',
  unlock_cycle: '20',
});

const registerForBondData = (signer: string, staker: string) => ({
  bond_index: String(BOND_INDEX),
  signer,
  staker,
  amount_ustx: '10000000',
  sats_total: '1000',
  first_reward_cycle: '8',
  unlock_burn_height: '10000',
  unlock_cycle: '20',
  is_l1_lock: false,
  btc_lockup: { type: 'l2', txs: [] },
});

const SETUP_BOND_DATA = {
  bond_index: String(BOND_INDEX),
  target_rate: '300',
  stx_value_ratio: '10000000',
  min_ustx_ratio: '1000',
  early_unlock_bytes: '',
  first_reward_cycle: '8',
  bond_start_height: '160',
  unlock_cycle: '20',
  unlock_burn_height: '10000',
};

interface SignerStakerItem {
  staker: string;
  staking_types: ('stx' | 'bond')[];
}
interface StakersPage {
  total: number;
  limit: number;
  cursor: { next: string | null; previous: string | null; current: string | null };
  results: SignerStakerItem[];
}

describe('pox-5 signer stakers', () => {
  let db: PgWriteStore;
  let api: ApiServer;

  async function getStakers(
    signer: string,
    query: Record<string, string> = {}
  ): Promise<StakersPage> {
    const res = await supertest(api.server)
      .get(`/extended/v3/staking/signers/${signer}/stakers`)
      .query(query);
    assert.equal(res.status, 200, res.text);
    return JSON.parse(res.text) as StakersPage;
  }

  // One block seeding: a bond, STX stakes (ALICE/CAROL under A, DAVE under B),
  // and bond registrations (BOB/CAROL under A).
  const seed = () =>
    db.update(
      new TestBlockBuilder({ block_height: 1, block_hash: '0x01', index_block_hash: '0x01' })
        .addTx({ tx_id: '0x' + 'a1'.repeat(32) })
        .addTxPox5Event({ name: Pox5EventName.SetupBond, data: SETUP_BOND_DATA })
        .addTxPox5Event({ name: Pox5EventName.Stake, data: stakeData(SIGNER_A, ALICE, '5000000') })
        .addTxPox5Event({ name: Pox5EventName.Stake, data: stakeData(SIGNER_A, CAROL, '7000000') })
        .addTxPox5Event({ name: Pox5EventName.Stake, data: stakeData(SIGNER_B, DAVE, '9000000') })
        .addTxPox5Event({
          name: Pox5EventName.RegisterForBond,
          data: registerForBondData(SIGNER_A, BOB),
        })
        .addTxPox5Event({
          name: Pox5EventName.RegisterForBond,
          data: registerForBondData(SIGNER_A, CAROL),
        })
        .build()
    );

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    api = await startApiServer({ datastore: db, chainId: STACKS_TESTNET.chainId });
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await migrate('down');
  });

  test('returns an empty page for a signer with no stakers', async () => {
    const page = await getStakers(SIGNER_A);
    assert.equal(page.total, 0);
    assert.deepEqual(page.results, []);
    assert.deepEqual(page.cursor, { next: null, previous: null, current: null });
  });

  test('lists STX, bond, and both-type stakers for a signer, excluding other signers', async () => {
    await seed();
    const page = await getStakers(SIGNER_A);
    assert.equal(page.total, 3);
    // Sorted by staker principal ascending: ALICE < CAROL < BOB.
    assert.deepEqual(page.results, [
      { staker: ALICE, staking_types: ['stx'] },
      { staker: CAROL, staking_types: ['stx', 'bond'] },
      { staker: BOB, staking_types: ['bond'] },
    ]);
    // DAVE staked under SIGNER_B, so must not appear here.
    assert.ok(!page.results.some(r => r.staker === DAVE));
  });

  test("only SIGNER_B's staker appears under SIGNER_B", async () => {
    await seed();
    const page = await getStakers(SIGNER_B);
    assert.equal(page.total, 1);
    assert.deepEqual(page.results, [{ staker: DAVE, staking_types: ['stx'] }]);
  });

  test('paginates stakers by staker principal', async () => {
    await seed();
    const page1 = await getStakers(SIGNER_A, { limit: '1' });
    assert.equal(page1.total, 3);
    assert.deepEqual(page1.results, [{ staker: ALICE, staking_types: ['stx'] }]);
    assert.equal(page1.cursor.next, CAROL);

    const page2 = await getStakers(SIGNER_A, { limit: '1', cursor: page1.cursor.next as string });
    assert.deepEqual(page2.results, [{ staker: CAROL, staking_types: ['stx', 'bond'] }]);
    assert.equal(page2.cursor.next, BOB);
  });
});
