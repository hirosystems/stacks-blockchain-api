import { describe, test, beforeEach, afterEach } from 'node:test';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { ApiServer, startApiServer } from '../../../src/api/init.ts';
import { migrate } from '../../test-helpers.ts';
import { STACKS_TESTNET } from '@stacks/network';
import * as assert from 'node:assert/strict';
import { hex } from '../test-helpers.ts';
import { TestBlockBuilder } from '../test-builders.ts';
import { I32_MAX } from '../../../src/helpers.ts';

/** The times of a Bitcoin block the API has learned no time for. */
const NO_TIME = { time: null, time_iso: null, projected_time: null, projected_time_iso: null };
/** The counts of a Bitcoin block no Stacks block has anchored to. */
const NONE_ANCHORED = { stacks_block_count: 0, tx_count: 0 };
/** The counts of a Bitcoin block one Stacks block with no transactions anchored to. */
const ONE_ANCHORED = { stacks_block_count: 1, tx_count: 0 };

describe('v3 bitcoin blocks', () => {
  let db: PgWriteStore;
  let api: ApiServer;

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

  async function addBitcoinBlock(height: number, hash: string = hex(0xbb00 + height)) {
    await db.updateBurnchainBlock({
      burnchainBlockHash: hash,
      burnchainBlockHeight: height,
      burnAmount: 0n,
      rewardAmount: 0n,
    });
    // As `/new_burn_block` ingestion does.
    await db.updateBurnChainBlockHeight({ blockHeight: height });
  }

  async function getJson(url: string) {
    const response = await api.fastifyApp.inject({ method: 'GET', url });
    assert.equal(response.statusCode, 200);
    return JSON.parse(response.body);
  }

  describe('/v3/bitcoin-blocks', () => {
    test('returns an empty page when there are no blocks', async () => {
      assert.deepEqual(await getJson('/extended/v3/bitcoin-blocks'), {
        limit: 20,
        total: 0,
        cursor: { next: null, previous: null, current: null },
        results: [],
      });
    });

    test('paginates canonical block summaries newest first', async () => {
      // Heights are not contiguous: pages and cursors follow the stored heights.
      for (const height of [100, 101, 102, 104, 105]) {
        await addBitcoinBlock(height);
      }
      const first = await getJson('/extended/v3/bitcoin-blocks?limit=2');
      assert.equal(first.total, 5);
      assert.deepEqual(first.results, [
        { height: 105, hash: hex(0xbb00 + 105), ...NO_TIME, ...NONE_ANCHORED },
        { height: 104, hash: hex(0xbb00 + 104), ...NO_TIME, ...NONE_ANCHORED },
      ]);
      assert.deepEqual(first.cursor, { next: '102', previous: null, current: '105' });

      const second = await getJson(
        `/extended/v3/bitcoin-blocks?limit=2&cursor=${first.cursor.next}`
      );
      assert.deepEqual(
        second.results.map((r: { height: number }) => r.height),
        [102, 101]
      );
      assert.deepEqual(second.cursor, { next: '100', previous: '105', current: '102' });

      const last = await getJson(
        `/extended/v3/bitcoin-blocks?limit=2&cursor=${second.cursor.next}`
      );
      assert.deepEqual(
        last.results.map((r: { height: number }) => r.height),
        [100]
      );
      assert.deepEqual(last.cursor, { next: null, previous: '102', current: '100' });

      // A cursor between stored heights starts the page at the next lower height.
      const between = await getJson('/extended/v3/bitcoin-blocks?limit=2&cursor=103');
      assert.deepEqual(
        between.results.map((r: { height: number }) => r.height),
        [102, 101]
      );
    });

    test('excludes orphaned blocks and keeps the total in step through forks', async () => {
      await addBitcoinBlock(100);
      await addBitcoinBlock(101);
      // A same-height replacement orphans the original block at 101.
      await addBitcoinBlock(101, hex(0xf101));
      let body = await getJson('/extended/v3/bitcoin-blocks');
      assert.equal(body.total, 2);
      assert.deepEqual(body.results, [
        { height: 101, hash: hex(0xf101), ...NO_TIME, ...NONE_ANCHORED },
        { height: 100, hash: hex(0xbb00 + 100), ...NO_TIME, ...NONE_ANCHORED },
      ]);

      // Re-delivering the canonical block is idempotent.
      await addBitcoinBlock(101, hex(0xf101));
      body = await getJson('/extended/v3/bitcoin-blocks');
      assert.equal(body.total, 2);

      // The original block winning back restores it without double counting.
      await addBitcoinBlock(101);
      body = await getJson('/extended/v3/bitcoin-blocks');
      assert.equal(body.total, 2);
      assert.deepEqual(body.results[0], {
        height: 101,
        hash: hex(0xbb00 + 101),
        ...NO_TIME,
        ...NONE_ANCHORED,
      });
    });

    test('rejects invalid cursors', async () => {
      const malformed = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/bitcoin-blocks?cursor=abc',
      });
      assert.equal(malformed.statusCode, 400);

      const outOfRange = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/bitcoin-blocks?cursor=${I32_MAX + 1}`,
      });
      assert.equal(outOfRange.statusCode, 400);
    });
  });

  describe('/v3/bitcoin-blocks/:height_or_hash/blocks', () => {
    async function addStacksBlock(height: number, burnBlockHeight: number) {
      await db.update(
        new TestBlockBuilder({
          block_height: height,
          block_hash: hex(0xb000 + height),
          index_block_hash: hex(height),
          parent_index_block_hash: hex(height - 1),
          parent_block_hash: hex(0xb000 + height - 1),
          block_time: 1000 + height,
          burn_block_height: burnBlockHeight,
          burn_block_hash: hex(0xbb00 + burnBlockHeight),
        }).build()
      );
    }

    // Bitcoin block 100 confirms Stacks blocks 1-3, 101 confirms 4-5, and 102 confirms none yet.
    async function seed() {
      for (const height of [100, 101, 102]) {
        await addBitcoinBlock(height);
      }
      for (const [height, burnBlockHeight] of [
        [1, 100],
        [2, 100],
        [3, 100],
        [4, 101],
        [5, 101],
      ]) {
        await addStacksBlock(height, burnBlockHeight);
      }
    }

    test('paginates the Stacks blocks confirmed by a Bitcoin block', async () => {
      await seed();
      const first = await getJson('/extended/v3/bitcoin-blocks/100/blocks?limit=2');
      assert.equal(first.total, 3);
      assert.deepEqual(first.results, [
        {
          height: 3,
          hash: hex(0xb003),
          index_hash: hex(3),
          time: 1003,
          time_iso: '1970-01-01T00:16:43.000Z',
          tenure_height: 3,
          tx_count: 0,
          bitcoin_block: { height: 100, hash: hex(0xbb00 + 100) },
        },
        {
          height: 2,
          hash: hex(0xb002),
          index_hash: hex(2),
          time: 1002,
          time_iso: '1970-01-01T00:16:42.000Z',
          tenure_height: 2,
          tx_count: 0,
          bitcoin_block: { height: 100, hash: hex(0xbb00 + 100) },
        },
      ]);
      assert.deepEqual(first.cursor, { next: '1', previous: null, current: '3' });

      const second = await getJson(
        `/extended/v3/bitcoin-blocks/100/blocks?limit=2&cursor=${first.cursor.next}`
      );
      assert.equal(second.total, 3);
      assert.deepEqual(
        second.results.map((r: { height: number }) => r.height),
        [1]
      );
      assert.deepEqual(second.cursor, { next: null, previous: '3', current: '1' });

      const back = await getJson(
        `/extended/v3/bitcoin-blocks/100/blocks?limit=2&cursor=${second.cursor.previous}`
      );
      assert.deepEqual(back, first);
    });

    test('resolves the Bitcoin block by hash and latest', async () => {
      await seed();
      const byHash = await getJson(`/extended/v3/bitcoin-blocks/${hex(0xbb00 + 101)}/blocks`);
      assert.equal(byHash.total, 2);
      assert.deepEqual(
        byHash.results.map((r: { height: number }) => r.height),
        [5, 4]
      );

      // The latest Bitcoin block exists but has no Stacks blocks yet: an empty page, not a 404.
      assert.deepEqual(await getJson('/extended/v3/bitcoin-blocks/latest/blocks'), {
        limit: 20,
        total: 0,
        cursor: { next: null, previous: null, current: null },
        results: [],
      });
    });

    test('updates its ETag when a Stacks block lands on the Bitcoin block', async () => {
      await seed();
      const before = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/bitcoin-blocks/102/blocks',
      });
      const etag = before.headers['etag'] as string;
      assert.ok(etag);
      const cached = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/bitcoin-blocks/102/blocks',
        headers: { 'if-none-match': etag },
      });
      assert.equal(cached.statusCode, 304);

      await addStacksBlock(6, 102);
      const after = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/bitcoin-blocks/102/blocks',
        headers: { 'if-none-match': etag },
      });
      assert.equal(after.statusCode, 200);
      assert.notEqual(after.headers['etag'], etag);
      assert.deepEqual(
        JSON.parse(after.body).results.map((r: { height: number }) => r.height),
        [6]
      );
    });

    test('returns 404 for missing or orphaned Bitcoin blocks and 400 for invalid input', async () => {
      await seed();
      // A replacement at 101 orphans the original block there.
      await addBitcoinBlock(101, hex(0xf101));
      for (const id of ['99', hex(0xdead), hex(0xbb00 + 101)]) {
        const response = await api.fastifyApp.inject({
          method: 'GET',
          url: `/extended/v3/bitcoin-blocks/${id}/blocks`,
        });
        assert.equal(response.statusCode, 404, id);
      }

      const unprefixed = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/bitcoin-blocks/${hex(0xbb00 + 100).slice(2)}/blocks`,
      });
      assert.equal(unprefixed.statusCode, 302);
      assert.equal(
        unprefixed.headers['location'],
        `/extended/v3/bitcoin-blocks/${hex(0xbb00 + 100)}/blocks`
      );

      for (const url of [
        '/extended/v3/bitcoin-blocks/not-a-block/blocks',
        '/extended/v3/bitcoin-blocks/100/blocks?cursor=abc',
        `/extended/v3/bitcoin-blocks/100/blocks?cursor=${I32_MAX + 1}`,
      ]) {
        const response = await api.fastifyApp.inject({ method: 'GET', url });
        assert.equal(response.statusCode, 400, url);
      }
    });
  });

  describe('Bitcoin block times', () => {
    const iso = (time: number) => new Date(time * 1000).toISOString();
    const confirmed = (time: number) => ({
      time,
      time_iso: iso(time),
      projected_time: null,
      projected_time_iso: null,
    });
    const projected = (time: number) => ({
      time: null,
      time_iso: null,
      projected_time: time,
      projected_time_iso: iso(time),
    });

    let stacksHeight = 0;
    async function anchorStacksBlock(burnBlockHeight: number, burnBlockTime: number) {
      stacksHeight += 1;
      await db.update(
        new TestBlockBuilder({
          block_height: stacksHeight,
          block_hash: hex(0xb000 + stacksHeight),
          index_block_hash: hex(stacksHeight),
          parent_index_block_hash: hex(stacksHeight - 1),
          parent_block_hash: hex(0xb000 + stacksHeight - 1),
          burn_block_height: burnBlockHeight,
          burn_block_hash: hex(0xbb00 + burnBlockHeight),
          burn_block_time: burnBlockTime,
        }).build()
      );
    }

    // Bitcoin blocks 99-105, with Stacks blocks anchored to 100, 102 and 104 at 500 seconds per
    // Bitcoin block. 99 predates every anchor, 101 and 103 missed theirs, and 105 is too new to
    // have one yet.
    async function seed() {
      stacksHeight = 0;
      for (const height of [99, 100, 101, 102, 103, 104]) {
        await addBitcoinBlock(height);
      }
      await anchorStacksBlock(100, 10_000);
      await anchorStacksBlock(102, 11_000);
      await anchorStacksBlock(104, 12_000);
      await addBitcoinBlock(105);
    }

    test('lists header, interpolated, and projected times', async () => {
      await seed();
      const body = await getJson('/extended/v3/bitcoin-blocks');
      assert.equal(body.total, 7);
      assert.deepEqual(body.results, [
        // Mined, but no Stacks block has anchored to it yet: projected from the tip at the pace.
        { height: 105, hash: hex(0xbb00 + 105), ...projected(12_500), ...NONE_ANCHORED },
        { height: 104, hash: hex(0xbb00 + 104), ...confirmed(12_000), ...ONE_ANCHORED },
        { height: 103, hash: hex(0xbb00 + 103), ...confirmed(11_500), ...NONE_ANCHORED },
        { height: 102, hash: hex(0xbb00 + 102), ...confirmed(11_000), ...ONE_ANCHORED },
        { height: 101, hash: hex(0xbb00 + 101), ...confirmed(10_500), ...NONE_ANCHORED },
        { height: 100, hash: hex(0xbb00 + 100), ...confirmed(10_000), ...ONE_ANCHORED },
        // Older than any anchored block: nothing to interpolate from.
        { height: 99, hash: hex(0xbb00 + 99), ...NO_TIME, ...NONE_ANCHORED },
      ]);
    });

    test('a block gets its header time once a Stacks block anchors to it', async () => {
      await seed();
      const before = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/bitcoin-blocks?limit=1',
      });
      const etag = before.headers['etag'] as string;
      assert.ok(etag);
      assert.deepEqual(JSON.parse(before.body).results[0], {
        height: 105,
        hash: hex(0xbb00 + 105),
        ...projected(12_500),
        ...NONE_ANCHORED,
      });

      await anchorStacksBlock(105, 12_400);
      const after = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/bitcoin-blocks?limit=1',
        headers: { 'if-none-match': etag },
      });
      assert.equal(after.statusCode, 200);
      assert.notEqual(after.headers['etag'], etag);
      assert.deepEqual(JSON.parse(after.body).results[0], {
        height: 105,
        hash: hex(0xbb00 + 105),
        ...confirmed(12_400),
        ...ONE_ANCHORED,
      });
    });

    test('a single block carries its time', async () => {
      await seed();
      assert.deepEqual(await getJson('/extended/v3/bitcoin-blocks/103'), {
        height: 103,
        hash: hex(0xbb00 + 103),
        ...confirmed(11_500),
        ...NONE_ANCHORED,
      });
      assert.deepEqual(await getJson('/extended/v3/bitcoin-blocks/latest'), {
        height: 105,
        hash: hex(0xbb00 + 105),
        ...projected(12_500),
        ...NONE_ANCHORED,
      });
    });

    test('a height above the tip is a future block with a projected time', async () => {
      await seed();
      assert.deepEqual(await getJson('/extended/v3/bitcoin-blocks/110'), {
        height: 110,
        hash: null,
        ...projected(15_000),
        ...NONE_ANCHORED,
      });
      // So far out its projection passes the end of year 9999, and past the integer column range.
      assert.deepEqual(await getJson('/extended/v3/bitcoin-blocks/2147483648'), {
        height: 2147483648,
        hash: null,
        ...NO_TIME,
        ...NONE_ANCHORED,
      });
      // Future blocks are only reachable by height: they have no hash, and stay out of the list.
      const byHash = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/bitcoin-blocks/${hex(0xbb00 + 110)}`,
      });
      assert.equal(byHash.statusCode, 404);
      assert.equal((await getJson('/extended/v3/bitcoin-blocks')).total, 7);
    });

    test('a missing height at or below the tip is not found', async () => {
      await seed();
      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/bitcoin-blocks/98',
      });
      assert.equal(response.statusCode, 404);
    });
  });

  describe('Stacks block counts', () => {
    async function addStacksBlock(height: number, burnBlockHeight: number, txCount: number) {
      const builder = new TestBlockBuilder({
        block_height: height,
        block_hash: hex(0xb000 + height),
        index_block_hash: hex(height),
        parent_index_block_hash: hex(height - 1),
        parent_block_hash: hex(0xb000 + height - 1),
        burn_block_height: burnBlockHeight,
        burn_block_hash: hex(0xbb00 + burnBlockHeight),
      });
      for (let i = 0; i < txCount; i++) {
        builder.addTx({ tx_id: hex(0xaa00 + height * 0x10 + i) });
      }
      await db.update(builder.build());
    }

    // Bitcoin block 100 confirms Stacks blocks 1-2 (5 transactions), 101 none, 102 block 3.
    async function seed() {
      for (const height of [100, 101, 102]) {
        await addBitcoinBlock(height);
      }
      await addStacksBlock(1, 100, 2);
      await addStacksBlock(2, 100, 3);
      await addStacksBlock(3, 102, 1);
    }

    /** Each listed Bitcoin block as `[height, stacks_block_count, tx_count]`. */
    const counts = (body: {
      results: { height: number; stacks_block_count: number; tx_count: number }[];
    }) => body.results.map(r => [r.height, r.stacks_block_count, r.tx_count]);

    test('lists the Stacks blocks and transactions anchored to each Bitcoin block', async () => {
      await seed();
      assert.deepEqual(counts(await getJson('/extended/v3/bitcoin-blocks')), [
        [102, 1, 1],
        [101, 0, 0],
        [100, 2, 5],
      ]);
      // Only the page's Bitcoin blocks are counted.
      assert.deepEqual(counts(await getJson('/extended/v3/bitcoin-blocks?limit=1&cursor=100')), [
        [100, 2, 5],
      ]);
      const single = await getJson('/extended/v3/bitcoin-blocks/100');
      assert.equal(single.stacks_block_count, 2);
      assert.equal(single.tx_count, 5);
      const future = await getJson('/extended/v3/bitcoin-blocks/110');
      assert.equal(future.stacks_block_count, 0);
      assert.equal(future.tx_count, 0);
    });

    test('counts only the Stacks blocks anchored to the canonical Bitcoin block', async () => {
      await seed();
      // A replacement at 102 orphans the Bitcoin block Stacks block 3 was anchored to.
      await addBitcoinBlock(102, hex(0xf102));
      const body = await getJson('/extended/v3/bitcoin-blocks?limit=1');
      assert.deepEqual(counts(body), [[102, 0, 0]]);
      assert.equal(body.results[0].hash, hex(0xf102));
    });
  });

  describe('/v3/bitcoin-blocks/:height_or_hash', () => {
    test('returns a block by height, hash, and latest', async () => {
      await addBitcoinBlock(100);
      await addBitcoinBlock(101);
      const expected = { height: 100, hash: hex(0xbb00 + 100), ...NO_TIME, ...NONE_ANCHORED };
      assert.deepEqual(await getJson('/extended/v3/bitcoin-blocks/100'), expected);
      assert.deepEqual(await getJson(`/extended/v3/bitcoin-blocks/${hex(0xbb00 + 100)}`), expected);
      assert.deepEqual(await getJson('/extended/v3/bitcoin-blocks/latest'), {
        height: 101,
        hash: hex(0xbb00 + 101),
        ...NO_TIME,
        ...NONE_ANCHORED,
      });

      const unprefixed = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/bitcoin-blocks/${hex(0xbb00 + 100).slice(2)}`,
      });
      assert.equal(unprefixed.statusCode, 302);
      assert.equal(
        unprefixed.headers['location'],
        `/extended/v3/bitcoin-blocks/${hex(0xbb00 + 100)}`
      );
    });

    test('returns 404 for missing or orphaned blocks and 400 for an invalid id', async () => {
      await addBitcoinBlock(100);
      await addBitcoinBlock(100, hex(0xf100));
      for (const id of ['99', hex(0xdead), hex(0xbb00 + 100)]) {
        const response = await api.fastifyApp.inject({
          method: 'GET',
          url: `/extended/v3/bitcoin-blocks/${id}`,
        });
        assert.equal(response.statusCode, 404, id);
      }

      const invalid = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/bitcoin-blocks/not-a-block',
      });
      assert.equal(invalid.statusCode, 400);
    });

    test('returns 404 for latest when there are no blocks', async () => {
      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/bitcoin-blocks/latest',
      });
      assert.equal(response.statusCode, 404);
    });
  });
});
