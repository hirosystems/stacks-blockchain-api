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
 * `GET /extended/v3/staking` — the network staking overview (`locked` totals) — plus the
 * cross-mode roll-over handling that keeps a staker's STX/BTC from being counted under
 * both an STX-only stake and a bond position (stake → bond, bond → stake, bond → bond).
 */

const ADMIN = 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP';
const ALICE = 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6';
const BOB = 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y';
const CAROL = 'ST2REHHS5J3CERCRBEPMGH7921Q6PYKAADT7JP2VB';
const SIGNER = `${ADMIN}.signer-manager`;

// Burn tip used by every block unless a test says otherwise.
const TIP = 1_000;

// Bond 0: already active at TIP. Bond 1: upcoming at TIP. Bond 2: unlocked at TIP.
const BOND_ACTIVE = { index: 0, start: 900, unlock: 2_000 };
const BOND_UPCOMING = { index: 1, start: 1_500, unlock: 2_600 };
const BOND_UNLOCKED = { index: 2, start: 100, unlock: 800 };

interface StakingLockedTotals {
  stx: { individual_staked_amount: string; bond_staked_amount: string; total_amount: string };
  btc: { bond_staked_amount: string };
}
interface StakingOverview {
  locked: StakingLockedTotals;
}
interface StakingSummary {
  stx: { locked: string };
  bonds: { count: number; locked: { btc: string; stx: string } };
}
interface BondPositionsPage {
  total: number;
  results: {
    bond_index: number;
    status: string;
    active: boolean;
    locked: { btc: string; stx: string };
  }[];
}
interface BondDetail {
  balances: { locked: { btc: string; stx: string } };
}
interface SignerStakersPage {
  total: number;
  results: { staker: string; types: string[] }[];
}

function setupBondData(bond: { index: number; start: number; unlock: number }) {
  return {
    bond_index: String(bond.index),
    target_rate: '300',
    stx_value_ratio: '10000000',
    min_ustx_ratio: '1000',
    early_unlock_bytes: '',
    first_reward_cycle: '8',
    bond_start_height: String(bond.start),
    unlock_cycle: '20',
    unlock_burn_height: String(bond.unlock),
  };
}

function registerData(args: { bond: number; staker: string; ustx: bigint; sats: bigint }) {
  return {
    bond_index: String(args.bond),
    signer: SIGNER,
    staker: args.staker,
    amount_ustx: args.ustx.toString(),
    sats_total: args.sats.toString(),
    first_reward_cycle: '8',
    unlock_burn_height: '2000',
    unlock_cycle: '20',
    is_l1_lock: false,
    btc_lockup: { type: 'l2', txs: [] },
  };
}

function stakeData(args: { staker: string; ustx: bigint; unlock: number }) {
  return {
    signer: SIGNER,
    staker: args.staker,
    amount_ustx: args.ustx.toString(),
    num_cycles: '2',
    first_reward_cycle: '8',
    unlock_burn_height: String(args.unlock),
    unlock_cycle: '20',
  };
}

