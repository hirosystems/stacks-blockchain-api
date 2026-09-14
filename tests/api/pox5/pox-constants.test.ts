import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { STACKS_MAINNET, STACKS_TESTNET } from '@stacks/network';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { migrate } from '../../test-helpers.ts';
import {
  MAINNET_POX_CONSTANTS,
  PoxConstants,
  PoxConstantsRepository,
  PoxInfoClient,
  burnHeightToRewardCycle,
  ensurePoxConstants,
  getPoxCyclePhase,
  getPoxCycleSchedule,
  poxConstantsFromNodeInfo,
  rewardCycleToBurnHeight,
  validatePoxConstants,
} from '../../../src/pox-constants.ts';

/**
 * PoX constants: the writer's one-time `ensurePoxConstants` (pox_state → mainnet → node), the
 * read side (`PgStore.getPoxConstants`), and the cycle arithmetic. The mainnet expectations are
 * the figures `/v2/pox` reported on mainnet during cycle 143.
 */

/** A `/v2/pox` payload carrying the given geometry (only the fields the loader reads matter). */
function poxInfo(c: PoxConstants) {
  return {
    first_burnchain_block_height: c.firstBurnchainBlockHeight,
    reward_cycle_length: c.rewardCycleLength,
    prepare_phase_block_length: c.preparePhaseBlockLength,
  };
}

/** A stub core RPC client whose `/v2/pox` fails `failures` times before answering `info`. */
function stubClient(info: unknown, failures = 0): PoxInfoClient & { calls: number } {
  const client = {
    calls: 0,
    request: async (_method: string, path: string) => {
      assert.equal(path, '/v2/pox');
      client.calls++;
      if (client.calls <= failures) throw new Error('node unavailable');
      return info;
    },
  };
  return client as unknown as PoxInfoClient & { calls: number };
}

/** An in-memory `pox_state` stand-in. */
function stubRepo(initial?: PoxConstants): PoxConstantsRepository & {
  stored?: PoxConstants;
  writes: number;
} {
  const repo = {
    stored: initial,
    writes: 0,
    getStoredPoxConstants: async () => repo.stored,
    setPoxConstants: async (c: PoxConstants) => {
      repo.writes++;
      repo.stored = { ...c };
    },
  };
  return repo;
}

const TESTNET: PoxConstants = {
  firstBurnchainBlockHeight: 2_000_000,
  rewardCycleLength: 1050,
  preparePhaseBlockLength: 50,
};

describe('ensurePoxConstants', () => {
  test('returns persisted pox_state values and skips the node entirely', async () => {
    const client = stubClient(poxInfo(MAINNET_POX_CONSTANTS));
    const repo = stubRepo(TESTNET);
    const constants = await ensurePoxConstants({
      db: repo,
      client,
      chainId: STACKS_TESTNET.chainId,
      retryIntervalMs: 1,
    });
    assert.equal(client.calls, 0, 'no /v2/pox call');
    assert.deepEqual(constants, TESTNET);
    assert.equal(repo.writes, 0);
  });

  test('on mainnet with an empty DB, persists the hardcoded constants without calling the node', async () => {
    const client = stubClient(poxInfo(TESTNET));
    const repo = stubRepo();
    const constants = await ensurePoxConstants({
      db: repo,
      client,
      chainId: STACKS_MAINNET.chainId,
      retryIntervalMs: 1,
    });
    assert.equal(client.calls, 0, 'no /v2/pox call');
    assert.deepEqual(constants, MAINNET_POX_CONSTANTS);
    assert.equal(repo.writes, 1);
    assert.deepEqual(repo.stored, MAINNET_POX_CONSTANTS);
  });

  test('on a non-mainnet chain with an empty DB, asks the node until it answers, then persists', async () => {
    const client = stubClient(poxInfo(TESTNET), 2);
    const repo = stubRepo();
    const constants = await ensurePoxConstants({
      db: repo,
      client,
      chainId: STACKS_TESTNET.chainId,
      retryIntervalMs: 1,
    });
    assert.equal(client.calls, 3);
    assert.deepEqual(constants, TESTNET);
    assert.equal(repo.writes, 1);
    assert.deepEqual(repo.stored, TESTNET);
  });

  test('keeps retrying past an invalid payload and rejects when aborted', async () => {
    const client = stubClient(poxInfo({ ...TESTNET, rewardCycleLength: 1 }));
    const repo = stubRepo();
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    await assert.rejects(
      ensurePoxConstants({
        db: repo,
        client,
        chainId: STACKS_TESTNET.chainId,
        retryIntervalMs: 1,
        signal: controller.signal,
      }),
      /aborted/
    );
    assert.ok(client.calls >= 2, `retried (${client.calls} calls)`);
    assert.equal(repo.writes, 0, 'invalid geometry never persisted');
  });

  test('rejects geometries the node would never run with', () => {
    const valid: PoxConstants = { ...MAINNET_POX_CONSTANTS };
    assert.doesNotThrow(() => validatePoxConstants(valid));
    assert.throws(
      () => validatePoxConstants({ ...valid, firstBurnchainBlockHeight: -1 }),
      /first burnchain block height/
    );
    assert.throws(() => validatePoxConstants({ ...valid, rewardCycleLength: 1 }), /reward cycle/);
    assert.throws(
      () => validatePoxConstants({ ...valid, preparePhaseBlockLength: 0 }),
      /prepare phase/
    );
    // The prepare phase must leave room for a reward phase.
    assert.throws(
      () => validatePoxConstants({ ...valid, preparePhaseBlockLength: 2100 }),
      /prepare phase/
    );
    assert.throws(
      () => poxConstantsFromNodeInfo(poxInfo({ ...TESTNET, preparePhaseBlockLength: 1050 })),
      /prepare phase/
    );
    assert.deepEqual(poxConstantsFromNodeInfo(poxInfo(TESTNET)), TESTNET);
  });
});

