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

describe('principals', () => {
  let db: PgWriteStore;
  let api: ApiServer;

  const testAddr1 = 'ST3J8EVYHVKH6XXPD61EE8XEHW4Y2K83861225AB1';
  const testAddr2 = 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4';
  const testContractAddr = 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world';
  const testAddr4 = 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C';
  const emptyPrincipal = 'SP466FNC0P7JWTNM2R9T199QRZN1MYEDTAR0KP2X';

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    api = await startApiServer({ datastore: db, chainId: STACKS_TESTNET.chainId });

    // Setup test data
    await db.update(
      new TestBlockBuilder({
        block_height: 1,
        block_hash: hex(1),
        index_block_hash: hex(1),
        parent_index_block_hash: hex(0),
        parent_block_hash: hex(0),
      })
        .addTx({
          tx_id: hex(1),
          block_hash: hex(1),
          index_block_hash: hex(1),
          block_time: 1000,
          burn_block_height: 1,
          burn_block_time: 1000,
          tx_index: 0,
          fee_rate: 50n,
          type_id: DbTxTypeId.Coinbase,
          status: DbTxStatus.Success,
          sender_address: testAddr1,
        })
        .build()
    );
    const block2 = new TestBlockBuilder({
      block_height: 2,
      block_hash: hex(2),
      index_block_hash: hex(2),
      parent_index_block_hash: hex(1),
      parent_block_hash: hex(1),
    });
    let indexIdIndex = 0;
    const createTx = (
      block: TestBlockBuilder,
      sender: string,
      recipient: string,
      amount: number,
      stxEventCount = 1,
      ftEventCount = 1,
      nftEventCount = 1
    ) => {
      const tx_id = hex(indexIdIndex);
      block.addTx({
        tx_id,
        fee_rate: 50n,
        block_hash: hex(2),
        index_block_hash: hex(2),
        block_time: 2000,
        burn_block_height: 2,
        burn_block_time: 2000,
        type_id: DbTxTypeId.TokenTransfer,
        status: DbTxStatus.Success,
        sender_address: sender,
        nonce: indexIdIndex,
        token_transfer_memo: '0x0d0000000568656c6c6f',
      });
      for (let i = 0; i < stxEventCount; i++) {
        block.addTxStxEvent({
          amount: BigInt(amount),
          recipient,
          sender,
        });
      }
      for (let i = 0; i < ftEventCount; i++) {
        block.addTxFtEvent({
          amount: BigInt(amount),
          recipient,
          sender,
        });
      }
      for (let i = 0; i < nftEventCount; i++) {
        block.addTxNftEvent({
          recipient,
          sender,
        });
      }
      indexIdIndex++;
    };
    createTx(block2, testAddr4, testAddr2, 0, 1, 0, 0);
    createTx(block2, testAddr4, testAddr2, 0, 0, 1, 0);
    createTx(block2, testAddr4, testAddr2, 0, 0, 0, 1);
    createTx(block2, testAddr1, testAddr2, 100_000, 1, 1, 1);
    createTx(block2, testAddr2, testContractAddr, 100, 1, 2, 1);
    createTx(block2, testAddr2, testContractAddr, 250, 1, 0, 1);
    createTx(block2, testAddr2, testContractAddr, 40, 1, 1, 1);
    createTx(block2, testContractAddr, testAddr4, 15, 1, 1, 0);
    createTx(block2, testAddr2, testAddr4, 35, 3, 1, 2);
    await db.update(block2.build());
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await migrate('down');
  });

  describe('/v3/principals/:principal/transactions', () => {
    test('should return an empty list', async () => {
      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${emptyPrincipal}/transactions`,
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.deepEqual(body, {
        limit: 20,
        total: 0,
        cursor: {
          next: null,
          previous: null,
          current: null,
        },
        results: [],
      });
    });

    test('should return a list of principal transaction summaries', async () => {
      const response1 = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${testAddr1}/transactions`,
      });
      assert.equal(response1.statusCode, 200);
      const body1 = JSON.parse(response1.body);
      assert.equal(body1.total, 2);
      assert.equal(body1.limit, 20);
      assert.equal(body1.results.length, 2);
      assert.deepEqual(body1.results[0], {
        transaction: {
          tx_id: hex(3),
          sender: {
            address: 'ST3J8EVYHVKH6XXPD61EE8XEHW4Y2K83861225AB1',
            nonce: 3,
          },
          sponsor: null,
          fee_rate: '50',
          block: {
            height: 2,
            hash: hex(2),
            index_hash: hex(2),
            time: 2000,
            tx_index: 3,
          },
          bitcoin_block: {
            height: 2,
            time: 2000,
          },
          status: 'success',
          type: 'token_transfer',
          token_transfer: {
            recipient: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
            amount: '100',
            memo: {
              hex: '0x0d0000000568656c6c6f',
              repr: '"hello"',
            },
          },
        },
        involvement: 'sender',
        balance_changes: {
          stx: {
            sent: '100050',
            received: '0',
            net: '-100050',
          },
        },
        affected_balances: {
          stx: true,
          ft: true,
          nft: true,
        },
      });
      assert.deepEqual(body1.results[1], {
        transaction: {
          tx_id: hex(1),
          sender: {
            address: 'ST3J8EVYHVKH6XXPD61EE8XEHW4Y2K83861225AB1',
            nonce: 0,
          },
          sponsor: null,
          fee_rate: '50',
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
          status: 'success',
          type: 'coinbase',
          coinbase: {
            alt_recipient: null,
          },
        },
        involvement: 'sender',
        balance_changes: {
          stx: {
            sent: '50',
            received: '0',
            net: '-50',
          },
        },
        affected_balances: {
          stx: true,
          ft: false,
          nft: false,
        },
      });

      // Try for address 4
      const response4 = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${testAddr4}/transactions`,
      });
      assert.equal(response4.statusCode, 200);
      const body4 = JSON.parse(response4.body);
      assert.equal(body4.total, 5);
      assert.equal(body4.limit, 20);
      assert.equal(body4.results.length, 5);
      assert.equal(body4.results[0].transaction.tx_id, hex(8));
      assert.equal(body4.results[1].transaction.tx_id, hex(7));
      assert.equal(body4.results[2].transaction.tx_id, hex(2));
      assert.equal(body4.results[3].transaction.tx_id, hex(1));
      assert.equal(body4.results[4].transaction.tx_id, hex(0));
    });

    test('should allow cursor pagination', async () => {
      for (let i = 3; i <= 12; i++) {
        const hexValue = hex(i);
        const prevHex = hex(i - 1);
        const builder = new TestBlockBuilder({
          block_height: i,
          index_block_hash: hexValue,
          parent_index_block_hash: prevHex,
          parent_block_hash: prevHex,
        });
        for (let j = 1; j <= 5; j++) {
          builder.addTx({
            tx_id: hex(i * j),
            block_hash: hexValue,
            index_block_hash: hexValue,
            block_time: i * 1000,
            burn_block_height: i,
            burn_block_time: i * 1000,
            sender_address: emptyPrincipal,
          });
        }
        await db.update(builder.build());
      }

      // Fetch first page
      const page1 = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${emptyPrincipal}/transactions`,
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
        next: '11:0:4',
        previous: null,
        current: '12:0:4',
      });

      // Fetch second page
      const page2 = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${emptyPrincipal}/transactions`,
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

      // Fetch a partial page that has fewer than `limit` newer rows. The previous
      // cursor should still point back to the first available row.
      const partialPreviousPage = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${emptyPrincipal}/transactions`,
        query: {
          limit: '5',
          cursor: '12:0:2',
        },
      });
      assert.equal(partialPreviousPage.statusCode, 200);
      const partialPreviousBody = JSON.parse(partialPreviousPage.body);
      assert.equal(partialPreviousBody.results.length, 5);
      assert.deepEqual(partialPreviousBody.cursor, {
        next: '11:0:2',
        previous: '12:0:4',
        current: '12:0:2',
      });
    });

    test('should allow block-boundary cursors for anchored transactions', async () => {
      await db.update(
        new TestBlockBuilder({
          block_height: 3,
          block_hash: hex(3),
          index_block_hash: hex(3),
          parent_index_block_hash: hex(2),
          parent_block_hash: hex(2),
        })
          .addTx({
            tx_id: hex(0x3001),
            block_hash: hex(3),
            index_block_hash: hex(3),
            block_time: 3000,
            burn_block_height: 3,
            burn_block_time: 3000,
            tx_index: 0,
            microblock_sequence: I32_MAX,
            sender_address: emptyPrincipal,
          })
          .build()
      );

      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${emptyPrincipal}/transactions`,
        query: {
          limit: '1',
          cursor: '3:0:0',
        },
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.results.length, 1);
      assert.equal(body.results[0].transaction.tx_id, hex(0x3001));
      assert.deepEqual(body.cursor, {
        next: null,
        previous: null,
        current: `3:${I32_MAX}:0`,
      });
    });

    test('should preserve exact height:0:0 transaction cursors', async () => {
      await db.update(
        new TestBlockBuilder({
          block_height: 3,
          block_hash: hex(3),
          index_block_hash: hex(3),
          parent_index_block_hash: hex(2),
          parent_block_hash: hex(2),
        })
          .addTx({
            tx_id: hex(0x3001),
            block_hash: hex(3),
            index_block_hash: hex(3),
            block_time: 3000,
            burn_block_height: 3,
            burn_block_time: 3000,
            tx_index: 0,
            microblock_sequence: 0,
            sender_address: emptyPrincipal,
          })
          .addTx({
            tx_id: hex(0x3002),
            block_hash: hex(3),
            index_block_hash: hex(3),
            block_time: 3000,
            burn_block_height: 3,
            burn_block_time: 3000,
            tx_index: 1,
            microblock_sequence: I32_MAX,
            sender_address: emptyPrincipal,
          })
          .build()
      );

      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${emptyPrincipal}/transactions`,
        query: {
          limit: '1',
          cursor: '3:0:0',
        },
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.results.length, 1);
      assert.equal(body.results[0].transaction.tx_id, hex(0x3001));
      assert.deepEqual(body.cursor, {
        next: null,
        previous: `3:${I32_MAX}:1`,
        current: '3:0:0',
      });
    });

    test('should return 304 when ETag matches and refresh ETag on new principal activity', async () => {
      // testAddr1 has confirmed activity from the setup, so the principal cache is populated.
      const first = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${testAddr1}/transactions`,
      });
      assert.equal(first.statusCode, 200);
      const etag = first.headers['etag'];
      assert.ok(etag, 'expected ETag header to be set');

      // Same ETag returns 304 with an empty body.
      const cached = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${testAddr1}/transactions`,
        headers: { 'if-none-match': etag as string },
      });
      assert.equal(cached.statusCode, 304);
      assert.equal(cached.body, '');

      // A stale ETag returns 200 with the current data and ETag.
      const stale = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${testAddr1}/transactions`,
        headers: { 'if-none-match': '"0xdeadbeef"' },
      });
      assert.equal(stale.statusCode, 200);
      assert.equal(stale.headers['etag'], etag);

      // A request for a different principal returns a different ETag (or none, if the
      // principal has no activity), and does not collide with testAddr1's cache.
      const otherPrincipal = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${testAddr2}/transactions`,
        headers: { 'if-none-match': etag as string },
      });
      assert.equal(otherPrincipal.statusCode, 200);
      assert.notEqual(otherPrincipal.headers['etag'], etag);

      // New confirmed activity for testAddr1 invalidates its ETag.
      await db.update(
        new TestBlockBuilder({
          block_height: 3,
          block_hash: hex(3),
          index_block_hash: hex(3),
          parent_index_block_hash: hex(2),
          parent_block_hash: hex(2),
        })
          .addTx({
            tx_id: hex(0x1001),
            fee_rate: 50n,
            block_hash: hex(3),
            index_block_hash: hex(3),
            block_time: 3000,
            burn_block_height: 3,
            burn_block_time: 3000,
            type_id: DbTxTypeId.TokenTransfer,
            status: DbTxStatus.Success,
            sender_address: testAddr1,
            nonce: 100,
            token_transfer_memo: '0x0d0000000568656c6c6f',
          })
          .build()
      );

      const afterActivity = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${testAddr1}/transactions`,
        headers: { 'if-none-match': etag as string },
      });
      assert.equal(afterActivity.statusCode, 200);
      const newEtag = afterActivity.headers['etag'];
      assert.ok(newEtag);
      assert.notEqual(newEtag, etag);

      // The new ETag is now the cache key for 304s.
      const refreshed = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${testAddr1}/transactions`,
        headers: { 'if-none-match': newEtag as string },
      });
      assert.equal(refreshed.statusCode, 304);
    });
  });
});