describe('staking overview', () => {
  let db: PgWriteStore;
  let api: ApiServer;
  let height = 0;
  let lastIndexHash = '0x00';

  /** Start a new block on top of the last one (all at the same burn tip unless overridden). */
  function nextBlock(args?: { burn_block_height?: number }) {
    height += 1;
    const indexHash = '0x' + height.toString(16).padStart(4, '0');
    const builder = new TestBlockBuilder({
      block_height: height,
      block_hash: indexHash,
      index_block_hash: indexHash,
      parent_block_hash: lastIndexHash,
      parent_index_block_hash: lastIndexHash,
      burn_block_height: args?.burn_block_height ?? TIP,
    }).addTx({ tx_id: '0x' + height.toString(16).padStart(64, '0') });
    lastIndexHash = indexHash;
    return builder;
  }

  async function getJson<T>(path: string): Promise<T> {
    const res = await supertest(api.server).get(path);
    assert.equal(res.status, 200, `GET ${path} -> ${res.status}: ${res.text}`);
    assert.equal(res.type, 'application/json');
    return JSON.parse(res.text) as T;
  }
  const getTotals = async () => (await getJson<StakingOverview>('/extended/v3/staking')).locked;

  function assertTotals(
    totals: StakingLockedTotals,
    expected: { individual: bigint; bondStx: bigint; bondBtc: bigint },
    label: string
  ) {
    assert.equal(
      BigInt(totals.stx.individual_staked_amount),
      expected.individual,
      `${label}: individual`
    );
    assert.equal(BigInt(totals.stx.bond_staked_amount), expected.bondStx, `${label}: bond stx`);
    assert.equal(
      BigInt(totals.stx.total_amount),
      expected.individual + expected.bondStx,
      `${label}: total stx`
    );
    assert.equal(BigInt(totals.btc.bond_staked_amount), expected.bondBtc, `${label}: bond btc`);
  }

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    api = await startApiServer({ datastore: db, chainId: STACKS_TESTNET.chainId });
    height = 0;
    lastIndexHash = '0x00';
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await migrate('down');
  });

  test('reports zeros on an empty chain', async () => {
    await db.update(nextBlock().build());
    assert.deepEqual(await getJson<StakingOverview>('/extended/v3/staking'), {
      locked: {
        stx: { individual_staked_amount: '0', bond_staked_amount: '0', total_amount: '0' },
        btc: { bond_staked_amount: '0' },
      },
    });
  });

  test('sums active STX-only stakes and applies lock expiry at the burn tip', async () => {
    // alice: active (unlock > tip). bob: expires exactly at tip (still counted: a lock is
    // active while unlock_burn_height >= tip). carol: expired (unlock < tip).
    await db.update(
      nextBlock()
        .addTxPox5Event({
          name: Pox5EventName.Stake,
          data: stakeData({ staker: ALICE, ustx: 50_000_000n, unlock: TIP + 500 }),
        })
        .addTxPox5Event({
          name: Pox5EventName.Stake,
          data: stakeData({ staker: BOB, ustx: 30_000_000n, unlock: TIP }),
        })
        .addTxPox5Event({
          name: Pox5EventName.Stake,
          data: stakeData({ staker: CAROL, ustx: 20_000_000n, unlock: TIP - 1 }),
        })
        .build()
    );
    assertTotals(
      await getTotals(),
      { individual: 80_000_000n, bondStx: 0n, bondBtc: 0n },
      'stakes'
    );

    // A stake-update replaces alice's amount (latest-wins, not additive).
    await db.update(
      nextBlock()
        .addTxPox5Event({
          name: Pox5EventName.StakeUpdate,
          data: {
            staker: ALICE,
            signer: SIGNER,
            old_signer: SIGNER,
            prev_unlock_height: String(TIP + 500),
            unlock_burn_height: String(TIP + 900),
            unlock_cycle: '25',
            num_cycles: '3',
            amount_ustx: '70000000',
            amount_increase: '20000000',
            cycles_to_extend: '1',
          },
        })
        .build()
    );
    assertTotals(
      await getTotals(),
      { individual: 100_000_000n, bondStx: 0n, bondBtc: 0n },
      'update'
    );

    // An unstake keeps the STX counted until its (cycle-end) unlock height...
    await db.update(
      nextBlock()
        .addTxPox5Event({
          name: Pox5EventName.Unstake,
          data: {
            staker: ALICE,
            signer: SIGNER,
            amount_ustx: '70000000',
            first_reward_cycle: '8',
            unlock_cycle: '20',
            unlock_burn_height: String(TIP + 10),
          },
        })
        .build()
    );
    assertTotals(
      await getTotals(),
      { individual: 100_000_000n, bondStx: 0n, bondBtc: 0n },
      'unstake'
    );

    // ...and drops out once the burn tip moves past it (bob's expires too).
    await db.update(nextBlock({ burn_block_height: TIP + 11 }).build());
    assertTotals(await getTotals(), { individual: 0n, bondStx: 0n, bondBtc: 0n }, 'expired');
  });

  test('sums bond STX/BTC from registration for active and upcoming bonds, not unlocked ones', async () => {
    await db.update(
      nextBlock()
        .addTxPox5Event({ name: Pox5EventName.SetupBond, data: setupBondData(BOND_ACTIVE) })
        .addTxPox5Event({ name: Pox5EventName.SetupBond, data: setupBondData(BOND_UPCOMING) })
        .addTxPox5Event({ name: Pox5EventName.SetupBond, data: setupBondData(BOND_UNLOCKED) })
        .build()
    );
    await db.update(
      nextBlock()
        .addTxPox5Event({
          name: Pox5EventName.RegisterForBond,
          data: registerData({
            bond: BOND_ACTIVE.index,
            staker: ALICE,
            ustx: 10_000_000n,
            sats: 1_000n,
          }),
        })
        .addTxPox5Event({
          name: Pox5EventName.RegisterForBond,
          data: registerData({
            bond: BOND_UPCOMING.index,
            staker: BOB,
            ustx: 20_000_000n,
            sats: 2_000n,
          }),
        })
        .addTxPox5Event({
          name: Pox5EventName.RegisterForBond,
          data: registerData({
            bond: BOND_UNLOCKED.index,
            staker: CAROL,
            ustx: 40_000_000n,
            sats: 4_000n,
          }),
        })
        .build()
    );
    // The unlocked bond's registration is excluded; the upcoming one counts from registration.
    assertTotals(
      await getTotals(),
      { individual: 0n, bondStx: 30_000_000n, bondBtc: 3_000n },
      'registered'
    );

    // A registration update moves the position by its delta.
    await db.update(
      nextBlock()
        .addTxPox5Event({
          name: Pox5EventName.UpdateBondRegistration,
          data: {
            staker: ALICE,
            signer: SIGNER,
            old_signer: SIGNER,
            bond_index: String(BOND_ACTIVE.index),
            amount_ustx: '15000000',
            amount_sats: '1500',
            first_reward_cycle: '8',
            unlock_burn_height: '2000',
            unlock_cycle: '20',
          },
        })
        .build()
    );
    assertTotals(
      await getTotals(),
      { individual: 0n, bondStx: 35_000_000n, bondBtc: 3_500n },
      'updated'
    );

    // A partial sBTC unstake reduces the BTC side only.
    await db.update(
      nextBlock()
        .addTxPox5Event({
          name: Pox5EventName.UnstakeSbtc,
          data: {
            staker: BOB,
            signer: SIGNER,
            bond_index: String(BOND_UPCOMING.index),
            amount_sats_released: '500',
            new_amount_sats: '1500',
          },
        })
        .build()
    );
    assertTotals(
      await getTotals(),
      { individual: 0n, bondStx: 35_000_000n, bondBtc: 3_000n },
      'unstake-sbtc'
    );

    // Once the burn tip reaches the active bond's unlock height, its amounts drop out.
    await db.update(nextBlock({ burn_block_height: BOND_ACTIVE.unlock }).build());
    assertTotals(
      await getTotals(),
      { individual: 0n, bondStx: 20_000_000n, bondBtc: 1_500n },
      'bond unlocked'
    );
  });

  test('combines individual and bond STX into total_amount', async () => {
    await db.update(
      nextBlock()
        .addTxPox5Event({ name: Pox5EventName.SetupBond, data: setupBondData(BOND_ACTIVE) })
        .addTxPox5Event({
          name: Pox5EventName.RegisterForBond,
          data: registerData({
            bond: BOND_ACTIVE.index,
            staker: ALICE,
            ustx: 10_000_000n,
            sats: 1_000n,
          }),
        })
        .addTxPox5Event({
          name: Pox5EventName.Stake,
          data: stakeData({ staker: BOB, ustx: 5_000_000n, unlock: TIP + 100 }),
        })
        .build()
    );
    const totals = await getTotals();
    assertTotals(
      totals,
      { individual: 5_000_000n, bondStx: 10_000_000n, bondBtc: 1_000n },
      'mixed'
    );
    assert.equal(totals.stx.total_amount, '15000000');
  });

  test('serves a chain-tip ETag and answers 304 when unchanged', async () => {
    await db.update(nextBlock().build());
    const first = await supertest(api.server).get('/extended/v3/staking');
    assert.equal(first.status, 200);
    const etag = first.headers['etag'];
    assert.ok(etag, 'ETag present');
    const second = await supertest(api.server)
      .get('/extended/v3/staking')
      .set('If-None-Match', etag);
    assert.equal(second.status, 304);
    // A new block changes the tip and invalidates the cached response.
    await db.update(nextBlock().build());
    const third = await supertest(api.server)
      .get('/extended/v3/staking')
      .set('If-None-Match', etag);
    assert.equal(third.status, 200);
  });

  describe('roll-overs', () => {
    test('stake → bond: the STX-only lock is released when the staker registers for a bond', async () => {
      await db.update(
        nextBlock()
          .addTxPox5Event({ name: Pox5EventName.SetupBond, data: setupBondData(BOND_UPCOMING) })
          .addTxPox5Event({
            name: Pox5EventName.Stake,
            data: stakeData({ staker: ALICE, ustx: 10_000_000n, unlock: BOND_UPCOMING.start }),
          })
          .build()
      );
      assertTotals(
        await getTotals(),
        { individual: 10_000_000n, bondStx: 0n, bondBtc: 0n },
        'staked'
      );
      let stakers = await getJson<SignerStakersPage>(
        `/extended/v3/staking/signers/${SIGNER}/stakers`
      );
      assert.deepEqual(stakers.results, [{ staker: ALICE, types: ['stx'] }]);

      // alice rolls her ending stake into the upcoming bond.
      await db.update(
        nextBlock()
          .addTxPox5Event({
            name: Pox5EventName.RegisterForBond,
            data: registerData({
              bond: BOND_UPCOMING.index,
              staker: ALICE,
              ustx: 12_000_000n,
              sats: 1_000n,
            }),
          })
          .build()
      );
      // Only the bond counts now — no double count while the old stake's unlock height is
      // still in the future.
      assertTotals(
        await getTotals(),
        { individual: 0n, bondStx: 12_000_000n, bondBtc: 1_000n },
        'rolled'
      );
      const lockRows = await db.sql<{ principal: string }[]>`
        SELECT principal FROM stx_locked_balances WHERE principal = ${ALICE}
      `;
      assert.equal(lockRows.length, 0, 'materialized STX-only lock removed');
      const summary = await getJson<StakingSummary>(`/extended/v3/principals/${ALICE}/staking`);
      assert.equal(summary.stx.locked, '0');
      assert.equal(summary.bonds.count, 1);
      assert.equal(summary.bonds.locked.stx, '12000000');
      stakers = await getJson<SignerStakersPage>(`/extended/v3/staking/signers/${SIGNER}/stakers`);
      assert.deepEqual(stakers.results, [{ staker: ALICE, types: ['btc'] }]);
    });

    test('stake → bond: orphaning the registration restores the STX-only lock', async () => {
      // Block 1: alice stakes. Block 2 (fork A): she registers for the bond.
      await db.update(
        nextBlock()
          .addTxPox5Event({ name: Pox5EventName.SetupBond, data: setupBondData(BOND_UPCOMING) })
          .addTxPox5Event({
            name: Pox5EventName.Stake,
            data: stakeData({ staker: ALICE, ustx: 10_000_000n, unlock: BOND_UPCOMING.start }),
          })
          .build()
      );
      const forkPoint = lastIndexHash;
      await db.update(
        nextBlock()
          .addTxPox5Event({
            name: Pox5EventName.RegisterForBond,
            data: registerData({
              bond: BOND_UPCOMING.index,
              staker: ALICE,
              ustx: 12_000_000n,
              sats: 1_000n,
            }),
          })
          .build()
      );
      assertTotals(
        await getTotals(),
        { individual: 0n, bondStx: 12_000_000n, bondBtc: 1_000n },
        'fork A'
      );

      // Fork B branches from block 1 and overtakes, orphaning the registration block.
      await db.update(
        new TestBlockBuilder({
          block_height: 2,
          block_hash: '0xb2',
          index_block_hash: '0xb2',
          parent_block_hash: forkPoint,
          parent_index_block_hash: forkPoint,
          burn_block_height: TIP,
        }).build()
      );
      await db.update(
        new TestBlockBuilder({
          block_height: 3,
          block_hash: '0xb3',
          index_block_hash: '0xb3',
          parent_block_hash: '0xb2',
          parent_index_block_hash: '0xb2',
          burn_block_height: TIP,
        }).build()
      );
      // The recompute re-derives alice's lock from the surviving stake event.
      assertTotals(
        await getTotals(),
        { individual: 10_000_000n, bondStx: 0n, bondBtc: 0n },
        'fork B'
      );
      const summary = await getJson<StakingSummary>(`/extended/v3/principals/${ALICE}/staking`);
      assert.equal(summary.stx.locked, '10000000');
      assert.equal(summary.bonds.count, 0);
    });

    test('a side-fork registration does not touch the canonical STX-only lock', async () => {
      await db.update(
        nextBlock()
          .addTxPox5Event({ name: Pox5EventName.SetupBond, data: setupBondData(BOND_UPCOMING) })
          .addTxPox5Event({
            name: Pox5EventName.Stake,
            data: stakeData({ staker: ALICE, ustx: 10_000_000n, unlock: BOND_UPCOMING.start }),
          })
          .build()
      );
      const forkPoint = lastIndexHash;
      // Canonical block 2, then a competing non-canonical block 2 carrying the registration.
      await db.update(nextBlock().build());
      await db.update(
        new TestBlockBuilder({
          block_height: 2,
          block_hash: '0xf2',
          index_block_hash: '0xf2',
          parent_block_hash: forkPoint,
          parent_index_block_hash: forkPoint,
          burn_block_height: TIP,
          canonical: false,
        })
          .addTx({ tx_id: '0x' + 'f2'.repeat(32), canonical: false })
          .addTxPox5Event({
            name: Pox5EventName.RegisterForBond,
            data: registerData({
              bond: BOND_UPCOMING.index,
              staker: ALICE,
              ustx: 12_000_000n,
              sats: 1_000n,
            }),
          })
          .build()
      );
      assertTotals(
        await getTotals(),
        { individual: 10_000_000n, bondStx: 0n, bondBtc: 0n },
        'side fork'
      );
    });

    test('bond → stake: the bond position is rolled over when the staker stakes STX-only', async () => {
      await db.update(
        nextBlock()
          .addTxPox5Event({ name: Pox5EventName.SetupBond, data: setupBondData(BOND_ACTIVE) })
          .addTxPox5Event({
            name: Pox5EventName.RegisterForBond,
            data: registerData({
              bond: BOND_ACTIVE.index,
              staker: ALICE,
              ustx: 10_000_000n,
              sats: 1_000n,
            }),
          })
          .addTxPox5Event({
            name: Pox5EventName.RegisterForBond,
            data: registerData({
              bond: BOND_ACTIVE.index,
              staker: BOB,
              ustx: 20_000_000n,
              sats: 2_000n,
            }),
          })
          .build()
      );
      assertTotals(
        await getTotals(),
        { individual: 0n, bondStx: 30_000_000n, bondBtc: 3_000n },
        'bonded'
      );

      // alice rolls her bond position into an STX-only stake.
      await db.update(
        nextBlock()
          .addTxPox5Event({
            name: Pox5EventName.Stake,
            data: stakeData({ staker: ALICE, ustx: 11_000_000n, unlock: TIP + 500 }),
          })
          .build()
      );
      assertTotals(
        await getTotals(),
        { individual: 11_000_000n, bondStx: 20_000_000n, bondBtc: 2_000n },
        'rolled'
      );

      // The position is marked rolled over with nothing locked; bob's is untouched.
      const positions = await getJson<BondPositionsPage>(
        `/extended/v3/principals/${ALICE}/staking/bonds`
      );
      assert.equal(positions.total, 1);
      assert.deepEqual(positions.results[0].status, 'rolled_over');
      assert.equal(positions.results[0].active, false);
      assert.deepEqual(positions.results[0].locked, { btc: '0', stx: '0' });
      const bond = await getJson<BondDetail>(`/extended/v3/staking/bonds/${BOND_ACTIVE.index}`);
      assert.deepEqual(bond.balances.locked, { btc: '2000', stx: '20000000' });
      const alice = await getJson<StakingSummary>(`/extended/v3/principals/${ALICE}/staking`);
      assert.equal(alice.stx.locked, '11000000');
      assert.equal(alice.bonds.count, 1, 'the rolled-over position is still listed');
      assert.deepEqual(alice.bonds.locked, { btc: '0', stx: '0' });
      const bob = await getJson<StakingSummary>(`/extended/v3/principals/${BOB}/staking`);
      assert.deepEqual(bob.bonds.locked, { btc: '2000', stx: '20000000' });

      // A stake-update on the new stake must not roll anything else over.
      await db.update(
        nextBlock()
          .addTxPox5Event({
            name: Pox5EventName.StakeUpdate,
            data: {
              staker: ALICE,
              signer: SIGNER,
              old_signer: SIGNER,
              prev_unlock_height: String(TIP + 500),
              unlock_burn_height: String(TIP + 900),
              unlock_cycle: '25',
              num_cycles: '3',
              amount_ustx: '13000000',
              amount_increase: '2000000',
              cycles_to_extend: '1',
            },
          })
          .build()
      );
      assertTotals(
        await getTotals(),
        { individual: 13_000_000n, bondStx: 20_000_000n, bondBtc: 2_000n },
        'updated'
      );
    });

    test('bond → bond: the earlier position is rolled over into the new bond', async () => {
      await db.update(
        nextBlock()
          .addTxPox5Event({ name: Pox5EventName.SetupBond, data: setupBondData(BOND_ACTIVE) })
          .addTxPox5Event({ name: Pox5EventName.SetupBond, data: setupBondData(BOND_UPCOMING) })
          .addTxPox5Event({
            name: Pox5EventName.RegisterForBond,
            data: registerData({
              bond: BOND_ACTIVE.index,
              staker: ALICE,
              ustx: 10_000_000n,
              sats: 1_000n,
            }),
          })
          .build()
      );
      assertTotals(
        await getTotals(),
        { individual: 0n, bondStx: 10_000_000n, bondBtc: 1_000n },
        'bond 0'
      );

      // alice rolls from the ending bond 0 into the upcoming bond 1.
      await db.update(
        nextBlock()
          .addTxPox5Event({
            name: Pox5EventName.RegisterForBond,
            data: registerData({
              bond: BOND_UPCOMING.index,
              staker: ALICE,
              ustx: 14_000_000n,
              sats: 1_400n,
            }),
          })
          .build()
      );
      assertTotals(
        await getTotals(),
        { individual: 0n, bondStx: 14_000_000n, bondBtc: 1_400n },
        'bond 1'
      );

      const positions = await getJson<BondPositionsPage>(
        `/extended/v3/principals/${ALICE}/staking/bonds`
      );
      assert.equal(positions.total, 2);
      const [old, current] = positions.results;
      assert.equal(old.bond_index, BOND_ACTIVE.index);
      assert.equal(old.status, 'rolled_over');
      assert.deepEqual(old.locked, { btc: '0', stx: '0' });
      assert.equal(current.bond_index, BOND_UPCOMING.index);
      assert.equal(current.status, 'enrolled');
      assert.deepEqual(current.locked, { btc: '1400', stx: '14000000' });

      const oldBond = await getJson<BondDetail>(`/extended/v3/staking/bonds/${BOND_ACTIVE.index}`);
      assert.deepEqual(oldBond.balances.locked, { btc: '0', stx: '0' });
      const newBond = await getJson<BondDetail>(
        `/extended/v3/staking/bonds/${BOND_UPCOMING.index}`
      );
      assert.deepEqual(newBond.balances.locked, { btc: '1400', stx: '14000000' });
      const summary = await getJson<StakingSummary>(`/extended/v3/principals/${ALICE}/staking`);
      assert.equal(summary.bonds.count, 2);
      assert.deepEqual(summary.bonds.locked, { btc: '1400', stx: '14000000' });
    });

    test('a registration update on the same bond is not a roll-over', async () => {
      await db.update(
        nextBlock()
          .addTxPox5Event({ name: Pox5EventName.SetupBond, data: setupBondData(BOND_ACTIVE) })
          .addTxPox5Event({
            name: Pox5EventName.RegisterForBond,
            data: registerData({
              bond: BOND_ACTIVE.index,
              staker: ALICE,
              ustx: 10_000_000n,
              sats: 1_000n,
            }),
          })
          .build()
      );
      await db.update(
        nextBlock()
          .addTxPox5Event({
            name: Pox5EventName.UpdateBondRegistration,
            data: {
              staker: ALICE,
              signer: SIGNER,
              old_signer: SIGNER,
              bond_index: String(BOND_ACTIVE.index),
              amount_ustx: '12000000',
              amount_sats: '1200',
              first_reward_cycle: '8',
              unlock_burn_height: '2000',
              unlock_cycle: '20',
            },
          })
          .build()
      );
      const positions = await getJson<BondPositionsPage>(
        `/extended/v3/principals/${ALICE}/staking/bonds`
      );
      assert.equal(positions.results[0].status, 'enrolled');
      assert.equal(positions.results[0].active, true);
      assertTotals(
        await getTotals(),
        { individual: 0n, bondStx: 12_000_000n, bondBtc: 1_200n },
        'updated'
      );
    });
  });
});
