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
 * pox-5 projected bonds: `GET /extended/v3/staking/bonds/:index` for a bond that is not set up
 * yet, simulated with `TestBlockBuilder` like `bonds.test.ts`. Kept in its own file (and so its own
 * test process) because `bonds.test.ts` already runs close to the heap limit under coverage.
 */

const iso = (time: number) => new Date(time * 1000).toISOString();
/** A schedule point whose Bitcoin block is projected to be mined at `time`. */
const projectedAt = (time: number) => ({
  time: null,
  time_iso: null,
  projected_time: time,
  projected_time_iso: iso(time),
});

describe('pox-5 projected bonds (GET .../bonds/:index)', () => {
  let db: PgWriteStore;
  let api: ApiServer;

  // A geometry where bond period 0 starts at cycle 8 (height 160): bond `i` starts at cycle
  // `8 + 2i`, height `20 * (8 + 2i)`, and unlocks 12 cycles later.
  const FIRST_BOND_PERIOD_CYCLE = 8;
  const burnTime = (burnHeight: number) => 1_700_000_000 + burnHeight * 540;

  function setupBondData(bondIndex: number) {
    const firstRewardCycle = FIRST_BOND_PERIOD_CYCLE + bondIndex * 2;
    return {
      bond_index: String(bondIndex),
      target_rate: '300',
      stx_value_ratio: '10000000',
      min_ustx_ratio: '1000',
      early_unlock_bytes: '',
      first_reward_cycle: String(firstRewardCycle),
      bond_start_height: String(firstRewardCycle * 20),
      unlock_cycle: String(firstRewardCycle + 12),
      unlock_burn_height: String((firstRewardCycle + 12) * 20),
    };
  }

  /** Ingest a block anchored to `burnHeight`, optionally setting up a bond. */
  async function ingestBlock(args: {
    height: number;
    hash: string;
    parent?: string;
    burnHeight: number;
    setupBondIndex?: number;
  }) {
    const builder = new TestBlockBuilder({
      block_height: args.height,
      block_hash: args.hash,
      index_block_hash: args.hash,
      parent_block_hash: args.parent,
      parent_index_block_hash: args.parent,
      burn_block_height: args.burnHeight,
      burn_block_time: burnTime(args.burnHeight),
    });
    if (args.setupBondIndex !== undefined) {
      builder.addTx({ tx_id: '0x' + args.hash.slice(2).padStart(64, '0') }).addTxPox5Event({
        name: Pox5EventName.SetupBond,
        data: setupBondData(args.setupBondIndex),
      });
    }
    await db.update(builder.build());
  }

  async function getBond(index: number) {
    const res = await supertest(api.server).get(`/extended/v3/staking/bonds/${index}`);
    return { status: res.status, body: JSON.parse(res.text) as Record<string, unknown> };
  }

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    api = await startApiServer({ datastore: db, chainId: STACKS_TESTNET.chainId });
    await db.setPoxConstants({
      firstBurnchainBlockHeight: 0,
      rewardCycleLength: 20,
      preparePhaseBlockLength: 5,
    });
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await migrate('down');
  });

  test('a bond not set up yet is projected from its index, anchored on any set-up bond', async () => {
    // Only bond 2 (cycle 12) is set up; the Bitcoin tip is 140, 9 minutes per block.
    await ingestBlock({ height: 1, hash: '0xa1', burnHeight: 130, setupBondIndex: 2 });
    await ingestBlock({ height: 2, hash: '0xa2', parent: '0xa1', burnHeight: 140 });

    const bond4 = await getBond(4);
    assert.equal(bond4.status, 200);
    assert.deepEqual(bond4.body, {
      index: 4,
      status: 'projected',
      schedule: {
        enrollment_cutoff: { bitcoin_height: 315, pox_cycle: 15, ...projectedAt(burnTime(315)) },
        activation: { bitcoin_height: 320, pox_cycle: 16, ...projectedAt(burnTime(320)) },
        unlock: { bitcoin_height: 560, pox_cycle: 28, ...projectedAt(burnTime(560)) },
      },
    });

    // A lower index than the anchor bond's projects too, while its activation is ahead of the tip.
    const bond0 = await getBond(0);
    assert.equal(bond0.status, 200);
    assert.equal(bond0.body.status, 'projected');
    assert.deepEqual((bond0.body.schedule as Record<string, unknown>).activation, {
      bitcoin_height: 160,
      pox_cycle: 8,
      ...projectedAt(burnTime(160)),
    });

    // The set-up bond is returned in full, and the list only carries set-up bonds.
    const bond2 = await getBond(2);
    assert.equal(bond2.body.status, 'upcoming');
    assert.ok(bond2.body.transaction);
    const list = await supertest(api.server).get('/extended/v3/staking/bonds');
    assert.deepEqual(
      (JSON.parse(list.text) as { results: { index: number }[] }).results.map(b => b.index),
      [2]
    );
  });

  test('a bond whose activation height has been reached is not projected', async () => {
    await ingestBlock({ height: 1, hash: '0xa1', burnHeight: 130, setupBondIndex: 2 });
    // Bond 1 activates at 200: once the tip reaches it, `setup-bond` can no longer create it.
    await ingestBlock({ height: 2, hash: '0xa2', parent: '0xa1', burnHeight: 200 });
    assert.equal((await getBond(1)).status, 404);
    assert.equal((await getBond(0)).status, 404);
    assert.equal((await getBond(-1)).status, 404);
    const bond3 = await getBond(3);
    assert.equal(bond3.status, 200);
    assert.equal(bond3.body.status, 'projected');
  });

  test('a negative index is never projected', async () => {
    // With the tip at 100, index -1 (cycle 6, height 120) would still be ahead of it.
    await ingestBlock({ height: 1, hash: '0xa1', burnHeight: 100, setupBondIndex: 0 });
    assert.equal((await getBond(-1)).status, 404);
    assert.equal((await getBond(1)).body.status, 'projected');
  });

  test('no bond is projected before any bond has been set up', async () => {
    await ingestBlock({ height: 1, hash: '0xa1', burnHeight: 130 });
    assert.equal((await getBond(0)).status, 404);
    assert.equal((await getBond(5)).status, 404);
  });

  test('a projected bond is returned in full once set up, and projected again if orphaned', async () => {
    await ingestBlock({ height: 1, hash: '0xa1', burnHeight: 130, setupBondIndex: 2 });
    assert.equal((await getBond(3)).body.status, 'projected');

    // Fork A sets up bond 3.
    await ingestBlock({
      height: 2,
      hash: '0xa2',
      parent: '0xa1',
      burnHeight: 140,
      setupBondIndex: 3,
    });
    const setUp = await getBond(3);
    assert.equal(setUp.status, 200);
    assert.equal(setUp.body.status, 'upcoming');
    assert.ok(setUp.body.transaction);

    // Fork B overtakes it without the setup.
    await ingestBlock({ height: 2, hash: '0xb2', parent: '0xa1', burnHeight: 140 });
    await ingestBlock({ height: 3, hash: '0xb3', parent: '0xb2', burnHeight: 145 });
    const orphaned = await getBond(3);
    assert.equal(orphaned.status, 200);
    assert.equal(orphaned.body.status, 'projected');
    assert.equal(orphaned.body.transaction, undefined);
  });
});