describe('pox constants persistence (pox_state)', () => {
  let db: PgWriteStore;

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
  });

  afterEach(async () => {
    await db?.close();
    await migrate('down');
  });

  test('a fresh database reads as mainnet defaults until the writer persists the network values', async () => {
    assert.equal(await db.getStoredPoxConstants(), undefined);
    assert.deepEqual(await db.getPoxConstants(), MAINNET_POX_CONSTANTS);

    // The writer establishes them once (here: a non-mainnet chain answered by the node).
    const client = stubClient(poxInfo(TESTNET));
    await ensurePoxConstants({ db, client, chainId: STACKS_TESTNET.chainId, retryIntervalMs: 1 });
    assert.equal(client.calls, 1);
    assert.deepEqual(await db.getStoredPoxConstants(), TESTNET);
    // Read-only APIs see the persisted values.
    assert.deepEqual(await db.getPoxConstants(), TESTNET);

    // A later writer start finds them on pox_state and never contacts the node.
    const unreachable = stubClient(undefined, Number.MAX_SAFE_INTEGER);
    const again = await ensurePoxConstants({
      db,
      client: unreachable,
      chainId: STACKS_TESTNET.chainId,
      retryIntervalMs: 1,
    });
    assert.equal(unreachable.calls, 0);
    assert.deepEqual(again, TESTNET);
  });
});

describe('pox cycle arithmetic', () => {
  const c = MAINNET_POX_CONSTANTS;

  test('maps Bitcoin heights to reward cycles like the node', () => {
    assert.equal(burnHeightToRewardCycle(c, 666050), 0);
    assert.equal(burnHeightToRewardCycle(c, 668149), 0);
    assert.equal(burnHeightToRewardCycle(c, 668150), 1);
    // Mainnet during cycle 143: tip 966391 per /v2/pox.
    assert.equal(burnHeightToRewardCycle(c, 966391), 143);
    // The prepare phase belongs to the cycle it ends, by the arithmetic.
    assert.equal(burnHeightToRewardCycle(c, 968350), 143);
    assert.equal(burnHeightToRewardCycle(c, 968449), 143);
    assert.equal(burnHeightToRewardCycle(c, 968450), 144);
    assert.throws(() => burnHeightToRewardCycle(c, 666049), /precedes the first PoX/);
  });

  test('computes cycle start heights and schedules', () => {
    assert.equal(rewardCycleToBurnHeight(c, 0), 666050);
    assert.equal(rewardCycleToBurnHeight(c, 143), 966350);
    assert.equal(rewardCycleToBurnHeight(c, 144), 968450);
    // Matches /v2/pox: reward phase start 966350, next prepare phase start 968350, next reward
    // phase start 968450.
    assert.deepEqual(getPoxCycleSchedule(c, 143), {
      startBitcoinHeight: 966350,
      preparePhaseStartBitcoinHeight: 968350,
      endBitcoinHeight: 968449,
    });
    // Consecutive cycles tile the chain with no gap or overlap.
    assert.equal(
      getPoxCycleSchedule(c, 143).endBitcoinHeight + 1,
      getPoxCycleSchedule(c, 144).startBitcoinHeight
    );
  });

  test('derives the phase of a cycle from the burn tip', () => {
    assert.equal(getPoxCyclePhase(c, 143, 966349), 'upcoming');
    assert.equal(getPoxCyclePhase(c, 143, 966350), 'reward_phase');
    assert.equal(getPoxCyclePhase(c, 143, 968349), 'reward_phase');
    assert.equal(getPoxCyclePhase(c, 143, 968350), 'prepare_phase');
    assert.equal(getPoxCyclePhase(c, 143, 968449), 'prepare_phase');
    assert.equal(getPoxCyclePhase(c, 143, 968450), 'finished');
    // While 143 is in its prepare phase, 144 is still upcoming.
    assert.equal(getPoxCyclePhase(c, 144, 968400), 'upcoming');
  });

  test('works for a small custom geometry', () => {
    const small: PoxConstants = {
      firstBurnchainBlockHeight: 0,
      rewardCycleLength: 100,
      preparePhaseBlockLength: 10,
    };
    assert.equal(burnHeightToRewardCycle(small, 1000), 10);
    assert.deepEqual(getPoxCycleSchedule(small, 10), {
      startBitcoinHeight: 1000,
      preparePhaseStartBitcoinHeight: 1090,
      endBitcoinHeight: 1099,
    });
    assert.equal(getPoxCyclePhase(small, 10, 1095), 'prepare_phase');
  });
});
