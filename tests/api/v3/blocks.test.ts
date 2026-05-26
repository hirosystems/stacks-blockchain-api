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

describe('blocks', () => {
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
            token_transfer_memo: '0x',
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
          tx_index: 1,
        },
        bitcoin_block: {
          height: 1,
          time: 1000,
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
          memo: '0x',
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
          tx_index: 0,
        },
        bitcoin_block: {
          height: 1,
          time: 1000,
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
