import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { STACKS_MAINNET, STACKS_TESTNET } from '@stacks/network';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { migrate } from '../../test-helpers.ts';
import { TestBlockBuilder } from '../test-builders.ts';
import {
  BitcoinBlockTimeProjectionConfig,
  BitcoinBlockTimes,
  projectBitcoinBlockTime,
  getBitcoinBlockPace,
  getBitcoinBlockTimeProjectionConfig,
  interpolateBitcoinBlockTime,
} from '../../../src/datastore/bitcoin-block-time.ts';

/**
 * Bitcoin block times: the projection arithmetic, and how the store picks the samples it
 * extrapolates from.
 */

const MAINNET: BitcoinBlockTimeProjectionConfig = {
  paceWindowBlocks: 2016,
  targetBlockTimeSeconds: 600,
  revertToTargetAfterRetarget: true,
};
const OTHER_NETWORK: BitcoinBlockTimeProjectionConfig = {
  ...MAINNET,
  revertToTargetAfterRetarget: false,
};

/** A tip two blocks before the 4032 retarget, after a window mined at 9 minutes per block. */
const TIMES: BitcoinBlockTimes = {
  confirmed: new Map(),
  interpolated: new Map(),
  tip: { height: 4030, time: 1_000_000 + 2016 * 540 },
  paceWindowStart: { height: 2014, time: 1_000_000 },
};

describe('bitcoin block time projections', () => {
  test('the pace is measured over the window, falling back to the target when unmeasurable', () => {
    assert.equal(getBitcoinBlockPace(TIMES, MAINNET), 540);
    // A window that spans nothing, or measures time running backwards, is unmeasurable.
    const tip = TIMES.tip!;
    assert.equal(getBitcoinBlockPace({ ...TIMES, paceWindowStart: tip }, MAINNET), 600);
    assert.equal(
      getBitcoinBlockPace(
        { ...TIMES, paceWindowStart: { height: 2014, time: tip.time + 1 } },
        MAINNET
      ),
      600
    );
    assert.equal(getBitcoinBlockPace({ ...TIMES, paceWindowStart: null }, MAINNET), 600);
  });

  test('on mainnet, blocks after the next retarget revert to the target interval', () => {
    const tip = TIMES.tip!;
    // 4031 is the last block of the current difficulty period: still at the measured pace.
    assert.equal(projectBitcoinBlockTime(TIMES, MAINNET, 4031), tip.time + 540);
    // 4032 is the first block mined at the new difficulty.
    assert.equal(projectBitcoinBlockTime(TIMES, MAINNET, 4032), tip.time + 540 + 600);
    assert.equal(projectBitcoinBlockTime(TIMES, MAINNET, 4035), tip.time + 540 + 4 * 600);
  });

  test('elsewhere, the measured pace applies throughout', () => {
    const tip = TIMES.tip!;
    assert.equal(projectBitcoinBlockTime(TIMES, OTHER_NETWORK, 4031), tip.time + 540);
    assert.equal(projectBitcoinBlockTime(TIMES, OTHER_NETWORK, 4035), tip.time + 5 * 540);
  });

  test('mined, unknown-tip, and undatable heights have no projection', () => {
    assert.equal(projectBitcoinBlockTime(TIMES, MAINNET, 4030), null);
    assert.equal(projectBitcoinBlockTime(TIMES, MAINNET, 100), null);
    assert.equal(projectBitcoinBlockTime({ ...TIMES, tip: null }, MAINNET, 5000), null);
    // Past the end of year 9999, where ISO 8601 renderings switch to expanded years.
    assert.equal(projectBitcoinBlockTime(TIMES, MAINNET, 1_000_000_000), null);
    assert.equal(projectBitcoinBlockTime(TIMES, MAINNET, 99_999_999_999), null);
    // The last block projected within year 9999 still has a projection.
    const tip = TIMES.tip!;
    const lastHeight = 4031 + Math.floor((253_402_300_799 - (tip.time + 540)) / 600);
    const last = projectBitcoinBlockTime(TIMES, MAINNET, lastHeight);
    assert.ok(last !== null && new Date(last * 1000).toISOString().startsWith('9999-'));
    assert.equal(projectBitcoinBlockTime(TIMES, MAINNET, lastHeight + 1), null);
  });

  test('past blocks without a known time are interpolated between their neighbors', () => {
    const before = { height: 100, time: 10_000 };
    const after = { height: 104, time: 12_000 };
    assert.equal(interpolateBitcoinBlockTime(before, after, 101), 10_500);
    assert.equal(interpolateBitcoinBlockTime(before, after, 103), 11_500);
    // Rounded to whole seconds.
    assert.equal(interpolateBitcoinBlockTime(before, { height: 103, time: 10_001 }, 101), 10_000);
    // Miner-set header times can run backwards; the estimate stays between the two.
    assert.equal(interpolateBitcoinBlockTime(before, { height: 102, time: 9_000 }, 101), 9_500);
  });

  test('the config reverts to the target after retargets on mainnet only', () => {
    assert.deepEqual(getBitcoinBlockTimeProjectionConfig(STACKS_MAINNET.chainId), MAINNET);
    assert.deepEqual(getBitcoinBlockTimeProjectionConfig(STACKS_TESTNET.chainId), OTHER_NETWORK);
  });
});

