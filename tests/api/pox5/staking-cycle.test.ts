import supertest from 'supertest';
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { STACKS_TESTNET } from '@stacks/network';
import { Pox5EventName } from '@stacks/codec';
import { ApiServer, startApiServer } from '../../../src/api/init.ts';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { migrate } from '../../test-helpers.ts';
import { TestBlockBuilder } from '../test-builders.ts';
import { BACKFILL_DISTRIBUTION_LOCKUP_SPLIT_SQL } from '../../../migrations/1779800000021_bond-reward-distribution-lockup-split.ts';

/**
 * `GET /extended/v3/staking/cycles/:cycle_number` — the per-cycle pox-5 staking summary — with
 * `current` / `previous` / `next` resolved from the burn tip and the PoX constants on `pox_state`.
 *
 * Geometry: cycles of 100 Bitcoin blocks from height 0 with a 10-block prepare phase. The fixture
 * tip is 1050, i.e. cycle 10's reward phase (1000-1099, prepare phase from 1090).
 */

const ADMIN = 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP';
const ALICE = 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6';
const BOB = 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y';
const CAROL = 'ST2REHHS5J3CERCRBEPMGH7921Q6PYKAADT7JP2VB';
const DAVE = 'ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5';
const ERIN = 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C';
const SIGNER = `${ADMIN}.signer-manager`;

const CONSTANTS = {
  firstBurnchainBlockHeight: 0,
  rewardCycleLength: 100,
  preparePhaseBlockLength: 10,
};
const TIP = 1050;

// Bond 0 covers cycles 8-19 (active at TIP); bond 1 covers cycles 11-22 (upcoming at TIP).
const BOND_ACTIVE = { index: 0, first_cycle: 8, unlock_cycle: 20, start: 800, unlock: 2000 };
const BOND_UPCOMING = { index: 1, first_cycle: 11, unlock_cycle: 23, start: 1100, unlock: 2300 };

interface StakingCycleResponse {
  number: number;
  status: string;
  schedule: {
    start: { bitcoin_height: number };
    prepare_phase_start: { bitcoin_height: number };
    end: { bitcoin_height: number };
  };
  locked: {
    stx: { stx_only: string; bonds: string; total: string };
    btc: { total: string; native: string; sbtc: string };
  };
  participants: { stakers: { stx_only: number; bonds: number }; signers: number | null };
  bonds: { total: number; indexes: number[] };
  rewards: {
    btc: {
      total: string;
      waterfall: { bonds: string; stx_only: string; reserve_deposit: string };
      claimed: string;
    };
  };
}

function setupBondData(bond: typeof BOND_ACTIVE) {
  return {
    bond_index: String(bond.index),
    target_rate: '300',
    stx_value_ratio: '10000000',
    min_ustx_ratio: '1000',
    early_unlock_bytes: '',
    first_reward_cycle: String(bond.first_cycle),
    bond_start_height: String(bond.start),
    unlock_cycle: String(bond.unlock_cycle),
    unlock_burn_height: String(bond.unlock),
  };
}

