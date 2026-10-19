import { describe, test, beforeEach, afterEach } from 'node:test';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { ApiServer, startApiServer } from '../../../src/api/init.ts';
import { migrate } from '../../test-helpers.ts';
import { STACKS_TESTNET } from '@stacks/network';
import * as assert from 'node:assert/strict';
import { TestBlockBuilder } from '../test-builders.ts';
import { DbTxStatus, DbTxTypeId } from '../../../src/datastore/common.ts';
import { hex } from '../test-helpers.ts';
import { I32_MAX } from '../../../src/helpers.ts';

const SENDER = 'SP466FNC0P7JWTNM2R9T199QRZN1MYEDTAR0KP27';
const RECIPIENT = 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6';

describe('v3 blocks', () => {
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

  async function seedBlocks(count: number) {
    for (let height = 1; height <= count; height++) {
      await db.update(
        new TestBlockBuilder({
          block_height: height,
          block_hash: hex(0xb000 + height),
          index_block_hash: hex(height),
          parent_index_block_hash: hex(height - 1),
          parent_block_hash: hex(0xb000 + height - 1),
          block_time: 1000 + height,
          tenure_height: 500 + height,
          burn_block_height: 100 + height,
          burn_block_hash: hex(0xbb00 + height),
          burn_block_time: 2000 + height,
          tx_total_size: 300 + height,
          execution_cost_read_count: 10 + height,
          execution_cost_read_length: 20 + height,
          execution_cost_runtime: 30 + height,
          execution_cost_write_count: 40 + height,
          execution_cost_write_length: 50 + height,
        }).build()
      );
    }
  }

  describe('/v3/blocks', () => {
    test('returns an empty page when there are no blocks', async () => {
      const response = await api.fastifyApp.inject({ method: 'GET', url: '/extended/v3/blocks' });
      assert.equal(response.statusCode, 200);
      assert.deepEqual(JSON.parse(response.body), {
        limit: 20,
        total: 0,
        cursor: { next: null, previous: null, current: null },
        results: [],
      });
    });

    test('returns block summaries newest first', async () => {
      await seedBlocks(3);
      const response = await api.fastifyApp.inject({ method: 'GET', url: '/extended/v3/blocks' });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.total, 3);
      assert.deepEqual(body.cursor, { next: null, previous: null, current: '3' });
      assert.deepEqual(body.results, [
        {
          height: 3,
          hash: hex(0xb003),
          index_hash: hex(3),
          time: 1003,
          time_iso: '1970-01-01T00:16:43.000Z',
          tenure_height: 503,
          tx_count: 0,
          bitcoin_block: { height: 103, hash: hex(0xbb00 + 3) },
        },
        {
          height: 2,
          hash: hex(0xb002),
          index_hash: hex(2),
          time: 1002,
          time_iso: '1970-01-01T00:16:42.000Z',
          tenure_height: 502,
          tx_count: 0,
          bitcoin_block: { height: 102, hash: hex(0xbb00 + 2) },
        },
        {
          height: 1,
          hash: hex(0xb001),
          index_hash: hex(1),
          time: 1001,
          time_iso: '1970-01-01T00:16:41.000Z',
          tenure_height: 501,
          tx_count: 0,
          bitcoin_block: { height: 101, hash: hex(0xbb00 + 1) },
        },
      ]);
    });

    test('paginates with cursors', async () => {
      await seedBlocks(5);
      const page = async (cursor?: string) => {
        const response = await api.fastifyApp.inject({
          method: 'GET',
          url: `/extended/v3/blocks?limit=2${cursor ? `&cursor=${cursor}` : ''}`,
        });
        assert.equal(response.statusCode, 200);
        return JSON.parse(response.body);
      };

      const first = await page();
      assert.equal(first.total, 5);
      assert.deepEqual(
        first.results.map((r: { height: number }) => r.height),
        [5, 4]
      );
      assert.deepEqual(first.cursor, { next: '3', previous: null, current: '5' });

      const second = await page(first.cursor.next);
      assert.deepEqual(
        second.results.map((r: { height: number }) => r.height),
        [3, 2]
      );
      assert.deepEqual(second.cursor, { next: '1', previous: '5', current: '3' });

      const last = await page(second.cursor.next);
      assert.deepEqual(
        last.results.map((r: { height: number }) => r.height),
        [1]
      );
      assert.deepEqual(last.cursor, { next: null, previous: '3', current: '1' });

      const back = await page(last.cursor.previous);
      assert.deepEqual(back, second);
    });

    test('rejects invalid cursors', async () => {
      const malformed = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/blocks?cursor=abc',
      });
      assert.equal(malformed.statusCode, 400);

      const outOfRange = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/blocks?cursor=${I32_MAX + 1}`,
      });
      assert.equal(outOfRange.statusCode, 400);
    });
  });

  describe('/v3/blocks/:height_or_hash', () => {
    test('returns a block by height, hash, index hash, and latest', async () => {
      await seedBlocks(3);
      const expected = {
        height: 2,
        hash: hex(0xb002),
        index_hash: hex(2),
        time: 1002,
        time_iso: '1970-01-01T00:16:42.000Z',
        parent_block: { hash: hex(0xb001), index_hash: hex(1) },
        tenure_height: 502,
        bitcoin_block: {
          height: 102,
          hash: hex(0xbb00 + 2),
          time: 2002,
          time_iso: '1970-01-01T00:33:22.000Z',
        },
        tx_count: 0,
        size: 302,
        execution_cost: {
          read_count: 12,
          read_length: 22,
          runtime: 32,
          write_count: 42,
          write_length: 52,
        },
      };
      for (const id of ['2', hex(0xb002), hex(2), hex(2).slice(2)]) {
        const response = await api.fastifyApp.inject({
          method: 'GET',
          url: `/extended/v3/blocks/${id}`,
        });
        if (!id.startsWith('0x') && id.length === 64) {
          // Unprefixed hashes redirect to the prefixed form.
          assert.equal(response.statusCode, 302);
          assert.equal(response.headers['location'], `/extended/v3/blocks/0x${id}`);
          continue;
        }
        assert.equal(response.statusCode, 200);
        assert.deepEqual(JSON.parse(response.body), expected);
      }

      const latest = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/blocks/latest',
      });
      assert.equal(latest.statusCode, 200);
      assert.equal(JSON.parse(latest.body).height, 3);
    });

    test('falls back to the block height as the tenure height before Nakamoto', async () => {
      await seedBlocks(2);
      // Block 2 is a Nakamoto block (it has a signer bitvec); neither has a recorded tenure height.
      await db.sql`UPDATE blocks SET tenure_height = NULL`;
      await db.sql`UPDATE blocks SET signer_bitvec = '1' WHERE block_height = 2`;
      const preNakamoto = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/blocks/1',
      });
      assert.equal(JSON.parse(preNakamoto.body).tenure_height, 1);
      const nakamoto = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/blocks/2',
      });
      assert.equal(JSON.parse(nakamoto.body).tenure_height, null);
    });

    test('returns 404 for a missing block and 400 for an invalid id', async () => {
      await seedBlocks(1);
      const byHeight = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/blocks/99',
      });
      assert.equal(byHeight.statusCode, 404);

      const byHash = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/blocks/${hex(0xdead)}`,
      });
      assert.equal(byHash.statusCode, 404);

      const invalid = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/blocks/not-a-block',
      });
      assert.equal(invalid.statusCode, 400);
    });
  });

  describe('/v3/blocks/:height_or_hash/transactions', () => {
    test('should return 404 for a missing block', async () => {
      const byHeight = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/blocks/99/transactions',
      });
      assert.equal(byHeight.statusCode, 404);

      const byHash = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/blocks/${hex(0xdeadbeef)}/transactions`,
      });
      assert.equal(byHash.statusCode, 404);
    });

    test('should treat a 0x-prefixed hex param as a hash, not coerce to a height', async () => {
      // Regression: a 64-char hex whose digits fit in int32 (e.g. 0x…deadbeef) used to be
      // coerced by AJV into the height branch of the union schema, blowing up Postgres int.
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          index_block_hash: hex(0xdeadbeef),
          parent_index_block_hash: hex(0),
          parent_block_hash: hex(0),
          block_hash: hex(0xdeadbeef),
        })
          .addTx({
            tx_id: hex(0xaa),
            index_block_hash: hex(0xdeadbeef),
            block_hash: hex(0xdeadbeef),
          })
          .build()
      );
      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/blocks/${hex(0xdeadbeef)}/transactions`,
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.total, 1);
      assert.equal(body.results[0].tx_id, hex(0xaa));
      assert.equal(body.results[0].block.index_hash, hex(0xdeadbeef));
    });

    test('should return 400 for an invalid block id', async () => {
      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/blocks/not-a-block/transactions',
      });
      assert.equal(response.statusCode, 400);
    });

    test('should return a list of transaction summaries for a block', async () => {
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          index_block_hash: hex(1),
          parent_index_block_hash: hex(0),
          parent_block_hash: hex(0),
          block_hash: hex(1),
          block_time: 1000,
          burn_block_height: 1,
          burn_block_time: 1000,
        })
          .addTx({
            tx_id: hex(0x11),
            block_hash: hex(1),
            index_block_hash: hex(1),
            block_time: 1000,
            burn_block_height: 1,
            burn_block_time: 1000,
            tx_index: 0,
            fee_rate: 50n,
            type_id: DbTxTypeId.Coinbase,
            status: DbTxStatus.Success,
            sender_address: SENDER,
          })
          .addTx({
            tx_id: hex(0x12),
            block_hash: hex(1),
            index_block_hash: hex(1),
            block_time: 1000,
            burn_block_height: 1,
            burn_block_time: 1000,
            tx_index: 1,
            fee_rate: 75n,
            type_id: DbTxTypeId.TokenTransfer,
            status: DbTxStatus.Success,
            sender_address: SENDER,
            token_transfer_recipient_address: RECIPIENT,
            token_transfer_amount: 100n,
            token_transfer_memo: '0x0d0000000568656c6c6f',
          })
          .build()
      );

      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/blocks/1/transactions',
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.total, 2);
      assert.equal(body.limit, 20);
      assert.equal(body.results.length, 2);
      assert.deepEqual(body.cursor, {
        next: null,
        previous: null,
        current: `1:0:1`,
      });
      // DESC order: tx_index=1 first
      assert.deepEqual(body.results[0], {
        tx_id: hex(0x12),
        type: 'token_transfer',
        status: 'success',
        block: {
          height: 1,
          hash: hex(1),
          index_hash: hex(1),
          time: 1000,
          time_iso: '1970-01-01T00:16:40.000Z',
          tx_index: 1,
        },
        bitcoin_block: {
          height: 1,
          time: 1000,
          time_iso: '1970-01-01T00:16:40.000Z',
        },
        sender: {
          address: SENDER,
          nonce: 0,
        },
        sponsor: null,
        fee_rate: '75',
        token_transfer: {
          recipient: RECIPIENT,
          amount: '100',
          memo: {
            hex: '0x0d0000000568656c6c6f',
            repr: 'hello',
          },
        },
      });
      assert.deepEqual(body.results[1], {
        tx_id: hex(0x11),
        type: 'coinbase',
        status: 'success',
        block: {
          height: 1,
          hash: hex(1),
          index_hash: hex(1),
          time: 1000,
          time_iso: '1970-01-01T00:16:40.000Z',
          tx_index: 0,
        },
        bitcoin_block: {
          height: 1,
          time: 1000,
          time_iso: '1970-01-01T00:16:40.000Z',
        },
        sender: {
          address: SENDER,
          nonce: 0,
        },
        sponsor: null,
        fee_rate: '50',
        coinbase: {
          alt_recipient: null,
        },
      });
    });

    test('should return transactions when block is referenced by hash or latest', async () => {
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          index_block_hash: hex(1),
          parent_index_block_hash: hex(0),
          parent_block_hash: hex(0),
        })
          .addTx({ tx_id: hex(0x10) })
          .build()
      );
      await db.update(
        new TestBlockBuilder({
          block_height: 2,
          index_block_hash: hex(2),
          parent_index_block_hash: hex(1),
          parent_block_hash: hex(1),
        })
          .addTx({ tx_id: hex(0x20) })
          .addTx({ tx_id: hex(0x21) })
          .build()
      );

      const byHash = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/blocks/${hex(2)}/transactions`,
      });
      assert.equal(byHash.statusCode, 200);
      const byHashBody = JSON.parse(byHash.body);
      assert.equal(byHashBody.total, 2);
      assert.equal(byHashBody.results.length, 2);
      assert.equal(byHashBody.results[0].tx_id, hex(0x21));
      assert.equal(byHashBody.results[1].tx_id, hex(0x20));

      const latest = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/blocks/latest/transactions',
      });
      assert.equal(latest.statusCode, 200);
      const latestBody = JSON.parse(latest.body);
      assert.equal(latestBody.total, 2);
      assert.equal(latestBody.results.length, 2);
      assert.equal(latestBody.results[0].tx_id, hex(0x21));
      assert.equal(latestBody.results[1].tx_id, hex(0x20));
    });

    test('should not include transactions from other blocks', async () => {
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          index_block_hash: hex(1),
          parent_index_block_hash: hex(0),
          parent_block_hash: hex(0),
        })
          .addTx({ tx_id: hex(0x10) })
          .addTx({ tx_id: hex(0x11) })
          .build()
      );
      await db.update(
        new TestBlockBuilder({
          block_height: 2,
          index_block_hash: hex(2),
          parent_index_block_hash: hex(1),
          parent_block_hash: hex(1),
        })
          .addTx({ tx_id: hex(0x20) })
          .build()
      );
      await db.update(
        new TestBlockBuilder({
          block_height: 3,
          index_block_hash: hex(3),
          parent_index_block_hash: hex(2),
          parent_block_hash: hex(2),
        })
          .addTx({ tx_id: hex(0x30) })
          .addTx({ tx_id: hex(0x31) })
          .addTx({ tx_id: hex(0x32) })
          .build()
      );

      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/blocks/2/transactions',
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.total, 1);
      assert.equal(body.results.length, 1);
      assert.equal(body.results[0].tx_id, hex(0x20));
      assert.equal(body.results[0].block.height, 2);
    });

    test('should allow cursor pagination within a block', async () => {
      const builder = new TestBlockBuilder({
        block_height: 1,
        index_block_hash: hex(1),
        parent_index_block_hash: hex(0),
        parent_block_hash: hex(0),
      });
      for (let i = 0; i < 10; i++) {
        builder.addTx({ tx_id: hex(0x100 + i) });
      }
      await db.update(builder.build());

      // First page (tx_index 9..6)
      const page1 = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/blocks/1/transactions',
        query: { limit: '4' },
      });
      assert.equal(page1.statusCode, 200);
      const body1 = JSON.parse(page1.body);
      assert.equal(body1.total, 10);
      assert.equal(body1.limit, 4);
      assert.equal(body1.results.length, 4);
      assert.deepEqual(
        body1.results.map((r: { tx_id: string }) => r.tx_id),
        [hex(0x109), hex(0x108), hex(0x107), hex(0x106)]
      );
      assert.deepEqual(body1.cursor, {
        next: '1:0:5',
        previous: null,
        current: '1:0:9',
      });

      // Middle page (tx_index 5..2)
      const page2 = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/blocks/1/transactions',
        query: { limit: '4', cursor: '1:0:5' },
      });
      assert.equal(page2.statusCode, 200);
      const body2 = JSON.parse(page2.body);
      assert.equal(body2.results.length, 4);
      assert.deepEqual(
        body2.results.map((r: { tx_id: string }) => r.tx_id),
        [hex(0x105), hex(0x104), hex(0x103), hex(0x102)]
      );
      assert.deepEqual(body2.cursor, {
        next: '1:0:1',
        previous: '1:0:9',
        current: '1:0:5',
      });

      // Final page (tx_index 1..0). next_cursor is null since we hit the end.
      const page3 = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/blocks/1/transactions',
        query: { limit: '4', cursor: '1:0:1' },
      });
      assert.equal(page3.statusCode, 200);
      const body3 = JSON.parse(page3.body);
      assert.equal(body3.results.length, 2);
      assert.deepEqual(
        body3.results.map((r: { tx_id: string }) => r.tx_id),
        [hex(0x101), hex(0x100)]
      );
      assert.deepEqual(body3.cursor, {
        next: null,
        previous: '1:0:5',
        current: '1:0:1',
      });
    });

    test('should not bleed pagination across blocks when cursor targets the same height', async () => {
      // Adjacent blocks with overlapping tx_indexes; cursor pagination must stay within the
      // requested block.
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          index_block_hash: hex(1),
          parent_index_block_hash: hex(0),
          parent_block_hash: hex(0),
        })
          .addTx({ tx_id: hex(0x10) })
          .addTx({ tx_id: hex(0x11) })
          .build()
      );
      await db.update(
        new TestBlockBuilder({
          block_height: 2,
          index_block_hash: hex(2),
          parent_index_block_hash: hex(1),
          parent_block_hash: hex(1),
        })
          .addTx({ tx_id: hex(0x20) })
          .addTx({ tx_id: hex(0x21) })
          .build()
      );

      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/blocks/2/transactions',
        query: { limit: '1', cursor: '2:0:0' },
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.total, 2);
      assert.equal(body.results.length, 1);
      assert.equal(body.results[0].tx_id, hex(0x20));
      assert.equal(body.cursor.next, null);
      // The page before tx_index=0 is the first row of this block — there is no earlier row.
      assert.equal(body.cursor.previous, '2:0:1');
      assert.equal(body.cursor.current, '2:0:0');
    });

    test('should allow block-boundary cursors for anchored transactions', async () => {
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          index_block_hash: hex(1),
          parent_index_block_hash: hex(0),
          parent_block_hash: hex(0),
        })
          .addTx({
            tx_id: hex(0x1001),
            microblock_sequence: I32_MAX,
          })
          .build()
      );

      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/blocks/1/transactions',
        query: {
          limit: '1',
          cursor: '1:0:0',
        },
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.results.length, 1);
      assert.equal(body.results[0].tx_id, hex(0x1001));
      assert.deepEqual(body.cursor, {
        next: null,
        previous: null,
        current: `1:${I32_MAX}:0`,
      });
    });

    test('should preserve exact height:0:0 transaction cursors', async () => {
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          index_block_hash: hex(1),
          parent_index_block_hash: hex(0),
          parent_block_hash: hex(0),
        })
          .addTx({
            tx_id: hex(0x1001),
            tx_index: 0,
            microblock_sequence: 0,
          })
          .addTx({
            tx_id: hex(0x1002),
            tx_index: 1,
            microblock_sequence: I32_MAX,
          })
          .build()
      );

      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/blocks/1/transactions',
        query: {
          limit: '1',
          cursor: '1:0:0',
        },
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.results.length, 1);
      assert.equal(body.results[0].tx_id, hex(0x1001));
      assert.deepEqual(body.cursor, {
        next: null,
        previous: `1:${I32_MAX}:1`,
        current: '1:0:0',
      });
    });

    test('should return 304 when ETag matches and refresh ETag per block', async () => {
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          index_block_hash: hex(1),
          parent_index_block_hash: hex(0),
          parent_block_hash: hex(0),
        })
          .addTx({ tx_id: hex(0x10) })
          .build()
      );
      await db.update(
        new TestBlockBuilder({
          block_height: 2,
          index_block_hash: hex(2),
          parent_index_block_hash: hex(1),
          parent_block_hash: hex(1),
        })
          .addTx({ tx_id: hex(0x20) })
          .build()
      );

      // First request returns 200 with an ETag derived from this block.
      const first = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/blocks/1/transactions',
      });
      assert.equal(first.statusCode, 200);
      const etag1 = first.headers['etag'];
      assert.ok(etag1, 'expected ETag header to be set');
      assert.equal(etag1, `"${hex(1)}:true"`);

      // Same ETag returns 304 with an empty body.
      const cached = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/blocks/1/transactions',
        headers: { 'if-none-match': etag1 as string },
      });
      assert.equal(cached.statusCode, 304);
      assert.equal(cached.body, '');

      // A stale ETag returns 200 with the current data and ETag.
      const stale = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/blocks/1/transactions',
        headers: { 'if-none-match': '"0xdeadbeef:true"' },
      });
      assert.equal(stale.statusCode, 200);
      assert.equal(stale.headers['etag'], etag1);

      // A different block has a distinct ETag and does not 304 against block 1's ETag.
      const otherBlock = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/blocks/2/transactions',
        headers: { 'if-none-match': etag1 as string },
      });
      assert.equal(otherBlock.statusCode, 200);
      const etag2 = otherBlock.headers['etag'];
      assert.ok(etag2);
      assert.notEqual(etag2, etag1);
      assert.equal(etag2, `"${hex(2)}:true"`);
    });
  });
});
