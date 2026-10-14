import { describe, test, beforeEach, afterEach } from 'node:test';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { ApiServer, startApiServer } from '../../../src/api/init.ts';
import { migrate } from '../../test-helpers.ts';
import { STACKS_TESTNET } from '@stacks/network';
import * as assert from 'node:assert/strict';
import { hex } from '../test-helpers.ts';
import { TestBlockBuilder } from '../test-builders.ts';
import { I32_MAX } from '../../../src/helpers.ts';

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
        { height: 105, hash: hex(0xbb00 + 105) },
        { height: 104, hash: hex(0xbb00 + 104) },
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
        { height: 101, hash: hex(0xf101) },
        { height: 100, hash: hex(0xbb00 + 100) },
      ]);

      // Re-delivering the canonical block is idempotent.
      await addBitcoinBlock(101, hex(0xf101));
      body = await getJson('/extended/v3/bitcoin-blocks');
      assert.equal(body.total, 2);

      // The original block winning back restores it without double counting.
      await addBitcoinBlock(101);
      body = await getJson('/extended/v3/bitcoin-blocks');
      assert.equal(body.total, 2);
      assert.deepEqual(body.results[0], { height: 101, hash: hex(0xbb00 + 101) });
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
        },
        {
          height: 2,
          hash: hex(0xb002),
          index_hash: hex(2),
          time: 1002,
          time_iso: '1970-01-01T00:16:42.000Z',
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

  describe('/v3/bitcoin-blocks/:height_or_hash', () => {
    test('returns a block by height, hash, and latest', async () => {
      await addBitcoinBlock(100);
      await addBitcoinBlock(101);
      const expected = { height: 100, hash: hex(0xbb00 + 100) };
      assert.deepEqual(await getJson('/extended/v3/bitcoin-blocks/100'), expected);
      assert.deepEqual(await getJson(`/extended/v3/bitcoin-blocks/${hex(0xbb00 + 100)}`), expected);
      assert.deepEqual(await getJson('/extended/v3/bitcoin-blocks/latest'), {
        height: 101,
        hash: hex(0xbb00 + 101),
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
