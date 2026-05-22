import { describe, test, beforeEach, afterEach } from 'node:test';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { ApiServer, startApiServer } from '../../../src/api/init.ts';
import { createClarityValueArray, migrate } from '../../test-helpers.ts';
import { STACKS_TESTNET } from '@stacks/network';
import * as assert from 'node:assert/strict';
import { TestBlockBuilder, testMempoolTx } from '../test-builders.ts';
import { DbTxStatus, DbTxTypeId } from '../../../src/datastore/common.ts';
import { hex } from '../test-helpers.ts';
import { stringAsciiCV, uintCV } from '@stacks/transactions';
import { bufferToHex } from '@stacks/api-toolkit';

// Distinct from the default mempool tx sender to avoid replace-by-fee collisions during inserts.
const BLOCK_SENDER = 'SP3SBQ9PZEMBNBAWTR7FRPE3XK0EFW9JWVX4G80S2';

describe('mempool', () => {
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

  describe('/v3/mempool/transactions', () => {
    test('should return an empty list', async () => {
      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/mempool/transactions',
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.limit, 20);
      assert.equal(body.total, 0);
      assert.equal(body.cursor.next, null);
      assert.equal(body.cursor.previous, null);
      assert.equal(body.cursor.current, null);
      assert.equal(body.results.length, 0);
    });

    test('should return a list of mempool transaction summaries', async () => {
      const tx1 = hex(1);
      const tx2 = hex(2);
      const blockTx = hex(0xaa);
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          index_block_hash: hex(1),
          parent_index_block_hash: hex(0),
          parent_block_hash: hex(0),
        })
          .addTx({ tx_id: blockTx, sender_address: BLOCK_SENDER, nonce: 0 })
          .build()
      );
      await db.updateMempoolTxs({
        mempoolTxs: [
          testMempoolTx({
            tx_id: tx1,
            receipt_time: 1000,
            type_id: DbTxTypeId.TokenTransfer,
            sender_address: 'SP466FNC0P7JWTNM2R9T199QRZN1MYEDTAR0KP27',
            token_transfer_recipient_address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
            token_transfer_amount: 500n,
            token_transfer_memo: '0x',
            fee_rate: 250n,
            nonce: 3,
          }),
          testMempoolTx({
            tx_id: tx2,
            receipt_time: 2000,
            type_id: DbTxTypeId.ContractCall,
            sender_address: 'SP466FNC0P7JWTNM2R9T199QRZN1MYEDTAR0KP27',
            contract_call_contract_id: 'SP000000000000000000002Q6VF78.pox-4',
            contract_call_function_name: 'stack-stx',
            fee_rate: 100n,
            nonce: 4,
          }),
        ],
      });

      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/mempool/transactions',
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.total, 2);
      assert.equal(body.limit, 20);
      assert.equal(body.cursor.next, null);
      assert.equal(body.cursor.previous, null);
      assert.equal(body.cursor.current, `2000:${tx2}`);
      assert.equal(body.results.length, 2);
      assert.deepEqual(body.results[0], {
        tx_id: tx2,
        type: 'contract_call',
        status: 'pending',
        sender: {
          address: 'SP466FNC0P7JWTNM2R9T199QRZN1MYEDTAR0KP27',
          nonce: 4,
        },
        sponsor: null,
        fee_rate: '100',
        receipt_time: 2000,
        receipt_block_height: 1,
        contract_call: {
          contract_id: 'SP000000000000000000002Q6VF78.pox-4',
          function_name: 'stack-stx',
        },
      });
      assert.deepEqual(body.results[1], {
        tx_id: tx1,
        type: 'token_transfer',
        status: 'pending',
        sender: {
          address: 'SP466FNC0P7JWTNM2R9T199QRZN1MYEDTAR0KP27',
          nonce: 3,
        },
        sponsor: null,
        fee_rate: '250',
        receipt_time: 1000,
        receipt_block_height: 1,
        token_transfer: {
          recipient: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
          amount: '500',
          memo: '0x',
        },
      });
    });

    test('should remove transactions confirmed in a block', async () => {
      const tx1 = hex(0x1001);
      const tx2 = hex(0x1002);
      const tx3 = hex(0x1003);
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          index_block_hash: hex(1),
          parent_index_block_hash: hex(0),
          parent_block_hash: hex(0),
        })
          .addTx({ tx_id: hex(0xaa), sender_address: BLOCK_SENDER, nonce: 0 })
          .build()
      );
      await db.updateMempoolTxs({
        mempoolTxs: [
          testMempoolTx({ tx_id: tx1, receipt_time: 1000, nonce: 1 }),
          testMempoolTx({ tx_id: tx2, receipt_time: 2000, nonce: 2 }),
          testMempoolTx({ tx_id: tx3, receipt_time: 3000, nonce: 3 }),
        ],
      });

      const before = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/mempool/transactions',
      });
      assert.equal(before.statusCode, 200);
      const bodyBefore = JSON.parse(before.body);
      assert.equal(bodyBefore.total, 3);
      assert.deepEqual(
        bodyBefore.results.map((r: { tx_id: string }) => r.tx_id),
        [tx3, tx2, tx1]
      );

      // Confirm two of the mempool txs in a new block. Match each by tx_id and by
      // (sender, nonce) so pruning is unambiguous. The block txs use different nonces
      // than the surviving mempool tx so it is not also pruned.
      await db.update(
        new TestBlockBuilder({
          block_height: 2,
          index_block_hash: hex(2),
          parent_index_block_hash: hex(1),
          parent_block_hash: hex(1),
        })
          .addTx({ tx_id: tx1, nonce: 1 })
          .addTx({ tx_id: tx3, nonce: 3 })
          .build()
      );

      const after = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/mempool/transactions',
      });
      assert.equal(after.statusCode, 200);
      const bodyAfter = JSON.parse(after.body);
      assert.equal(bodyAfter.total, 1);
      assert.equal(bodyAfter.results.length, 1);
      assert.equal(bodyAfter.results[0].tx_id, tx2);
      assert.equal(bodyAfter.cursor.current, `2000:${tx2}`);
      assert.equal(bodyAfter.cursor.next, null);
      assert.equal(bodyAfter.cursor.previous, null);
    });

    test('should remove transactions dropped from the mempool', async () => {
      const tx1 = hex(0x2001);
      const tx2 = hex(0x2002);
      const replacement = hex(0x2099);
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          index_block_hash: hex(1),
          parent_index_block_hash: hex(0),
          parent_block_hash: hex(0),
        })
          .addTx({ tx_id: hex(0xaa), sender_address: BLOCK_SENDER, nonce: 0 })
          .build()
      );
      await db.updateMempoolTxs({
        mempoolTxs: [
          testMempoolTx({ tx_id: tx1, receipt_time: 1000, nonce: 1 }),
          testMempoolTx({ tx_id: tx2, receipt_time: 2000, nonce: 2 }),
        ],
      });
      await db.dropMempoolTxs({
        status: DbTxStatus.DroppedReplaceByFee,
        txIds: [tx1],
        new_tx_id: replacement,
      });

      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/mempool/transactions',
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.total, 1);
      assert.equal(body.results.length, 1);
      assert.equal(body.results[0].tx_id, tx2);
      assert.equal(body.results[0].status, 'pending');
    });

    test('should allow cursor pagination', async () => {
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          index_block_hash: hex(1),
          parent_index_block_hash: hex(0),
          parent_block_hash: hex(0),
        })
          .addTx({ tx_id: hex(0xaa), sender_address: BLOCK_SENDER, nonce: 0 })
          .build()
      );
      const txs = [];
      for (let i = 1; i <= 10; i++) {
        txs.push(testMempoolTx({ tx_id: hex(i), receipt_time: i * 1000, nonce: i }));
      }
      await db.updateMempoolTxs({ mempoolTxs: txs });

      // Fetch first page (newest first).
      const page1 = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/mempool/transactions',
        query: { limit: '4' },
      });
      assert.equal(page1.statusCode, 200);
      const body1 = JSON.parse(page1.body);
      assert.equal(body1.total, 10);
      assert.equal(body1.limit, 4);
      assert.equal(body1.results.length, 4);
      assert.deepEqual(
        body1.results.map((r: { tx_id: string }) => r.tx_id),
        [hex(10), hex(9), hex(8), hex(7)]
      );
      assert.deepEqual(body1.cursor, {
        next: `6000:${hex(6)}`,
        previous: null,
        current: `10000:${hex(10)}`,
      });

      // Fetch second page using the next cursor.
      const page2 = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/mempool/transactions',
        query: { limit: '4', cursor: body1.cursor.next },
      });
      assert.equal(page2.statusCode, 200);
      const body2 = JSON.parse(page2.body);
      assert.equal(body2.total, 10);
      assert.equal(body2.limit, 4);
      assert.equal(body2.results.length, 4);
      assert.deepEqual(
        body2.results.map((r: { tx_id: string }) => r.tx_id),
        [hex(6), hex(5), hex(4), hex(3)]
      );
      assert.deepEqual(body2.cursor, {
        next: `2000:${hex(2)}`,
        previous: `10000:${hex(10)}`,
        current: `6000:${hex(6)}`,
      });

      // Final page returns the remaining results with no next cursor.
      const page3 = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/mempool/transactions',
        query: { limit: '4', cursor: body2.cursor.next },
      });
      assert.equal(page3.statusCode, 200);
      const body3 = JSON.parse(page3.body);
      assert.equal(body3.results.length, 2);
      assert.deepEqual(
        body3.results.map((r: { tx_id: string }) => r.tx_id),
        [hex(2), hex(1)]
      );
      assert.equal(body3.cursor.next, null);
      assert.equal(body3.cursor.previous, `6000:${hex(6)}`);
      assert.equal(body3.cursor.current, `2000:${hex(2)}`);
    });

    test('should return 304 when ETag matches and refresh ETag on mempool changes', async () => {
      const tx1 = hex(0x3001);
      const tx2 = hex(0x3002);
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          index_block_hash: hex(1),
          parent_index_block_hash: hex(0),
          parent_block_hash: hex(0),
        })
          .addTx({ tx_id: hex(0xaa), sender_address: BLOCK_SENDER, nonce: 0 })
          .build()
      );
      await db.updateMempoolTxs({
        mempoolTxs: [
          testMempoolTx({ tx_id: tx1, receipt_time: 1000, nonce: 1 }),
          testMempoolTx({ tx_id: tx2, receipt_time: 2000, nonce: 2 }),
        ],
      });

      // First request returns 200 with an ETag header.
      const first = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/mempool/transactions',
      });
      assert.equal(first.statusCode, 200);
      const etag = first.headers['etag'];
      assert.ok(etag, 'expected ETag header to be set');

      // Same ETag returns 304 with an empty body.
      const cached = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/mempool/transactions',
        headers: { 'if-none-match': etag as string },
      });
      assert.equal(cached.statusCode, 304);
      assert.equal(cached.body, '');

      // A stale ETag returns 200 with the current data.
      const stale = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/mempool/transactions',
        headers: { 'if-none-match': '"0xdeadbeef"' },
      });
      assert.equal(stale.statusCode, 200);
      assert.equal(stale.headers['etag'], etag);

      // Confirming one of the mempool txs invalidates the ETag.
      await db.update(
        new TestBlockBuilder({
          block_height: 2,
          index_block_hash: hex(2),
          parent_index_block_hash: hex(1),
          parent_block_hash: hex(1),
        })
          .addTx({ tx_id: tx1, nonce: 1 })
          .build()
      );

      const afterConfirm = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/mempool/transactions',
        headers: { 'if-none-match': etag as string },
      });
      assert.equal(afterConfirm.statusCode, 200);
      const newEtag = afterConfirm.headers['etag'];
      assert.ok(newEtag);
      assert.notEqual(newEtag, etag);

      // The new ETag is now the cache key for 304s.
      const refreshed = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/mempool/transactions',
        headers: { 'if-none-match': newEtag as string },
      });
      assert.equal(refreshed.statusCode, 304);
    });
  });

  describe('/v3/transactions/:tx_id (mempool path)', () => {
    const SENDER = 'SP466FNC0P7JWTNM2R9T199QRZN1MYEDTAR0KP27';

    test('should return a mempool transaction by tx_id with lean defaults', async () => {
      const txId = hex(0x4001);
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          index_block_hash: hex(1),
          parent_index_block_hash: hex(0),
          parent_block_hash: hex(0),
        })
          .addTx({ tx_id: hex(0xaa), sender_address: BLOCK_SENDER, nonce: 0 })
          .build()
      );
      await db.updateMempoolTxs({
        mempoolTxs: [
          testMempoolTx({
            tx_id: txId,
            receipt_time: 1000,
            type_id: DbTxTypeId.ContractCall,
            sender_address: SENDER,
            contract_call_contract_id: 'SP000000000000000000002Q6VF78.pox-4',
            contract_call_function_name: 'stack-stx',
            contract_call_function_args: bufferToHex(
              createClarityValueArray(uintCV(123456), stringAsciiCV('hello'))
            ),
            fee_rate: 100n,
            nonce: 4,
          }),
        ],
      });

      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/transactions/${txId}`,
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.tx_id, txId);
      assert.equal(body.type, 'contract_call');
      assert.equal(body.status, 'pending');
      assert.equal(body.receipt_time, 1000);
      assert.equal(body.contract_call.contract_id, 'SP000000000000000000002Q6VF78.pox-4');
      assert.equal(body.contract_call.function_name, 'stack-stx');
      // Heavy fields omitted by default.
      assert.equal(body.contract_call.function_args, undefined);
      assert.equal(body.post_conditions, undefined);
      // `result` does not apply to mempool transactions (they have not executed) — the
      // schema doesn't even declare it on the mempool type, so it must stay absent
      // regardless of include.
      assert.equal(body.result, undefined);
    });

    test('should populate function_args and post_conditions when requested', async () => {
      const txId = hex(0x4002);
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          index_block_hash: hex(1),
          parent_index_block_hash: hex(0),
          parent_block_hash: hex(0),
        })
          .addTx({ tx_id: hex(0xaa), sender_address: BLOCK_SENDER, nonce: 0 })
          .build()
      );
      await db.updateMempoolTxs({
        mempoolTxs: [
          testMempoolTx({
            tx_id: txId,
            receipt_time: 2000,
            type_id: DbTxTypeId.ContractCall,
            sender_address: SENDER,
            contract_call_contract_id: 'SP000000000000000000002Q6VF78.pox-4',
            contract_call_function_name: 'stack-stx',
            contract_call_function_args: bufferToHex(
              createClarityValueArray(uintCV(123456), stringAsciiCV('hello'))
            ),
            fee_rate: 100n,
            nonce: 5,
          }),
        ],
      });

      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/transactions/${txId}`,
        query: { include: 'function_args,post_conditions' },
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.deepEqual(body.contract_call.function_args, [
        { hex: '0x010000000000000000000000000001e240', repr: 'u123456' },
        { hex: '0x0d0000000568656c6c6f', repr: '"hello"' },
      ]);
      assert.deepEqual(body.post_conditions, []);
    });

    test('should return 304 when ETag matches and refresh ETag when the mempool tx is confirmed', async () => {
      const txId = hex(0x4003);
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          index_block_hash: hex(1),
          parent_index_block_hash: hex(0),
          parent_block_hash: hex(0),
        })
          .addTx({ tx_id: hex(0xaa), sender_address: BLOCK_SENDER, nonce: 0 })
          .build()
      );
      await db.updateMempoolTxs({
        mempoolTxs: [
          testMempoolTx({ tx_id: txId, receipt_time: 1000, sender_address: SENDER, nonce: 1 }),
        ],
      });

      // First request returns 200 + ETag derived from the mempool status.
      const first = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/transactions/${txId}`,
      });
      assert.equal(first.statusCode, 200);
      const etag = first.headers['etag'];
      assert.ok(etag, 'expected ETag header to be set');

      // Same ETag returns 304.
      const cached = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/transactions/${txId}`,
        headers: { 'if-none-match': etag as string },
      });
      assert.equal(cached.statusCode, 304);
      assert.equal(cached.body, '');

      // Confirm the tx in a block — status moves from Pending to Success and the row gains
      // an index_block_hash, so the ETag must change. Use TokenTransfer to mirror the
      // mempool tx's shape (the default `testMempoolTx` builds a TokenTransfer).
      await db.update(
        new TestBlockBuilder({
          block_height: 2,
          index_block_hash: hex(2),
          parent_index_block_hash: hex(1),
          parent_block_hash: hex(1),
        })
          .addTx({
            tx_id: txId,
            sender_address: SENDER,
            nonce: 1,
            type_id: DbTxTypeId.TokenTransfer,
          })
          .build()
      );

      const afterConfirm = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/transactions/${txId}`,
        headers: { 'if-none-match': etag as string },
      });
      assert.equal(afterConfirm.statusCode, 200);
      const newEtag = afterConfirm.headers['etag'];
      assert.ok(newEtag);
      assert.notEqual(newEtag, etag);
      // The response is now the canonical shape — status is `success`, not `pending`.
      const afterBody = JSON.parse(afterConfirm.body);
      assert.equal(afterBody.status, 'success');
    });
  });
});