function registerData(args: {
  bond: typeof BOND_ACTIVE;
  staker: string;
  ustx: bigint;
  sats: bigint;
  /** Proven Bitcoin L1 lockup (`l1`, "native") or sBTC (`l2`, the default). */
  lockup?: 'l1' | 'l2';
}) {
  const lockup = args.lockup ?? 'l2';
  return {
    bond_index: String(args.bond.index),
    signer: SIGNER,
    staker: args.staker,
    amount_ustx: args.ustx.toString(),
    sats_total: args.sats.toString(),
    first_reward_cycle: String(args.bond.first_cycle),
    unlock_burn_height: String(args.bond.unlock),
    unlock_cycle: String(args.bond.unlock_cycle),
    is_l1_lock: lockup === 'l1',
    btc_lockup:
      lockup === 'l1'
        ? { type: 'l1', txs: [{ txid: '0x' + 'ab'.repeat(32), output_index: '0' }] }
        : { type: 'l2', txs: [] },
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

/** A `calculate-rewards` booked to `cycle`, with the given waterfall and STX-only stake. */
function calculateRewardsData(args: {
  cycle: number;
  height: number;
  bonds: bigint;
  stxOnly: bigint;
  reserve: bigint;
  cycleStakedUstx: bigint;
}) {
  return {
    bond_periods: [String(BOND_ACTIVE.index)],
    calculation_height: String(args.height),
    gross_accrued_rewards: (args.bonds + args.stxOnly + args.reserve).toString(),
    total_bond_rewards: args.bonds.toString(),
    reserve_deposit: args.reserve.toString(),
    reserve_balance: '0',
    stx_cycle: String(args.cycle),
    total_stx_staker_rewards: args.stxOnly.toString(),
    cycle_staked_ustx: args.cycleStakedUstx.toString(),
    // 1e18 fixed point: 1 sat per µSTX, so every live STX-only locker is credited a reward row.
    accrued_rewards_per_ustx: '1000000000000000000',
    cumulative_rewards_per_ustx: '1000000000000000000',
  };
}

function bondDistributionData(args: { bondRewards: bigint; stakedSats: bigint }) {
  return {
    bond_index: String(BOND_ACTIVE.index),
    target_yield: '300',
    bond_rewards: args.bondRewards.toString(),
    bond_staked_sats: args.stakedSats.toString(),
    accrued_rewards_per_sat: '1000000000000000000',
    cumulative_rewards_per_sat: '1000000000000000000',
  };
}

describe('staking cycle', () => {
  let db: PgWriteStore;
  let api: ApiServer;
  let height = 0;
  let lastIndexHash = '0x00';

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

  async function seedRewardSet(cycle: number, totalStacked: bigint, signers: number) {
    await db.sql`
      INSERT INTO pox_cycles (
        block_height, index_block_hash, parent_index_block_hash, cycle_number,
        canonical, total_weight, total_stacked_amount, total_signers
      )
      VALUES (1, ${'0x' + 'ee'.repeat(32)}, ${'0x' + 'ed'.repeat(32)}, ${cycle},
        true, ${signers}, ${totalStacked}, ${signers})
    `;
  }

  async function getCycle(selector: string): Promise<StakingCycleResponse> {
    const res = await supertest(api.server).get(`/extended/v3/staking/cycles/${selector}`);
    assert.equal(res.status, 200, `GET cycles/${selector} -> ${res.status}: ${res.text}`);
    return JSON.parse(res.text) as StakingCycleResponse;
  }

  /** Stakes, bonds, registrations, cycle 9's reward accounting, and reward sets for 9 and 10. */
  async function seedFixture() {
    await db.setPoxConstants(CONSTANTS);
    // alice's stake outlives the fixture tip; bob's expired before it.
    await db.update(
      nextBlock()
        .addTxPox5Event({ name: Pox5EventName.SetupBond, data: setupBondData(BOND_ACTIVE) })
        .addTxPox5Event({ name: Pox5EventName.SetupBond, data: setupBondData(BOND_UPCOMING) })
        .addTxPox5Event({
          name: Pox5EventName.Stake,
          data: stakeData({ staker: ALICE, ustx: 50_000_000n, unlock: 1500 }),
        })
        .addTxPox5Event({
          name: Pox5EventName.Stake,
          data: stakeData({ staker: BOB, ustx: 30_000_000n, unlock: 1040 }),
        })
        .addTxPox5Event({
          name: Pox5EventName.RegisterForBond,
          data: registerData({ bond: BOND_ACTIVE, staker: CAROL, ustx: 10_000_000n, sats: 1_000n }),
        })
        .addTxPox5Event({
          name: Pox5EventName.RegisterForBond,
          data: registerData({
            bond: BOND_ACTIVE,
            staker: DAVE,
            ustx: 20_000_000n,
            sats: 2_000n,
            lockup: 'l1',
          }),
        })
        .addTxPox5Event({
          name: Pox5EventName.RegisterForBond,
          data: registerData({ bond: BOND_UPCOMING, staker: ERIN, ustx: 5_000_000n, sats: 500n }),
        })
        .build()
    );
    // Cycle 9's rewards: two distributions (weekly runs), each with the bond's distribution in
    // the same tx, then a signer claim for the cycle.
    await db.update(
      nextBlock()
        .addTxPox5Event({
          name: Pox5EventName.CalculateRewards,
          data: calculateRewardsData({
            cycle: 9,
            height: 950,
            bonds: 400n,
            stxOnly: 500n,
            reserve: 100n,
            cycleStakedUstx: 40_000_000n,
          }),
        })
        .addTxPox5Event({
          name: Pox5EventName.BondDistribution,
          data: bondDistributionData({ bondRewards: 400n, stakedSats: 2_500n }),
        })
        .build()
    );
    // carol withdraws 400 of her 1000 sBTC before the second distribution.
    await db.update(
      nextBlock()
        .addTxPox5Event({
          name: Pox5EventName.UnstakeSbtc,
          data: {
            staker: CAROL,
            signer: SIGNER,
            bond_index: String(BOND_ACTIVE.index),
            amount_sats_released: '400',
            new_amount_sats: '600',
          },
        })
        .build()
    );
    await db.update(
      nextBlock()
        .addTxPox5Event({
          name: Pox5EventName.CalculateRewards,
          data: calculateRewardsData({
            cycle: 9,
            height: 999,
            bonds: 800n,
            stxOnly: 1_000n,
            reserve: 200n,
            cycleStakedUstx: 45_000_000n,
          }),
        })
        .addTxPox5Event({
          name: Pox5EventName.BondDistribution,
          data: bondDistributionData({ bondRewards: 800n, stakedSats: 2_600n }),
        })
        .addTxPox5Event({
          name: Pox5EventName.ClaimRewards,
          data: {
            signer_manager: SIGNER,
            reward_cycle: '9',
            stx_rewards: { earned: '200', rewards_per_token: '1' },
            bond_rewards: [
              { bond_index: String(BOND_ACTIVE.index), earned: '400', rewards_per_token: '1' },
            ],
            bond_totals: '400',
            total_rewards: '600',
          },
        })
        .build()
    );
    await seedRewardSet(9, 100_000_000n, 3);
    await seedRewardSet(10, 110_000_000n, 4);
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

  test('the current cycle: tip-state locks and participants, no rewards booked yet', async () => {
    await seedFixture();
    const cycle = await getCycle('current');
    assert.deepEqual(cycle, {
      number: 10,
      status: 'reward_phase',
      schedule: {
        start: { bitcoin_height: 1000 },
        prepare_phase_start: { bitcoin_height: 1090 },
        end: { bitcoin_height: 1099 },
      },
      locked: {
        // alice only (bob's lock expired at 1040 < tip); bond 0 is the only bond covering cycle 10.
        stx: { stx_only: '50000000', bonds: '30000000', total: '80000000' },
        // dave's 2000 sats are a native L1 lockup, carol's remaining 600 are sBTC.
        btc: { total: '2600', native: '2000', sbtc: '600' },
      },
      participants: { stakers: { stx_only: 1, bonds: 2 }, signers: 4 },
      bonds: { total: 1, indexes: [0] },
      rewards: {
        btc: {
          total: '0',
          waterfall: { bonds: '0', stx_only: '0', reserve_deposit: '0' },
          claimed: '0',
        },
      },
    });
    // A number resolves to the same cycle.
    assert.deepEqual(await getCycle('10'), cycle);
  });

  test("a finished cycle: the contract's reward accounting and running reward sums", async () => {
    await seedFixture();
    const cycle = await getCycle('previous');
    assert.equal(cycle.number, 9);
    assert.equal(cycle.status, 'finished');
    assert.deepEqual(cycle.schedule, {
      start: { bitcoin_height: 900 },
      prepare_phase_start: { bitcoin_height: 990 },
      end: { bitcoin_height: 999 },
    });
    // STX-only from the latest calculation, bonds = reward set total minus that, BTC from the
    // bond's latest distribution in the cycle.
    assert.deepEqual(cycle.locked, {
      stx: { stx_only: '45000000', bonds: '55000000', total: '100000000' },
      // The split is the snapshot taken at that distribution, after carol's unstake.
      btc: { total: '2600', native: '2000', sbtc: '600' },
    });
    // Both lockers were credited STX rewards at calculation time; bond stakers as of the tip.
    assert.deepEqual(cycle.participants, { stakers: { stx_only: 2, bonds: 2 }, signers: 3 });
    assert.deepEqual(cycle.bonds, { total: 1, indexes: [0] });
    // Sums over the two distributions; claimed from the signer claim.
    assert.deepEqual(cycle.rewards, {
      btc: {
        total: '3000',
        waterfall: { bonds: '1200', stx_only: '1500', reserve_deposit: '300' },
        claimed: '600',
      },
    });
    assert.deepEqual(await getCycle('9'), cycle);
  });

  test('an upcoming cycle: registrations so far, locks that outlive its start, no reward set', async () => {
    await seedFixture();
    const cycle = await getCycle('next');
    assert.equal(cycle.number, 11);
    assert.equal(cycle.status, 'upcoming');
    assert.deepEqual(cycle.schedule, {
      start: { bitcoin_height: 1100 },
      prepare_phase_start: { bitcoin_height: 1190 },
      end: { bitcoin_height: 1199 },
    });
    // alice's lock (unlock 1500) is still live when cycle 11 starts; both bonds cover cycle 11.
    assert.deepEqual(cycle.locked, {
      stx: { stx_only: '50000000', bonds: '35000000', total: '85000000' },
      btc: { total: '3100', native: '2000', sbtc: '1100' },
    });
    assert.deepEqual(cycle.participants, { stakers: { stx_only: 1, bonds: 3 }, signers: null });
    assert.deepEqual(cycle.bonds, { total: 2, indexes: [0, 1] });
    assert.equal(cycle.rewards.btc.total, '0');
  });

  test('the prepare phase belongs to the ending cycle; the next cycle stays upcoming', async () => {
    await seedFixture();
    await db.update(nextBlock({ burn_block_height: 1095 }).build());
    assert.equal((await getCycle('current')).status, 'prepare_phase');
    assert.equal((await getCycle('current')).number, 10);
    assert.equal((await getCycle('next')).status, 'upcoming');
    assert.equal((await getCycle('9')).status, 'finished');
    // Entering cycle 11's reward phase moves `current`.
    await db.update(nextBlock({ burn_block_height: 1100 }).build());
    const current = await getCycle('current');
    assert.equal(current.number, 11);
    assert.equal(current.status, 'reward_phase');
    assert.equal((await getCycle('10')).status, 'finished');
  });

  test('a fresh network with no pox-5 activity still answers with schedule and zeros', async () => {
    await db.setPoxConstants(CONSTANTS);
    await db.update(nextBlock().build());
    const cycle = await getCycle('current');
    assert.equal(cycle.number, 10);
    assert.deepEqual(cycle.locked, {
      stx: { stx_only: '0', bonds: '0', total: '0' },
      btc: { total: '0', native: '0', sbtc: '0' },
    });
    assert.deepEqual(cycle.participants, { stakers: { stx_only: 0, bonds: 0 }, signers: null });
    assert.deepEqual(cycle.bonds, { total: 0, indexes: [] });
  });

  test('selectors that resolve to no cycle are 404, malformed ones are 400', async () => {
    // Tip below the first PoX burn block: no cycle exists yet.
    await db.setPoxConstants({ ...CONSTANTS, firstBurnchainBlockHeight: 5000 });
    await db.update(nextBlock().build());
    for (const selector of ['current', 'previous', 'next']) {
      const res = await supertest(api.server).get(`/extended/v3/staking/cycles/${selector}`);
      assert.equal(res.status, 404, `${selector}: ${res.text}`);
    }
    // Explicit numbers are always answerable (a far-future cycle is simply upcoming).
    assert.equal((await getCycle('3')).status, 'upcoming');
    // `previous` of cycle 0.
    await db.setPoxConstants({
      ...CONSTANTS,
      firstBurnchainBlockHeight: 0,
      rewardCycleLength: 5000,
    });
    assert.equal((await getCycle('current')).number, 0);
    assert.equal(
      (await supertest(api.server).get('/extended/v3/staking/cycles/previous')).status,
      404
    );
    for (const bad of ['latest', '-1', '1.5', '']) {
      const res = await supertest(api.server).get(`/extended/v3/staking/cycles/${bad}`);
      assert.ok(res.status === 400 || res.status === 404, `${bad}: ${res.status}`);
    }
  });

  test('without persisted constants the mainnet geometry applies', async () => {
    // No setPoxConstants: the read side falls back to mainnet, under which a tip of 1050 precedes
    // PoX, so aliases are 404 while explicit numbers use the mainnet schedule.
    await db.update(nextBlock().build());
    assert.equal(
      (await supertest(api.server).get('/extended/v3/staking/cycles/current')).status,
      404
    );
    const cycle = await getCycle('143');
    assert.deepEqual(cycle.schedule, {
      start: { bitcoin_height: 966350 },
      prepare_phase_start: { bitcoin_height: 968350 },
      end: { bitcoin_height: 968449 },
    });
    assert.equal(cycle.status, 'upcoming');
  });

  test('each distribution snapshots the native / sBTC split, and the backfill rebuilds it from events', async () => {
    await seedFixture();
    const rows = () =>
      db.sql<
        {
          bond_staked_sats: string;
          native_staked_sats: string | null;
          sbtc_staked_sats: string | null;
        }[]
      >`
        SELECT bond_staked_sats::text, native_staked_sats::text, sbtc_staked_sats::text
        FROM bond_reward_distributions
        WHERE canonical = TRUE
        ORDER BY block_height ASC
      `;
    // Snapshotted at ingestion: 1000 sBTC + 2000 native at the first distribution, 600 sBTC after
    // carol's unstake at the second.
    const expected = [
      { bond_staked_sats: '2500', native_staked_sats: '2000', sbtc_staked_sats: '1000' },
      { bond_staked_sats: '2600', native_staked_sats: '2000', sbtc_staked_sats: '600' },
    ];
    assert.deepEqual([...(await rows())], expected);

    // Reset the split to the column default (a row that predates the columns) and rebuild it from
    // pox5_events.
    await db.sql`UPDATE bond_reward_distributions SET native_staked_sats = 0, sbtc_staked_sats = 0`;
    const wiped = await getCycle('previous');
    assert.deepEqual(wiped.locked.btc, { total: '2600', native: '0', sbtc: '0' });
    await db.sql.unsafe(BACKFILL_DISTRIBUTION_LOCKUP_SPLIT_SQL);
    assert.deepEqual([...(await rows())], expected);
    assert.deepEqual((await getCycle('previous')).locked.btc, {
      total: '2600',
      native: '2000',
      sbtc: '600',
    });
  });

  test('the backfill treats a roll-over out of the bond as releasing its BTC', async () => {
    await seedFixture();
    // dave rolls his bond-0 position into an STX-only stake, then a third distribution runs.
    await db.update(
      nextBlock()
        .addTxPox5Event({
          name: Pox5EventName.Stake,
          data: stakeData({ staker: DAVE, ustx: 21_000_000n, unlock: 1500 }),
        })
        .build()
    );
    await db.update(
      nextBlock()
        .addTxPox5Event({
          name: Pox5EventName.CalculateRewards,
          data: calculateRewardsData({
            cycle: 10,
            height: 1050,
            bonds: 100n,
            stxOnly: 100n,
            reserve: 10n,
            cycleStakedUstx: 71_000_000n,
          }),
        })
        .addTxPox5Event({
          name: Pox5EventName.BondDistribution,
          data: bondDistributionData({ bondRewards: 100n, stakedSats: 600n }),
        })
        .build()
    );
    const latest = () =>
      db.sql<{ native_staked_sats: string; sbtc_staked_sats: string }[]>`
        SELECT native_staked_sats::text, sbtc_staked_sats::text
        FROM bond_reward_distributions
        WHERE canonical = TRUE
        ORDER BY block_height DESC
        LIMIT 1
      `;
    assert.deepEqual([...(await latest())], [{ native_staked_sats: '0', sbtc_staked_sats: '600' }]);
    await db.sql`UPDATE bond_reward_distributions SET native_staked_sats = 0, sbtc_staked_sats = 0`;
    await db.sql.unsafe(BACKFILL_DISTRIBUTION_LOCKUP_SPLIT_SQL);
    assert.deepEqual([...(await latest())], [{ native_staked_sats: '0', sbtc_staked_sats: '600' }]);
  });

  test('serves a combined-tip ETag and answers 304 when unchanged', async () => {
    await seedFixture();
    const first = await supertest(api.server).get('/extended/v3/staking/cycles/current');
    assert.equal(first.status, 200);
    const etag = first.headers['etag'];
    assert.ok(etag);
    const second = await supertest(api.server)
      .get('/extended/v3/staking/cycles/current')
      .set('If-None-Match', etag);
    assert.equal(second.status, 304);
    await db.updateBurnChainBlockHeight({ blockHeight: TIP + 1 });
    const third = await supertest(api.server)
      .get('/extended/v3/staking/cycles/current')
      .set('If-None-Match', etag);
    assert.equal(third.status, 200);
  });
});
