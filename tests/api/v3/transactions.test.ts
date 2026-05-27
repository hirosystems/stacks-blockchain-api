import { describe, test, beforeEach, afterEach } from 'node:test';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { ApiServer, startApiServer } from '../../../src/api/init.ts';
import { createClarityValueArray, migrate } from '../../test-helpers.ts';
import { STACKS_TESTNET } from '@stacks/network';
import * as assert from 'node:assert/strict';
import { TestBlockBuilder } from '../test-builders.ts';
import { DbTxStatus, DbTxTypeId } from '../../../src/datastore/common.ts';
import { stringAsciiCV, uintCV } from '@stacks/transactions';
import { bufferToHex } from '@stacks/api-toolkit';
import { hex } from '../test-helpers.ts';
import { I32_MAX } from '../../../src/helpers.ts';

describe('transactions', () => {
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

  describe('/v3/transactions', () => {
    test('should return an empty list', async () => {
      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/transactions',
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

    test('should return a list of transaction summaries', async () => {
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          index_block_hash: '0x0001',
          parent_index_block_hash: '0x0000',
          parent_block_hash: '0x0000',
        })
          .addTx({
            tx_id: '0x0001',
            block_hash: '0x0001',
            index_block_hash: '0x0001',
            block_time: 1000,
            burn_block_height: 1,
            burn_block_time: 1000,
            tx_index: 0,
            fee_rate: 50n,
            type_id: DbTxTypeId.Coinbase,
            status: DbTxStatus.Success,
            sender_address: 'SP466FNC0P7JWTNM2R9T199QRZN1MYEDTAR0KP27',
          })
          .build()
      );
      await db.update(
        new TestBlockBuilder({
          block_height: 2,
          index_block_hash: '0x0002',
          parent_index_block_hash: '0x0001',
          parent_block_hash: '0x0001',
        })
          .addTx({
            tx_id: '0x0002',
            tx_index: 0,
            fee_rate: 50n,
            block_hash: '0x0002',
            index_block_hash: '0x0002',
            block_time: 2000,
            burn_block_height: 2,
            burn_block_time: 2000,
            type_id: DbTxTypeId.TokenTransfer,
            status: DbTxStatus.Success,
            sender_address: 'SP466FNC0P7JWTNM2R9T199QRZN1MYEDTAR0KP27',
            token_transfer_recipient_address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
            token_transfer_amount: 100n,
            token_transfer_memo: '0x0d0000000568656c6c6f',
          })
          .build()
      );

      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/transactions',
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.total, 2);
      assert.equal(body.limit, 20);
      assert.equal(body.cursor.next, null);
      assert.equal(body.cursor.previous, null);
      assert.equal(body.cursor.current, '2:0:0');
      assert.equal(body.results.length, 2);
      assert.deepEqual(body.results[0], {
        tx_id: '0x0002',
        type: 'token_transfer',
        status: 'success',
        block: {
          height: 2,
          hash: '0x0002',
          index_hash: '0x0002',
          time: 2000,
          tx_index: 0,
        },
        bitcoin_block: {
          height: 2,
          time: 2000,
        },
        sender: {
          address: 'SP466FNC0P7JWTNM2R9T199QRZN1MYEDTAR0KP27',
          nonce: 0,
        },
        sponsor: null,
        fee_rate: '50',
        token_transfer: {
          recipient: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
          amount: '100',
          memo: {
            hex: '0x0d0000000568656c6c6f',
            repr: '"hello"',
          },
        },
      });
      assert.deepEqual(body.results[1], {
        tx_id: '0x0001',
        type: 'coinbase',
        status: 'success',
        block: {
          height: 1,
          hash: '0x0001',
          index_hash: '0x0001',
          time: 1000,
          tx_index: 0,
        },
        bitcoin_block: {
          height: 1,
          time: 1000,
        },
        sender: {
          address: 'SP466FNC0P7JWTNM2R9T199QRZN1MYEDTAR0KP27',
          nonce: 0,
        },
        sponsor: null,
        fee_rate: '50',
        coinbase: {
          alt_recipient: null,
        },
      });
    });

    test('should allow cursor pagination', async () => {
      for (let i = 1; i <= 10; i++) {
        const hex = i.toString(16).padStart(64, '0');
        const prevHex = (i - 1).toString(16).padStart(64, '0');
        const builder = new TestBlockBuilder({
          block_height: i,
          index_block_hash: `0x${hex}`,
          parent_index_block_hash: `0x${prevHex}`,
          parent_block_hash: `0x${prevHex}`,
        });
        for (let j = 1; j <= 5; j++) {
          builder.addTx({
            tx_id: `0x${(i * j).toString(16).padStart(8, '0')}`,
            block_hash: `0x${hex}`,
            index_block_hash: `0x${hex}`,
            block_time: i * 1000,
            burn_block_height: i,
            burn_block_time: i * 1000,
          });
        }
        await db.update(builder.build());
      }

      // Fetch first page
      const page1 = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/transactions',
        query: {
          limit: '5',
        },
      });
      assert.equal(page1.statusCode, 200);
      const body1 = JSON.parse(page1.body);
      assert.equal(body1.total, 50);
      assert.equal(body1.limit, 5);
      assert.equal(body1.results.length, 5);
      assert.deepEqual(body1.cursor, {
        next: '9:0:4',
        previous: null,
        current: '10:0:4',
      });

      // Fetch second page
      const page2 = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/transactions',
        query: {
          limit: '5',
          cursor: '9:0:4',
        },
      });
      assert.equal(page2.statusCode, 200);
      const body2 = JSON.parse(page2.body);
      assert.equal(body2.total, 50);
      assert.equal(body2.limit, 5);
      assert.equal(body2.results.length, 5);
      assert.deepEqual(body2.cursor, {
        next: '8:0:4',
        previous: '10:0:4',
        current: '9:0:4',
      });
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
        url: '/extended/v3/transactions',
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
        url: '/extended/v3/transactions',
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

    test('should return 304 when ETag matches and refresh ETag when chain tip changes', async () => {
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          index_block_hash: '0x0001',
          parent_index_block_hash: '0x0000',
          parent_block_hash: '0x0000',
        })
          .addTx({ tx_id: '0x0001' })
          .build()
      );

      // First request returns 200 with an ETag header derived from the chain tip.
      const first = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/transactions',
      });
      assert.equal(first.statusCode, 200);
      const etag = first.headers['etag'];
      assert.ok(etag, 'expected ETag header to be set');
      assert.equal(etag, '"0x0001"');

      // Same ETag returns 304 with an empty body.
      const cached = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/transactions',
        headers: { 'if-none-match': etag as string },
      });
      assert.equal(cached.statusCode, 304);
      assert.equal(cached.body, '');

      // A stale ETag returns 200 with the current data and ETag.
      const stale = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/transactions',
        headers: { 'if-none-match': '"0xdeadbeef"' },
      });
      assert.equal(stale.statusCode, 200);
      assert.equal(stale.headers['etag'], etag);

      // Advancing the chain tip invalidates the ETag.
      await db.update(
        new TestBlockBuilder({
          block_height: 2,
          index_block_hash: '0x0002',
          parent_index_block_hash: '0x0001',
          parent_block_hash: '0x0001',
        })
          .addTx({ tx_id: '0x0002' })
          .build()
      );

      const afterAdvance = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/transactions',
        headers: { 'if-none-match': etag as string },
      });
      assert.equal(afterAdvance.statusCode, 200);
      const newEtag = afterAdvance.headers['etag'];
      assert.ok(newEtag);
      assert.notEqual(newEtag, etag);
      assert.equal(newEtag, '"0x0002"');

      // The new ETag is now the cache key for 304s.
      const refreshed = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/transactions',
        headers: { 'if-none-match': newEtag as string },
      });
      assert.equal(refreshed.statusCode, 304);
    });
  });

  describe('/v3/transactions/:tx_id', () => {
    const SENDER = 'SP466FNC0P7JWTNM2R9T199QRZN1MYEDTAR0KP27';
    const CONTRACT_ID = 'SP000000000000000000002Q6VF78.pox-4';
    const SOURCE_CODE = '(define-public (test) (ok true))';
    const txCall = hex(0x5001);
    const txDeploy = hex(0x5002);

    // Seed one ContractCall (txCall) and one SmartContract (txDeploy). The ContractCall
    // carries function_args for the include test; the SmartContract carries source_code.
    // Both inherit the test-builder defaults for raw_result ('0x0703' → (ok true)) and
    // post_conditions ('0x01f5' → empty list).
    const seedTxs = async () => {
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          index_block_hash: hex(1),
          parent_index_block_hash: hex(0),
          parent_block_hash: hex(0),
        })
          .addTx({
            tx_id: txCall,
            block_hash: hex(1),
            index_block_hash: hex(1),
            block_time: 1000,
            burn_block_height: 1,
            burn_block_time: 1000,
            tx_index: 0,
            fee_rate: 50n,
            type_id: DbTxTypeId.ContractCall,
            status: DbTxStatus.Success,
            sender_address: SENDER,
            contract_call_contract_id: CONTRACT_ID,
            contract_call_function_name: 'stack-stx',
            contract_call_function_args: bufferToHex(
              createClarityValueArray(uintCV(123456), stringAsciiCV('hello'))
            ),
          })
          .addTx({
            tx_id: txDeploy,
            block_hash: hex(1),
            index_block_hash: hex(1),
            block_time: 1000,
            burn_block_height: 1,
            burn_block_time: 1000,
            tx_index: 1,
            fee_rate: 50n,
            type_id: DbTxTypeId.SmartContract,
            status: DbTxStatus.Success,
            sender_address: SENDER,
            smart_contract_contract_id: `${SENDER}.test`,
            smart_contract_clarity_version: 2,
            smart_contract_source_code: SOURCE_CODE,
          })
          .build()
      );
    };

    test('should return 404 for an unknown tx_id', async () => {
      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/transactions/${hex(0xdead)}`,
      });
      assert.equal(response.statusCode, 404);
    });

    test('should return a lean response by default — heavy fields omitted', async () => {
      await seedTxs();
      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/transactions/${txCall}`,
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.tx_id, txCall);
      assert.equal(body.type, 'contract_call');
      assert.equal(body.contract_call.contract_id, CONTRACT_ID);
      assert.equal(body.contract_call.function_name, 'stack-stx');
      // None of the opt-in fields should be present.
      assert.equal(body.contract_call.function_args, undefined);
      assert.equal(body.post_conditions, undefined);
      assert.equal(body.result, undefined);
    });

    test('should populate function_args, post_conditions, and result when requested', async () => {
      await seedTxs();
      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/transactions/${txCall}`,
        query: { include: 'function_args,post_conditions,result' },
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.tx_id, txCall);
      assert.deepEqual(body.contract_call.function_args, [
        { hex: '0x010000000000000000000000000001e240', repr: 'u123456' },
        { hex: '0x0d0000000568656c6c6f', repr: '"hello"' },
      ]);
      assert.deepEqual(body.post_conditions, []);
      assert.deepEqual(body.result, { hex: '0x0703', repr: '(ok true)' });
    });

    test('should populate source_code when requested', async () => {
      await seedTxs();
      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/transactions/${txDeploy}`,
        query: { include: 'source_code' },
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.tx_id, txDeploy);
      assert.equal(body.type, 'smart_contract');
      assert.equal(body.smart_contract.source_code, SOURCE_CODE);
      // The other heavy fields stay omitted.
      assert.equal(body.post_conditions, undefined);
      assert.equal(body.result, undefined);
    });

    test('should accept the repeated `?include=A&include=B` form', async () => {
      await seedTxs();
      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/transactions/${txCall}`,
        query: { include: ['result', 'post_conditions'] },
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.ok(body.result);
      assert.ok(body.post_conditions);
      // function_args was not requested → still omitted.
      assert.equal(body.contract_call.function_args, undefined);
    });

    test('should reject an unknown include value', async () => {
      await seedTxs();
      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/transactions/${txCall}`,
        query: { include: 'function_args,events' },
      });
      assert.equal(response.statusCode, 400);
    });

    test('should return 304 when ETag matches and refresh ETag per transaction', async () => {
      await seedTxs();
      const first = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/transactions/${txCall}`,
      });
      assert.equal(first.statusCode, 200);
      const etag = first.headers['etag'];
      assert.ok(etag, 'expected ETag header to be set');

      // Same ETag returns 304 with an empty body.
      const cached = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/transactions/${txCall}`,
        headers: { 'if-none-match': etag as string },
      });
      assert.equal(cached.statusCode, 304);
      assert.equal(cached.body, '');

      // A stale ETag returns 200 with the current data.
      const stale = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/transactions/${txCall}`,
        headers: { 'if-none-match': '"0xdeadbeef"' },
      });
      assert.equal(stale.statusCode, 200);
      assert.equal(stale.headers['etag'], etag);

      // A different tx_id returns a distinct ETag and does not 304 against txCall's ETag.
      const otherTx = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/transactions/${txDeploy}`,
        headers: { 'if-none-match': etag as string },
      });
      assert.equal(otherTx.statusCode, 200);
      assert.ok(otherTx.headers['etag']);
      assert.notEqual(otherTx.headers['etag'], etag);
    });
  });

  describe('/v3/transactions/:tx_id/events', () => {
    const sender = 'SP466FNC0P7JWTNM2R9T199QRZN1MYEDTAR0KP27';
    const recipient = 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6';

    test('should return transaction events sorted by event_index across event tables', async () => {
      const txId = hex(0x7001);
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          index_block_hash: hex(1),
          parent_index_block_hash: hex(0),
          parent_block_hash: hex(0),
        })
          .addTx({
            tx_id: txId,
            tx_index: 0,
            event_count: 5,
          })
          .addTxStxEvent({ amount: 101n })
          .addTxFtEvent({ amount: 202n, sender, recipient })
          .addTxNftEvent({ sender, recipient })
          .addTxStxLockEvent({ locked_amount: 303, unlock_height: 555, locked_address: sender })
          .addTxContractLogEvent()
          .build()
      );

      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/transactions/${txId}/events`,
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);

      assert.equal(body.total, 5);
      assert.equal(body.limit, 20);
      assert.deepEqual(body.cursor, {
        next: null,
        previous: null,
        current: '0',
      });
      assert.equal(body.results.length, 5);
      assert.deepEqual(
        body.results.map((event: { event_index: number }) => event.event_index),
        [0, 1, 2, 3, 4]
      );
      assert.deepEqual(
        body.results.map((event: { type: string }) => event.type),
        ['stx_asset', 'ft_asset', 'nft_asset', 'stx_lock', 'contract_log']
      );
    });

    test('should cursor paginate transaction events by event_index', async () => {
      const txId = hex(0x7002);
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          index_block_hash: hex(1),
          parent_index_block_hash: hex(0),
          parent_block_hash: hex(0),
        })
          .addTx({
            tx_id: txId,
            tx_index: 0,
            event_count: 5,
          })
          .addTxStxEvent()
          .addTxFtEvent({ sender, recipient })
          .addTxNftEvent({ sender, recipient })
          .addTxStxLockEvent({ locked_address: sender })
          .addTxContractLogEvent()
          .build()
      );

      const page1 = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/transactions/${txId}/events`,
        query: {
          limit: '2',
        },
      });
      assert.equal(page1.statusCode, 200);
      const body1 = JSON.parse(page1.body);
      assert.equal(body1.total, 5);
      assert.equal(body1.results.length, 2);
      assert.deepEqual(
        body1.results.map((event: { event_index: number }) => event.event_index),
        [0, 1]
      );
      assert.deepEqual(body1.cursor, {
        next: '2',
        previous: null,
        current: '0',
      });

      const page2 = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/transactions/${txId}/events`,
        query: {
          limit: '2',
          cursor: '2',
        },
      });
      assert.equal(page2.statusCode, 200);
      const body2 = JSON.parse(page2.body);
      assert.equal(body2.total, 5);
      assert.equal(body2.results.length, 2);
      assert.deepEqual(
        body2.results.map((event: { event_index: number }) => event.event_index),
        [2, 3]
      );
      assert.deepEqual(body2.cursor, {
        next: '4',
        previous: '0',
        current: '2',
      });

      const page3 = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/transactions/${txId}/events`,
        query: {
          limit: '2',
          cursor: '4',
        },
      });
      assert.equal(page3.statusCode, 200);
      const body3 = JSON.parse(page3.body);
      assert.equal(body3.total, 5);
      assert.equal(body3.results.length, 1);
      assert.deepEqual(
        body3.results.map((event: { event_index: number }) => event.event_index),
        [4]
      );
      assert.deepEqual(body3.cursor, {
        next: null,
        previous: '2',
        current: '4',
      });
    });
  });
});