describe('bitcoin block time samples (PgStoreV3.getBitcoinBlockTimes)', () => {
  let db: PgWriteStore;
  let height = 0;
  let parent = '0x00';

  async function anchor(burnHeight: number, burnTime: number) {
    height += 1;
    const hash = '0x' + height.toString(16).padStart(4, '0');
    await db.update(
      new TestBlockBuilder({
        block_height: height,
        block_hash: hash,
        index_block_hash: hash,
        parent_block_hash: parent,
        parent_index_block_hash: parent,
        burn_block_height: burnHeight,
        burn_block_time: burnTime,
      }).build()
    );
    parent = hash;
  }

  beforeEach(async () => {
    height = 0;
    parent = '0x00';
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

  test('the window starts at the newest known block at least the window behind the tip', async () => {
    await anchor(100, 10_000);
    await anchor(150, 15_000);
    await anchor(195, 19_500);
    await anchor(220, 22_000);
    await anchor(300, 30_000);
    const times = await db.v3.getBitcoinBlockTimes([150, 200, 300, 400], 100);
    assert.deepEqual(times.tip, { height: 300, time: 30_000 });
    // 300 - 100 = 200: the newest known block at or below it is 195.
    assert.deepEqual(times.paceWindowStart, { height: 195, time: 19_500 });
    // Only heights a canonical Stacks block anchored to are confirmed.
    assert.deepEqual(
      times.confirmed,
      new Map([
        [150, 15_000],
        [300, 30_000],
      ])
    );
    // 200 is past but unanchored: interpolated between 195 and 220. 400 is beyond the tip.
    assert.deepEqual(times.interpolated, new Map([[200, 20_000]]));
  });

  test('past heights older than any anchored block are not interpolated', async () => {
    await anchor(100, 10_000);
    await anchor(150, 15_000);
    const times = await db.v3.getBitcoinBlockTimes([50, 120], 2016);
    assert.deepEqual(times.confirmed, new Map());
    assert.deepEqual(times.interpolated, new Map([[120, 12_000]]));
  });

  test('interpolation skips non-canonical anchors', async () => {
    const block = (args: {
      height: number;
      hash: string;
      parent: string;
      burnHeight: number;
      burnTime: number;
    }) =>
      new TestBlockBuilder({
        block_height: args.height,
        block_hash: args.hash,
        index_block_hash: args.hash,
        parent_block_hash: args.parent,
        parent_index_block_hash: args.parent,
        burn_block_height: args.burnHeight,
        burn_block_time: args.burnTime,
      }).build();
    await db.update(
      block({ height: 1, hash: '0x0001', parent: '0x00', burnHeight: 100, burnTime: 10_000 })
    );
    // A fork anchored to 105 with an outlying header time, orphaned by the longer chain below.
    await db.update(
      block({ height: 2, hash: '0x0a02', parent: '0x0001', burnHeight: 105, burnTime: 99_999 })
    );
    await db.update(
      block({ height: 2, hash: '0x0b02', parent: '0x0001', burnHeight: 110, burnTime: 11_000 })
    );
    await db.update(
      block({ height: 3, hash: '0x0b03', parent: '0x0b02', burnHeight: 120, burnTime: 12_000 })
    );
    const times = await db.v3.getBitcoinBlockTimes([105], 2016);
    assert.deepEqual(times.confirmed, new Map());
    assert.deepEqual(times.interpolated, new Map([[105, 10_500]]));
  });

  test('an empty chain has no samples', async () => {
    const times = await db.v3.getBitcoinBlockTimes([100], 2016);
    assert.deepEqual(times, {
      confirmed: new Map(),
      interpolated: new Map(),
      tip: null,
      paceWindowStart: null,
    });
  });
});
