import { describe, test, beforeEach, afterEach } from 'node:test';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { ApiServer, startApiServer } from '../../../src/api/init.ts';
import { createClarityValueArray, migrate } from '../../test-helpers.ts';
import { STACKS_TESTNET } from '@stacks/network';
import * as assert from 'node:assert/strict';
import { TestBlockBuilder, testMempoolTx } from '../test-builders.ts';
import { DbTxStatus, DbTxTypeId } from '../../../src/datastore/common.ts';
import { stringAsciiCV, uintCV } from '@stacks/transactions';
import { bufferToHex } from '@stacks/api-toolkit';
import { assertTxTypeCountsConsistent, hex } from '../test-helpers.ts';
import { I32_MAX } from '../../../src/helpers.ts';

describe('v3 transactions', () => {
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
            event_count: 3,
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
          time_iso: '1970-01-01T00:33:20.000Z',
          tx_index: 0,
        },
        bitcoin_block: {
          height: 2,
          time: 2000,
          time_iso: '1970-01-01T00:33:20.000Z',
        },
        sender: {
          address: 'SP466FNC0P7JWTNM2R9T199QRZN1MYEDTAR0KP27',
          nonce: 0,
        },
        sponsor: null,
        fee_rate: '50',
        event_count: 3,
        token_transfer: {
          recipient: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
          amount: '100',
          memo: {
            hex: '0x0d0000000568656c6c6f',
            repr: 'hello',
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
          time_iso: '1970-01-01T00:16:40.000Z',
          tx_index: 0,
        },
        bitcoin_block: {
          height: 1,
          time: 1000,
          time_iso: '1970-01-01T00:16:40.000Z',
        },
        sender: {
          address: 'SP466FNC0P7JWTNM2R9T199QRZN1MYEDTAR0KP27',
          nonce: 0,
        },
        sponsor: null,
        fee_rate: '50',
        event_count: 0,
        coinbase: {
          alt_recipient: null,
        },
      });
    });

    test('should return problematic_skipped status', async () => {
      const txId = '0x' + '1'.padStart(64, '0');
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          index_block_hash: '0x0001',
          parent_index_block_hash: '0x0000',
          parent_block_hash: '0x0000',
        })
          .addTx({
            tx_id: txId,
            block_hash: '0x0001',
            index_block_hash: '0x0001',
            block_time: 1000,
            burn_block_height: 1,
            burn_block_time: 1000,
            tx_index: 0,
            fee_rate: 50n,
            type_id: DbTxTypeId.TokenTransfer,
            status: DbTxStatus.ProblematicSkipped,
            sender_address: 'SP466FNC0P7JWTNM2R9T199QRZN1MYEDTAR0KP27',
            token_transfer_recipient_address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
            token_transfer_amount: 100n,
            token_transfer_memo: '0x0d0000000568656c6c6f',
          })
          .build()
      );

      const listResponse = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/transactions',
      });
      assert.equal(listResponse.statusCode, 200);
      const listBody = JSON.parse(listResponse.body);
      assert.equal(listBody.total, 1);
      assert.equal(listBody.results[0].tx_id, txId);
      assert.equal(listBody.results[0].status, 'problematic_skipped');

      const detailResponse = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/transactions/${txId}`,
      });
      assert.equal(detailResponse.statusCode, 200);
      const detailBody = JSON.parse(detailResponse.body);
      assert.equal(detailBody.tx_id, txId);
      assert.equal(detailBody.status, 'problematic_skipped');
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

    test('should count genesis boot transactions adopted by block 1 in filtered totals', async () => {
      const block0 = new TestBlockBuilder({ block_height: 0, index_block_hash: hex(0xb0) })
        .addTx({ tx_id: hex(0xb001), tx_index: 0, type_id: DbTxTypeId.TokenTransfer })
        .addTx({
          tx_id: hex(0xb002),
          tx_index: 1,
          type_id: DbTxTypeId.SmartContract,
          smart_contract_contract_id: 'SP000000000000000000002Q6VF78.boot',
          smart_contract_source_code: '(define-public (f) (ok true))',
        })
        .build();
      await db.update(block0);
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          index_block_hash: hex(1),
          parent_index_block_hash: block0.block.index_block_hash,
          parent_block_hash: block0.block.block_hash,
        })
          .addTx({ tx_id: hex(0x100), tx_index: 0, type_id: DbTxTypeId.Coinbase })
          .build()
      );
      await assertTxTypeCountsConsistent(db);

      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/transactions',
        query: { type: 'smart_contract' },
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.total, 1);
      assert.deepEqual(
        body.results.map((r: { tx_id: string }) => r.tx_id),
        [hex(0xb002)]
      );
    });

    describe('type filter', () => {
      // Blocks 1-4 each hold a coinbase at index 0 and a token transfer at index 1. Block 2 adds a
      // contract call and block 3 a versioned contract deployment, both at index 2.
      beforeEach(async () => {
        for (let height = 1; height <= 4; height++) {
          const builder = new TestBlockBuilder({
            block_height: height,
            index_block_hash: hex(height),
            parent_index_block_hash: hex(height - 1),
            parent_block_hash: hex(height - 1),
          })
            .addTx({ tx_id: hex(height * 0x100), tx_index: 0, type_id: DbTxTypeId.Coinbase })
            .addTx({
              tx_id: hex(height * 0x100 + 1),
              tx_index: 1,
              type_id: DbTxTypeId.TokenTransfer,
            });
          if (height === 2) {
            builder.addTx({
              tx_id: hex(height * 0x100 + 2),
              tx_index: 2,
              type_id: DbTxTypeId.ContractCall,
              contract_call_contract_id: 'SP000000000000000000002Q6VF78.pox-4',
              contract_call_function_name: 'stack-stx',
              contract_call_function_args: bufferToHex(createClarityValueArray(uintCV(1))),
            });
          }
          if (height === 3) {
            builder.addTx({
              tx_id: hex(height * 0x100 + 2),
              tx_index: 2,
              type_id: DbTxTypeId.VersionedSmartContract,
              smart_contract_contract_id: 'SP466FNC0P7JWTNM2R9T199QRZN1MYEDTAR0KP27.contract',
              smart_contract_source_code: '(define-public (f) (ok true))',
              smart_contract_clarity_version: 2,
            });
          }
          await db.update(builder.build());
        }
      });

      const fetch = async (query: Record<string, string | string[]>) => {
        const response = await api.fastifyApp.inject({
          method: 'GET',
          url: '/extended/v3/transactions',
          query,
        });
        assert.equal(response.statusCode, 200);
        return JSON.parse(response.body);
      };

      test('should return only transactions of the requested type', async () => {
        const body = await fetch({ type: 'token_transfer' });
        assert.equal(body.total, 4);
        assert.deepEqual(
          body.results.map((r: { tx_id: string }) => r.tx_id),
          [hex(0x401), hex(0x301), hex(0x201), hex(0x101)]
        );
        assert.ok(body.results.every((r: { type: string }) => r.type === 'token_transfer'));

        const unfiltered = await fetch({});
        assert.equal(unfiltered.total, 10);
      });

      test('should merge several types in chain order', async () => {
        // `smart_contract` also covers versioned deployments.
        for (const query of [
          { type: 'coinbase,smart_contract' },
          { type: ['coinbase', 'smart_contract'] },
        ]) {
          const body = await fetch(query);
          assert.equal(body.total, 5);
          assert.deepEqual(
            body.results.map((r: { tx_id: string }) => r.tx_id),
            [hex(0x400), hex(0x302), hex(0x300), hex(0x200), hex(0x100)]
          );
        }
      });

      test('should paginate filtered results', async () => {
        const page1 = await fetch({ type: 'token_transfer,contract_call', limit: '2' });
        assert.equal(page1.total, 5);
        assert.deepEqual(
          page1.results.map((r: { tx_id: string }) => r.tx_id),
          [hex(0x401), hex(0x301)]
        );
        assert.deepEqual(page1.cursor, { next: '2:0:2', previous: null, current: '4:0:1' });

        const page2 = await fetch({
          type: 'token_transfer,contract_call',
          limit: '2',
          cursor: page1.cursor.next,
        });
        assert.equal(page2.total, 5);
        assert.deepEqual(
          page2.results.map((r: { tx_id: string }) => r.tx_id),
          [hex(0x202), hex(0x201)]
        );
        assert.deepEqual(page2.cursor, { next: '1:0:1', previous: '4:0:1', current: '2:0:2' });

        const page3 = await fetch({
          type: 'token_transfer,contract_call',
          limit: '2',
          cursor: page2.cursor.next,
        });
        assert.deepEqual(
          page3.results.map((r: { tx_id: string }) => r.tx_id),
          [hex(0x101)]
        );
        assert.deepEqual(page3.cursor, { next: null, previous: '2:0:2', current: '1:0:1' });
      });

      test('should resume from a cursor taken without the filter', async () => {
        const body = await fetch({ type: 'coinbase', cursor: '3:0:1' });
        assert.deepEqual(
          body.results.map((r: { tx_id: string }) => r.tx_id),
          [hex(0x300), hex(0x200), hex(0x100)]
        );
      });

      test('should treat a block-boundary cursor matching another type as the top of the block', async () => {
        // 3:0:0 is block 3's coinbase. Filtered to token transfers it must not be taken as an exact
        // position, or block 3's token transfer at index 1 would be skipped.
        const body = await fetch({ type: 'token_transfer', cursor: '3:0:0', limit: '1' });
        assert.deepEqual(
          body.results.map((r: { tx_id: string }) => r.tx_id),
          [hex(0x301)]
        );
      });

      test('should report the real total on an empty page past every match', async () => {
        // Block 2's contract call is the only one, and it is newer than the cursor.
        const body = await fetch({ type: 'contract_call', cursor: '1:0:1' });
        assert.equal(body.total, 1);
        assert.equal(body.results.length, 0);
        assert.deepEqual(body.cursor, { next: null, previous: null, current: null });
      });

      test('should return an empty page with a zero total for an absent type', async () => {
        const body = await fetch({ type: 'tenure_change' });
        assert.equal(body.total, 0);
        assert.equal(body.results.length, 0);
      });

      test('should reject an unknown type', async () => {
        const response = await api.fastifyApp.inject({
          method: 'GET',
          url: '/extended/v3/transactions',
          query: { type: 'token_transfer,nope' },
        });
        assert.equal(response.statusCode, 400);
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
      assert.equal(body.post_condition_mode, undefined);
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
      // No `smart_contracts` row for CONTRACT_ID → names unknown, types inferred from values.
      assert.deepEqual(body.contract_call.function_args, [
        {
          hex: '0x010000000000000000000000000001e240',
          repr: 'u123456',
          name: null,
          type: 'uint',
        },
        { hex: '0x0d0000000568656c6c6f', repr: '"hello"', name: null, type: '(string-ascii 5)' },
      ]);
      // '0x01f5' → allow mode, empty list.
      assert.equal(body.post_condition_mode, 'allow');
      assert.deepEqual(body.post_conditions, []);
      assert.deepEqual(body.result, { hex: '0x0703', repr: '(ok true)' });
    });

    describe('named function_args', () => {
      const DEPLOYER = 'SP3D6PV2ACBPEKYJTCMH7HEN02KP87QSP8KTEH335';
      const NAMED_CONTRACT_ID = `${DEPLOYER}.named-args`;
      const txNamedDeploy = hex(0x5101);
      const txNamedCall = hex(0x5102);
      // `memo` is declared wider than the value passed so the ABI type is distinguishable
      // from the one inferred from the value.
      const NAMED_ABI = {
        functions: [
          {
            name: 'other-fn',
            access: 'public',
            args: [{ name: 'flag', type: 'bool' }],
            outputs: { type: { response: { ok: 'bool', error: 'uint128' } } },
          },
          {
            name: 'stack-stx',
            access: 'public',
            args: [
              { name: 'amount-ustx', type: 'uint128' },
              { name: 'memo', type: { 'string-ascii': { length: 32 } } },
            ],
            outputs: { type: { response: { ok: 'bool', error: 'uint128' } } },
          },
        ],
        variables: [],
        maps: [],
        fungible_tokens: [],
        non_fungible_tokens: [],
      };

      const seedNamedCall = async (abi: string) => {
        await db.update(
          new TestBlockBuilder({
            block_height: 1,
            index_block_hash: hex(1),
            parent_index_block_hash: hex(0),
            parent_block_hash: hex(0),
          })
            .addTx({
              tx_id: txNamedDeploy,
              tx_index: 0,
              type_id: DbTxTypeId.SmartContract,
              status: DbTxStatus.Success,
              sender_address: DEPLOYER,
              smart_contract_contract_id: NAMED_CONTRACT_ID,
              smart_contract_source_code: SOURCE_CODE,
            })
            .addTxSmartContract({ contract_id: NAMED_CONTRACT_ID, abi })
            .addTx({
              tx_id: txNamedCall,
              tx_index: 1,
              type_id: DbTxTypeId.ContractCall,
              status: DbTxStatus.Success,
              sender_address: SENDER,
              contract_call_contract_id: NAMED_CONTRACT_ID,
              contract_call_function_name: 'stack-stx',
              contract_call_function_args: bufferToHex(
                createClarityValueArray(uintCV(123456), stringAsciiCV('hello'))
              ),
            })
            .build()
        );
      };

      test('should name function_args and use ABI types when the contract ABI is known', async () => {
        await seedNamedCall(JSON.stringify(NAMED_ABI));
        const response = await api.fastifyApp.inject({
          method: 'GET',
          url: `/extended/v3/transactions/${txNamedCall}`,
          query: { include: 'function_args' },
        });
        assert.equal(response.statusCode, 200);
        const body = JSON.parse(response.body);
        assert.deepEqual(body.contract_call.function_args, [
          {
            hex: '0x010000000000000000000000000001e240',
            repr: 'u123456',
            name: 'amount-ustx',
            type: 'uint',
          },
          {
            hex: '0x0d0000000568656c6c6f',
            repr: '"hello"',
            name: 'memo',
            type: '(string-ascii 32)',
          },
        ]);
      });

      test('should fall back to null names when the stored contract ABI is null', async () => {
        await seedNamedCall('null');
        const response = await api.fastifyApp.inject({
          method: 'GET',
          url: `/extended/v3/transactions/${txNamedCall}`,
          query: { include: 'function_args' },
        });
        assert.equal(response.statusCode, 200);
        const body = JSON.parse(response.body);
        assert.deepEqual(
          body.contract_call.function_args.map((a: { name: unknown; type: unknown }) => [
            a.name,
            a.type,
          ]),
          [
            [null, 'uint'],
            [null, '(string-ascii 5)'],
          ]
        );
      });

      test('should ignore the ABI of an orphaned contract deployment', async () => {
        // Fork A deploys the contract with an ABI; fork B (which wins) deploys it without one
        // and makes the call. The orphaned fork-A ABI must not leak into the canonical call.
        await db.update(
          new TestBlockBuilder({
            block_height: 1,
            block_hash: hex(0xa1),
            index_block_hash: hex(0xa1),
            parent_index_block_hash: hex(0),
            parent_block_hash: hex(0),
          })
            .addTx({
              tx_id: hex(0x5201),
              type_id: DbTxTypeId.SmartContract,
              status: DbTxStatus.Success,
              sender_address: DEPLOYER,
              smart_contract_contract_id: NAMED_CONTRACT_ID,
              smart_contract_source_code: SOURCE_CODE,
            })
            .addTxSmartContract({ contract_id: NAMED_CONTRACT_ID, abi: JSON.stringify(NAMED_ABI) })
            .build()
        );
        await db.update(
          new TestBlockBuilder({
            block_height: 1,
            block_hash: hex(0xb1),
            index_block_hash: hex(0xb1),
            parent_index_block_hash: hex(0),
            parent_block_hash: hex(0),
          })
            .addTx({
              tx_id: txNamedDeploy,
              tx_index: 0,
              type_id: DbTxTypeId.SmartContract,
              status: DbTxStatus.Success,
              sender_address: DEPLOYER,
              smart_contract_contract_id: NAMED_CONTRACT_ID,
              smart_contract_source_code: SOURCE_CODE,
            })
            .addTxSmartContract({ contract_id: NAMED_CONTRACT_ID, abi: 'null' })
            .addTx({
              tx_id: txNamedCall,
              tx_index: 1,
              type_id: DbTxTypeId.ContractCall,
              status: DbTxStatus.Success,
              sender_address: SENDER,
              contract_call_contract_id: NAMED_CONTRACT_ID,
              contract_call_function_name: 'stack-stx',
              contract_call_function_args: bufferToHex(
                createClarityValueArray(uintCV(123456), stringAsciiCV('hello'))
              ),
            })
            .build()
        );
        await db.update(
          new TestBlockBuilder({
            block_height: 2,
            block_hash: hex(0xb2),
            index_block_hash: hex(0xb2),
            parent_index_block_hash: hex(0xb1),
            parent_block_hash: hex(0xb1),
          })
            .addTx({ tx_id: hex(0x5203), sender_address: SENDER, nonce: 1 })
            .build()
        );
        const orphaned = await db.sql<{ canonical: boolean }[]>`
          SELECT canonical FROM smart_contracts WHERE tx_id = ${hex(0x5201)}
        `;
        assert.ok(orphaned.length > 0 && orphaned.every(r => r.canonical === false));

        const response = await api.fastifyApp.inject({
          method: 'GET',
          url: `/extended/v3/transactions/${txNamedCall}`,
          query: { include: 'function_args' },
        });
        assert.equal(response.statusCode, 200);
        const body = JSON.parse(response.body);
        assert.deepEqual(
          body.contract_call.function_args.map((a: { name: unknown; type: unknown }) => [
            a.name,
            a.type,
          ]),
          [
            [null, 'uint'],
            [null, '(string-ascii 5)'],
          ]
        );
      });

      test('should not return function_args when not requested', async () => {
        await seedNamedCall(JSON.stringify(NAMED_ABI));
        const response = await api.fastifyApp.inject({
          method: 'GET',
          url: `/extended/v3/transactions/${txNamedCall}`,
        });
        assert.equal(response.statusCode, 200);
        const body = JSON.parse(response.body);
        assert.equal(body.contract_call.function_args, undefined);
      });
    });

    test('should serialize the post condition mode alongside the post conditions', async () => {
      const txDeny = hex(0x5003);
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          index_block_hash: hex(1),
          parent_index_block_hash: hex(0),
          parent_block_hash: hex(0),
        })
          .addTx({
            tx_id: txDeny,
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
            contract_call_function_args: bufferToHex(createClarityValueArray(uintCV(1))),
            // Deny mode (0x02), one STX post condition: origin principal, sent_equal_to, 100 µSTX.
            post_conditions: '0x02000000010001010000000000000064',
          })
          .build()
      );
      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/transactions/${txDeny}`,
        query: { include: 'post_conditions' },
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.post_condition_mode, 'deny');
      assert.deepEqual(body.post_conditions, [
        {
          type: 'stx',
          condition_code: 'sent_equal_to',
          amount: '100',
          principal: { type_id: 'principal_origin' },
        },
      ]);
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
      assert.equal(body.post_condition_mode, undefined);
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

    test('should serialize NFT and FT events whose asset name contains a digit', async () => {
      // Regression for #2612: `AssetIdentifierSchema` rejected asset names with digits (e.g.
      // `BNS-V2`), causing response serialization to fail with HTTP 500.
      const txId = hex(0x7005);
      const nftAssetId = 'SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF.BNS-V2::BNS-V2';
      const ftAssetId = 'SP2QEZ06AGJ3RKJPBV14SY1V5BBFNAW33D96YPGZF.token-v2::wrapped-btc-2';
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          index_block_hash: hex(1),
          parent_index_block_hash: hex(0),
          parent_block_hash: hex(0),
        })
          .addTx({ tx_id: txId, tx_index: 0, event_count: 2 })
          .addTxNftEvent({ sender, recipient, asset_identifier: nftAssetId })
          .addTxFtEvent({ amount: 202n, sender, recipient, asset_identifier: ftAssetId })
          .build()
      );

      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/transactions/${txId}/events`,
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.total, 2);
      assert.deepEqual(
        body.results.map((event: { type: string }) => event.type),
        ['nft_asset', 'ft_asset']
      );
      assert.equal(body.results[0].nft_asset.asset_identifier, nftAssetId);
      assert.equal(body.results[1].ft_asset.asset_identifier, ftAssetId);
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

  describe('/v3/transactions/:tx_id/raw', () => {
    const SENDER = 'SP466FNC0P7JWTNM2R9T199QRZN1MYEDTAR0KP27';
    const minedTx = hex(0x6001);
    const minedRaw = '0x8080000000040012345678deadbeef';
    const mempoolTx = hex(0x6002);
    const mempoolRaw = '0x80800000000400abcdef0123456789';

    const getRaw = (txId: string) =>
      api.fastifyApp.inject({ method: 'GET', url: `/extended/v3/transactions/${txId}/raw` });
    const getV1Raw = (txId: string) =>
      api.fastifyApp.inject({ method: 'GET', url: `/extended/v1/tx/${txId}/raw` });

    const seedMinedTx = async (canonical = true) => {
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          index_block_hash: hex(1),
          parent_index_block_hash: hex(0),
          parent_block_hash: hex(0),
          canonical,
        })
          .addTx({
            tx_id: minedTx,
            block_hash: hex(1),
            index_block_hash: hex(1),
            sender_address: SENDER,
            raw_tx: minedRaw,
            canonical,
          })
          .build()
      );
    };

    test('should return the raw bytes of a mined transaction', async () => {
      await seedMinedTx();
      const response = await getRaw(minedTx);
      assert.equal(response.statusCode, 200);
      assert.deepEqual(JSON.parse(response.body), { raw: minedRaw });
    });

    test('should return the raw bytes of a mempool transaction', async () => {
      await db.updateMempoolTxs({
        mempoolTxs: [testMempoolTx({ tx_id: mempoolTx, raw_tx: mempoolRaw, nonce: 1 })],
      });
      const response = await getRaw(mempoolTx);
      assert.equal(response.statusCode, 200);
      assert.deepEqual(JSON.parse(response.body), { raw: mempoolRaw });
    });

    test('should match the v1 raw_tx byte for byte', async () => {
      await seedMinedTx();
      await db.updateMempoolTxs({
        mempoolTxs: [testMempoolTx({ tx_id: mempoolTx, raw_tx: mempoolRaw, nonce: 1 })],
      });
      for (const txId of [minedTx, mempoolTx]) {
        const v3 = await getRaw(txId);
        const v1 = await getV1Raw(txId);
        assert.equal(v3.statusCode, 200);
        assert.equal(v1.statusCode, 200);
        const body = JSON.parse(v3.body);
        assert.deepEqual(Object.keys(body), ['raw']);
        assert.equal(body.raw, JSON.parse(v1.body).raw_tx);
      }
    });

    test('should return 404 for an unknown tx_id', async () => {
      const response = await getRaw(hex(0xdead));
      assert.equal(response.statusCode, 404);
      assert.equal(JSON.parse(response.body).message, 'Transaction not found');
    });

    test('should return 404 for a pruned mempool transaction', async () => {
      await db.updateMempoolTxs({
        mempoolTxs: [testMempoolTx({ tx_id: mempoolTx, raw_tx: mempoolRaw, nonce: 1 })],
      });
      await db.dropMempoolTxs({
        status: DbTxStatus.DroppedReplaceByFee,
        txIds: [mempoolTx],
        new_tx_id: null,
      });
      // v1 ignores `pruned`, so it proves the row is still there.
      assert.equal((await getV1Raw(mempoolTx)).statusCode, 200);
      const response = await getRaw(mempoolTx);
      assert.equal(response.statusCode, 404);
    });

    test('should return 404 for a non-canonical transaction', async () => {
      await seedMinedTx(false);
      // v1 ignores `canonical`, so it proves the row is still there.
      assert.equal((await getV1Raw(minedTx)).statusCode, 200);
      const response = await getRaw(minedTx);
      assert.equal(response.statusCode, 404);
    });

    test('should redirect an unprefixed tx_id', async () => {
      const response = await getRaw(minedTx.slice(2));
      assert.equal(response.statusCode, 302);
      assert.equal(response.headers.location, `/extended/v3/transactions/${minedTx}/raw`);
    });
  });
});
