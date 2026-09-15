import supertest from 'supertest';
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { STACKS_TESTNET } from '@stacks/network';
import { Pox5EventName } from '@stacks/codec';
import { ApiServer, startApiServer } from '../../../src/api/init.ts';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { migrate } from '../../test-helpers.ts';
import { TestBlockBuilder } from '../test-builders.ts';
import {
  BACKFILL_BOND_POSITION_ROLLOVERS_SQL,
  BACKFILL_STALE_STX_LOCKS_SQL,
} from '../../../migrations/1779800000018_bond-position-rollovers.ts';

/**
 * pox-5 cross-mode roll-over handling: a staker holds one live pox-5 position at a time, so a
 * `register-for-bond` releases any STX-only stake and any earlier bond position, and a `stake`
 * releases any bond position (stake → bond, bond → stake, bond → bond). Covers ingestion, reorgs
 * (orphaned and side-fork roll-overs), and the migration backfill for pre-fix state. Network-wide
 * locked totals are computed straight from the tables here (see `getTotals`).
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
  stx: { stx_only: string; bonds: string; total: string };
  btc: { total: string };
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

describe('pox-5 position roll-overs', () => {
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
  /**
   * Network-wide locked totals read straight from the materialized tables at the current burn
   * tip: pox-5 STX-only locks whose unlock height has not passed, plus the running locked totals
   * of bonds that have not unlocked.
   */
  async function getTotals(): Promise<StakingLockedTotals> {
    const [tip] = await db.sql<{ burn_block_height: number }[]>`
      SELECT burn_block_height FROM chain_tip
    `;
    const burnTip = tip?.burn_block_height ?? 0;
    const [stx] = await db.sql<{ stx_only: string }[]>`
      SELECT COALESCE(SUM(locked_amount), 0)::text AS stx_only
      FROM stx_locked_balances
      WHERE pox_version = 5 AND locked_amount > 0 AND unlock_burn_height >= ${burnTip}
    `;
    const [bonds] = await db.sql<{ stx: string; btc: string }[]>`
      SELECT COALESCE(SUM(stx_locked), 0)::text AS stx, COALESCE(SUM(btc_locked), 0)::text AS btc
      FROM bonds
      WHERE canonical = true AND microblock_canonical = true AND unlock_burn_height > ${burnTip}
    `;
    return {
      stx: {
        stx_only: stx.stx_only,
        bonds: bonds.stx,
        total: (BigInt(stx.stx_only) + BigInt(bonds.stx)).toString(),
      },
      btc: { total: bonds.btc },
    };
  }

  function assertTotals(
    totals: StakingLockedTotals,
    expected: { individual: bigint; bondStx: bigint; bondBtc: bigint },
    label: string
  ) {
    assert.equal(BigInt(totals.stx.stx_only), expected.individual, `${label}: individual`);
    assert.equal(BigInt(totals.stx.bonds), expected.bondStx, `${label}: bond stx`);
    assert.equal(
      BigInt(totals.stx.total),
      expected.individual + expected.bondStx,
      `${label}: total stx`
    );
    assert.equal(BigInt(totals.btc.total), expected.bondBtc, `${label}: bond btc`);
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
    const newBond = await getJson<BondDetail>(`/extended/v3/staking/bonds/${BOND_UPCOMING.index}`);
    assert.deepEqual(newBond.balances.locked, { btc: '1400', stx: '14000000' });
    const summary = await getJson<StakingSummary>(`/extended/v3/principals/${ALICE}/staking`);
    assert.equal(summary.bonds.count, 2);
    assert.deepEqual(summary.bonds.locked, { btc: '1400', stx: '14000000' });
  });

  test('orphaning a bond → stake roll-over block restores the position and totals', async () => {
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
    const forkPoint = lastIndexHash;
    // Block 2 (fork A): alice rolls her bond position into an STX-only stake.
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
      { individual: 11_000_000n, bondStx: 0n, bondBtc: 0n },
      'rolled'
    );

    // Fork B branches from block 1 and overtakes, orphaning the roll-over block.
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

    // The stake is gone and the bond position is back with its original state and amounts.
    assertTotals(
      await getTotals(),
      { individual: 0n, bondStx: 10_000_000n, bondBtc: 1_000n },
      'restored'
    );
    const positions = await getJson<BondPositionsPage>(
      `/extended/v3/principals/${ALICE}/staking/bonds`
    );
    assert.equal(positions.results[0].status, 'enrolled');
    assert.equal(positions.results[0].active, true);
    assert.deepEqual(positions.results[0].locked, { btc: '1000', stx: '10000000' });
    const bond = await getJson<BondDetail>(`/extended/v3/staking/bonds/${BOND_ACTIVE.index}`);
    assert.deepEqual(bond.balances.locked, { btc: '1000', stx: '10000000' });
    const summary = await getJson<StakingSummary>(`/extended/v3/principals/${ALICE}/staking`);
    assert.equal(summary.stx.locked, '0');
    assert.deepEqual(summary.bonds.locked, { btc: '1000', stx: '10000000' });
    // The roll-over source row is non-canonical with its captured state cleared.
    const rows = await db.sql<{ canonical: boolean; previous_status: number | null }[]>`
      SELECT canonical, previous_status FROM bond_position_rollovers WHERE principal = ${ALICE}
    `;
    assert.deepEqual([...rows], [{ canonical: false, previous_status: null }]);
  });

  test('orphaning a bond → bond roll-over block restores the earlier position', async () => {
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
    const forkPoint = lastIndexHash;
    // Block 2 (fork A): alice rolls from bond 0 into bond 1.
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
      'rolled'
    );

    // Fork B orphans the roll-over block: the bond 1 position is flipped away by its own block
    // and the bond 0 position is restored from the roll-over row.
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
    assertTotals(
      await getTotals(),
      { individual: 0n, bondStx: 10_000_000n, bondBtc: 1_000n },
      'restored'
    );
    const positions = await getJson<BondPositionsPage>(
      `/extended/v3/principals/${ALICE}/staking/bonds`
    );
    assert.equal(positions.total, 1);
    assert.equal(positions.results[0].bond_index, BOND_ACTIVE.index);
    assert.equal(positions.results[0].status, 'enrolled');
    assert.deepEqual(positions.results[0].locked, { btc: '1000', stx: '10000000' });
    const oldBond = await getJson<BondDetail>(`/extended/v3/staking/bonds/${BOND_ACTIVE.index}`);
    assert.deepEqual(oldBond.balances.locked, { btc: '1000', stx: '10000000' });
    const newBond = await getJson<BondDetail>(`/extended/v3/staking/bonds/${BOND_UPCOMING.index}`);
    assert.deepEqual(newBond.balances.locked, { btc: '0', stx: '0' });
    const summary = await getJson<StakingSummary>(`/extended/v3/principals/${ALICE}/staking`);
    assert.equal(summary.bonds.count, 1);
    assert.deepEqual(summary.bonds.locked, { btc: '1000', stx: '10000000' });
  });

  test('a side-fork roll-over is applied once its fork becomes canonical', async () => {
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
    const forkPoint = lastIndexHash;
    // Canonical block 2, then a competing non-canonical block 2 carrying alice's stake.
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
          name: Pox5EventName.Stake,
          data: stakeData({ staker: ALICE, ustx: 11_000_000n, unlock: TIP + 500 }),
        })
        .build()
    );
    // Nothing applied while the stake sits on the side fork...
    assertTotals(
      await getTotals(),
      { individual: 0n, bondStx: 10_000_000n, bondBtc: 1_000n },
      'side fork'
    );
    const pending = await db.sql<{ canonical: boolean; previous_status: number | null }[]>`
      SELECT canonical, previous_status FROM bond_position_rollovers WHERE principal = ${ALICE}
    `;
    assert.deepEqual([...pending], [{ canonical: false, previous_status: null }]);

    // ...until the fork overtakes: the stake becomes canonical and the roll-over is applied.
    await db.update(
      new TestBlockBuilder({
        block_height: 3,
        block_hash: '0xf3',
        index_block_hash: '0xf3',
        parent_block_hash: '0xf2',
        parent_index_block_hash: '0xf2',
        burn_block_height: TIP,
      }).build()
    );
    assertTotals(
      await getTotals(),
      { individual: 11_000_000n, bondStx: 0n, bondBtc: 0n },
      'fork won'
    );
    const positions = await getJson<BondPositionsPage>(
      `/extended/v3/principals/${ALICE}/staking/bonds`
    );
    assert.equal(positions.results[0].status, 'rolled_over');
    assert.deepEqual(positions.results[0].locked, { btc: '0', stx: '0' });
    const bond = await getJson<BondDetail>(`/extended/v3/staking/bonds/${BOND_ACTIVE.index}`);
    assert.deepEqual(bond.balances.locked, { btc: '0', stx: '0' });
    const summary = await getJson<StakingSummary>(`/extended/v3/principals/${ALICE}/staking`);
    assert.equal(summary.stx.locked, '11000000');
    assert.deepEqual(summary.bonds.locked, { btc: '0', stx: '0' });
  });

  test('a roll-over of a position that only exists on the same side fork is applied when the fork wins', async () => {
    // Canonical chain: block 1 sets up the bond, blocks 2-3 are empty.
    await db.update(
      nextBlock()
        .addTxPox5Event({ name: Pox5EventName.SetupBond, data: setupBondData(BOND_ACTIVE) })
        .build()
    );
    const forkPoint = lastIndexHash;
    await db.update(nextBlock().build());
    await db.update(nextBlock().build());

    // Side fork of equal length: block 2' registers alice for the bond, block 3' rolls that
    // (side-fork-only) position into an STX-only stake.
    const sideFork = (height: number, hash: string, parent: string) =>
      new TestBlockBuilder({
        block_height: height,
        block_hash: hash,
        index_block_hash: hash,
        parent_block_hash: parent,
        parent_index_block_hash: parent,
        burn_block_height: TIP,
        canonical: false,
      }).addTx({
        tx_id: '0x' + hash.slice(2).repeat(32 / (hash.length / 2 - 1)),
        canonical: false,
      });
    await db.update(
      sideFork(2, '0xf2', forkPoint)
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
      sideFork(3, '0xf3', '0xf2')
        .addTxPox5Event({
          name: Pox5EventName.Stake,
          data: stakeData({ staker: ALICE, ustx: 11_000_000n, unlock: TIP + 500 }),
        })
        .build()
    );
    // Nothing is canonical on the fork yet, but the roll-over intent was recorded.
    assertTotals(await getTotals(), { individual: 0n, bondStx: 0n, bondBtc: 0n }, 'side fork');
    const pending = await db.sql<{ canonical: boolean; previous_status: number | null }[]>`
      SELECT canonical, previous_status FROM bond_position_rollovers WHERE principal = ${ALICE}
    `;
    assert.deepEqual([...pending], [{ canonical: false, previous_status: null }]);

    // The fork overtakes: 3' is restored before 2', so the roll-over is applied once its
    // position's block has been restored too.
    await db.update(
      new TestBlockBuilder({
        block_height: 4,
        block_hash: '0xf4',
        index_block_hash: '0xf4',
        parent_block_hash: '0xf3',
        parent_index_block_hash: '0xf3',
        burn_block_height: TIP,
      }).build()
    );
    assertTotals(
      await getTotals(),
      { individual: 11_000_000n, bondStx: 0n, bondBtc: 0n },
      'fork won'
    );
    const positions = await getJson<BondPositionsPage>(
      `/extended/v3/principals/${ALICE}/staking/bonds`
    );
    assert.equal(positions.total, 1);
    assert.equal(positions.results[0].status, 'rolled_over');
    assert.deepEqual(positions.results[0].locked, { btc: '0', stx: '0' });
    const bond = await getJson<BondDetail>(`/extended/v3/staking/bonds/${BOND_ACTIVE.index}`);
    assert.deepEqual(bond.balances.locked, { btc: '0', stx: '0' });
    const summary = await getJson<StakingSummary>(`/extended/v3/principals/${ALICE}/staking`);
    assert.equal(summary.stx.locked, '11000000');
    assert.deepEqual(summary.bonds.locked, { btc: '0', stx: '0' });
    const applied = await db.sql<{ canonical: boolean; previous_status: number | null }[]>`
      SELECT canonical, previous_status FROM bond_position_rollovers WHERE principal = ${ALICE}
    `;
    assert.deepEqual([...applied], [{ canonical: true, previous_status: 0 }]);
  });

  test('two side-fork roll-overs of the same position in one block release it once when the fork wins', async () => {
    // Canonical: bonds 0 and 1 set up, alice registered for bond 0, then two empty blocks.
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
    const forkPoint = lastIndexHash;
    await db.update(nextBlock().build());

    // Side fork block 2': alice stakes and then registers for bond 1 in the same block. Both
    // handlers see the still-live bond 0 position and record a roll-over row for it.
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
          name: Pox5EventName.Stake,
          data: stakeData({ staker: ALICE, ustx: 11_000_000n, unlock: TIP + 500 }),
        })
        .addTx({ tx_id: '0x' + 'f3'.repeat(32), canonical: false })
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
    const pending = await db.sql<{ previous_status: number | null }[]>`
      SELECT previous_status FROM bond_position_rollovers
      WHERE principal = ${ALICE} AND bond_index = ${BOND_ACTIVE.index}
    `;
    assert.equal(pending.length, 2, 'both roll-over rows recorded');
    assertTotals(
      await getTotals(),
      { individual: 0n, bondStx: 10_000_000n, bondBtc: 1_000n },
      'side fork'
    );

    // The fork wins: both rows flip canonical in one batch, but the position is released once.
    await db.update(
      new TestBlockBuilder({
        block_height: 3,
        block_hash: '0xf4',
        index_block_hash: '0xf4',
        parent_block_hash: '0xf2',
        parent_index_block_hash: '0xf2',
        burn_block_height: TIP,
      }).build()
    );
    // The register-for-bond cleared the stake, so only bond 1 is live.
    assertTotals(
      await getTotals(),
      { individual: 0n, bondStx: 14_000_000n, bondBtc: 1_400n },
      'fork won'
    );
    const oldBond = await getJson<BondDetail>(`/extended/v3/staking/bonds/${BOND_ACTIVE.index}`);
    assert.deepEqual(oldBond.balances.locked, { btc: '0', stx: '0' }, 'not driven negative');
    const summary = await getJson<StakingSummary>(`/extended/v3/principals/${ALICE}/staking`);
    assert.equal(summary.bonds.count, 2);
    assert.deepEqual(summary.bonds.locked, { btc: '1400', stx: '14000000' });
    const rows = await db.sql<{ previous_status: number | null }[]>`
      SELECT previous_status FROM bond_position_rollovers
      WHERE principal = ${ALICE} AND bond_index = ${BOND_ACTIVE.index}
      ORDER BY id ASC
    `;
    assert.deepEqual(
      [...rows],
      [{ previous_status: 0 }, { previous_status: null }],
      'earliest row applied, duplicate left unapplied'
    );
  });

  test('the migration backfill repairs roll-overs ingested before they were mirrored', async () => {
    // Ingest a stake → bond → bond history with the current handlers...
    await db.update(
      nextBlock()
        .addTxPox5Event({ name: Pox5EventName.SetupBond, data: setupBondData(BOND_ACTIVE) })
        .addTxPox5Event({ name: Pox5EventName.SetupBond, data: setupBondData(BOND_UPCOMING) })
        .addTxPox5Event({
          name: Pox5EventName.Stake,
          data: stakeData({ staker: ALICE, ustx: 9_000_000n, unlock: TIP + 500 }),
        })
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
        .build()
    );
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
    const rolloverBlock = lastIndexHash;
    const expected = { individual: 0n, bondStx: 14_000_000n, bondBtc: 1_400n };
    assertTotals(await getTotals(), expected, 'ingested');

    // ...then rewind the materialized state to what a pre-fix API would hold: the stale
    // STX-only lock still present, the bond 0 position live, its amounts still in the bond and
    // principal aggregates, and no roll-over rows.
    await db.sql`
      INSERT INTO stx_locked_balances (principal, locked_amount, unlock_burn_height, pox_version,
        lock_tx_id, lock_block_height, burnchain_lock_height, signer)
      VALUES (${ALICE}, 9000000, ${TIP + 500}, 5, ${'0x' + '01'.padStart(64, '0')}, 1, ${TIP}, ${SIGNER})
    `;
    await db.sql`
      UPDATE principal_bond_positions
      SET status = ${0}, active = true, btc_locked = 1000, stx_locked = 10000000
      WHERE principal = ${ALICE} AND bond_index = ${BOND_ACTIVE.index}
    `;
    await db.sql`
      UPDATE bonds SET btc_locked = btc_locked + 1000, stx_locked = stx_locked + 10000000
      WHERE bond_index = ${BOND_ACTIVE.index}
    `;
    await db.sql`
      UPDATE principal_staking_totals
      SET bond_btc_locked = bond_btc_locked + 1000, bond_stx_locked = bond_stx_locked + 10000000
      WHERE principal = ${ALICE}
    `;
    await db.sql`DELETE FROM bond_position_rollovers`;
    assertTotals(
      await getTotals(),
      { individual: 9_000_000n, bondStx: 24_000_000n, bondBtc: 2_400n },
      'pre-fix state'
    );

    // Running the backfill statements brings it back to the mirrored state.
    await db.sql.unsafe(BACKFILL_STALE_STX_LOCKS_SQL);
    await db.sql.unsafe(BACKFILL_BOND_POSITION_ROLLOVERS_SQL);
    assertTotals(await getTotals(), expected, 'backfilled');
    const lockRows = await db.sql<{ principal: string }[]>`
      SELECT principal FROM stx_locked_balances WHERE principal = ${ALICE}
    `;
    assert.equal(lockRows.length, 0, 'stale STX-only lock removed');
    const positions = await getJson<BondPositionsPage>(
      `/extended/v3/principals/${ALICE}/staking/bonds`
    );
    assert.equal(positions.results[0].status, 'rolled_over');
    assert.deepEqual(positions.results[0].locked, { btc: '0', stx: '0' });
    assert.equal(positions.results[1].status, 'enrolled');
    const oldBond = await getJson<BondDetail>(`/extended/v3/staking/bonds/${BOND_ACTIVE.index}`);
    assert.deepEqual(oldBond.balances.locked, { btc: '0', stx: '0' });
    const summary = await getJson<StakingSummary>(`/extended/v3/principals/${ALICE}/staking`);
    assert.deepEqual(summary.bonds.locked, { btc: '1400', stx: '14000000' });
    // The roll-over row is keyed to the bond 1 registration block and holds the restore state.
    const rows = await db.sql<
      {
        index_block_hash: string;
        canonical: boolean;
        previous_status: number;
        released_stx: string;
      }[]
    >`
      SELECT '0x' || encode(index_block_hash, 'hex') AS index_block_hash, canonical,
        previous_status, released_stx::text
      FROM bond_position_rollovers WHERE principal = ${ALICE}
    `;
    assert.deepEqual(
      [...rows],
      [
        {
          index_block_hash: rolloverBlock,
          canonical: true,
          previous_status: 0,
          released_stx: '10000000',
        },
      ]
    );

    // Running it again is a no-op.
    await db.sql.unsafe(BACKFILL_STALE_STX_LOCKS_SQL);
    await db.sql.unsafe(BACKFILL_BOND_POSITION_ROLLOVERS_SQL);
    assertTotals(await getTotals(), expected, 'idempotent');
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
