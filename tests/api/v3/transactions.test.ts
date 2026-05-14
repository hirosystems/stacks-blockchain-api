import { describe, test, beforeEach, afterEach } from 'node:test';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { ApiServer, startApiServer } from '../../../src/api/init.ts';
import { migrate } from '../../test-helpers.ts';
import { STACKS_TESTNET } from '@stacks/network';
import * as assert from 'node:assert/strict';
import { TestBlockBuilder } from '../test-builders.ts';
import { DbTxStatus, DbTxTypeId } from 'src/datastore/common.ts';

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
            token_transfer_memo: '0x',
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
          memo: '0x',
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
  });
});
