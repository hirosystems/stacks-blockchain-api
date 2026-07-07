import { describe, test, beforeEach, afterEach } from 'node:test';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { ApiServer, startApiServer } from '../../../src/api/init.ts';
import { migrate } from '../../test-helpers.ts';
import { STACKS_TESTNET } from '@stacks/network';
import * as assert from 'node:assert/strict';
import { TestBlockBuilder, testMempoolTx } from '../test-builders.ts';
import { DbTxStatus, DbTxTypeId } from '../../../src/datastore/common.ts';
import { hex } from '../test-helpers.ts';
import { I32_MAX } from '../../../src/helpers.ts';
import { serializeCV, uintCV } from '@stacks/transactions';

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
              repr: 'hello',
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

  describe('/v3/principals/:principal/transactions/:tx_id/balance-changes', () => {
    test('should return an empty list', async () => {
      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${emptyPrincipal}/transactions/${hex(0xdeadbeef)}/balance-changes`,
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

    test('should return a list of balance changes with cursor pagination', async () => {
      const response1 = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${testAddr1}/transactions/${hex(3)}/balance-changes`,
      });
      assert.equal(response1.statusCode, 200);
      const body1 = JSON.parse(response1.body);
      assert.deepEqual(body1, {
        limit: 20,
        total: 3,
        cursor: {
          next: null,
          previous: null,
          current: '1:stx',
        },
        results: [
          {
            asset: {
              type: 'stx',
            },
            balance_change: {
              sent: '100050',
              received: '0',
              net: '-100050',
            },
          },
          {
            asset: {
              type: 'ft',
              identifier:
                'SP2H8PY27SEZ03MWRKS5XABZYQN17ETGQS3527SA5.newyorkcitycoin-token::newyorkcitycoin',
            },
            balance_change: {
              sent: '100000',
              received: '0',
              net: '-100000',
            },
          },
          {
            asset: {
              type: 'nft',
              identifier: 'SP3D6PV2ACBPEKYJTCMH7HEN02KP87QSP8KTEH335.Candies::candy',
            },
            balance_change: {
              sent: '1',
              received: '0',
              net: '-1',
            },
          },
        ],
      });

      const response2 = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${testAddr1}/transactions/${hex(3)}/balance-changes`,
        query: {
          limit: '1',
          cursor: '1:stx',
        },
      });
      assert.equal(response2.statusCode, 200);
      const body2 = JSON.parse(response2.body);
      assert.deepEqual(body2, {
        limit: 1,
        total: 3,
        cursor: {
          next: '2:SP2H8PY27SEZ03MWRKS5XABZYQN17ETGQS3527SA5.newyorkcitycoin-token::newyorkcitycoin',
          previous: null,
          current: '1:stx',
        },
        results: [
          {
            asset: {
              type: 'stx',
            },
            balance_change: {
              sent: '100050',
              received: '0',
              net: '-100050',
            },
          },
        ],
      });

      const response3 = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${testAddr1}/transactions/${hex(3)}/balance-changes`,
        query: {
          limit: '1',
          cursor:
            '2:SP2H8PY27SEZ03MWRKS5XABZYQN17ETGQS3527SA5.newyorkcitycoin-token::newyorkcitycoin',
        },
      });
      assert.equal(response3.statusCode, 200);
      const body3 = JSON.parse(response3.body);
      assert.deepEqual(body3, {
        limit: 1,
        total: 3,
        cursor: {
          next: '3:SP3D6PV2ACBPEKYJTCMH7HEN02KP87QSP8KTEH335.Candies::candy',
          previous: '1:stx',
          current:
            '2:SP2H8PY27SEZ03MWRKS5XABZYQN17ETGQS3527SA5.newyorkcitycoin-token::newyorkcitycoin',
        },
        results: [
          {
            asset: {
              type: 'ft',
              identifier:
                'SP2H8PY27SEZ03MWRKS5XABZYQN17ETGQS3527SA5.newyorkcitycoin-token::newyorkcitycoin',
            },
            balance_change: {
              sent: '100000',
              received: '0',
              net: '-100000',
            },
          },
        ],
      });
    });

    test('should return 304 when ETag matches and refresh ETag per transaction', async () => {
      // The balance-changes-by-tx endpoint uses the per-transaction ETag, so the cache key
      // is scoped to (principal, tx_id).
      const first = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${testAddr1}/transactions/${hex(3)}/balance-changes`,
      });
      assert.equal(first.statusCode, 200);
      const etag = first.headers['etag'];
      assert.ok(etag, 'expected ETag header to be set');

      // Same ETag returns 304 with an empty body.
      const cached = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${testAddr1}/transactions/${hex(3)}/balance-changes`,
        headers: { 'if-none-match': etag as string },
      });
      assert.equal(cached.statusCode, 304);
      assert.equal(cached.body, '');

      // A stale ETag returns 200 with the current data and ETag.
      const stale = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${testAddr1}/transactions/${hex(3)}/balance-changes`,
        headers: { 'if-none-match': '"0xdeadbeef"' },
      });
      assert.equal(stale.statusCode, 200);
      assert.equal(stale.headers['etag'], etag);

      // A different tx_id returns a distinct ETag and does not 304 against tx hex(3)'s ETag.
      const otherTx = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${testAddr1}/transactions/${hex(1)}/balance-changes`,
        headers: { 'if-none-match': etag as string },
      });
      assert.equal(otherTx.statusCode, 200);
      assert.ok(otherTx.headers['etag']);
      assert.notEqual(otherTx.headers['etag'], etag);
    });
  });

  describe('/v3/principals/:principal/balance-changes', () => {
    test('should require at least one tx_id', async () => {
      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${testAddr1}/balance-changes`,
      });
      assert.equal(response.statusCode, 400);
    });

    test('should return an empty list when the principal has no activity on the requested txs', async () => {
      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${emptyPrincipal}/balance-changes`,
        query: { tx_id: hex(3) },
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

    test('should return balance changes across multiple txs ordered by chain position desc then asset asc', async () => {
      // testAddr1 has activity on:
      //   - hex(1): coinbase in block 1 → stx fee only
      //   - hex(3): token transfer in block 2 → stx + ft + nft
      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${testAddr1}/balance-changes`,
        query: { tx_id: [hex(1), hex(3)] },
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.limit, 20);
      assert.equal(body.total, 4);
      assert.equal(body.results.length, 4);
      assert.deepEqual(body.cursor, {
        next: null,
        previous: null,
        current: '2:0:3:1:stx',
      });
      assert.deepEqual(body.results, [
        {
          tx_id: hex(3),
          asset: { type: 'stx' },
          balance_change: { sent: '100050', received: '0', net: '-100050' },
        },
        {
          tx_id: hex(3),
          asset: {
            type: 'ft',
            identifier:
              'SP2H8PY27SEZ03MWRKS5XABZYQN17ETGQS3527SA5.newyorkcitycoin-token::newyorkcitycoin',
          },
          balance_change: { sent: '100000', received: '0', net: '-100000' },
        },
        {
          tx_id: hex(3),
          asset: {
            type: 'nft',
            identifier: 'SP3D6PV2ACBPEKYJTCMH7HEN02KP87QSP8KTEH335.Candies::candy',
          },
          balance_change: { sent: '1', received: '0', net: '-1' },
        },
        {
          tx_id: hex(1),
          asset: { type: 'stx' },
          balance_change: { sent: '50', received: '0', net: '-50' },
        },
      ]);
    });

    test('should accept comma-separated tx_id values', async () => {
      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${testAddr1}/balance-changes`,
        query: { tx_id: `${hex(1)},${hex(3)}` },
      });
      assert.equal(response.statusCode, 200);
      const body = JSON.parse(response.body);
      assert.equal(body.total, 4);
      assert.equal(body.results.length, 4);
      assert.equal(body.results[0].tx_id, hex(3));
      assert.equal(body.results[3].tx_id, hex(1));
    });

    test('should allow cursor pagination', async () => {
      // First page: limit 2 → first two entries of tx hex(3).
      const page1 = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${testAddr1}/balance-changes`,
        query: { tx_id: [hex(1), hex(3)], limit: '2' },
      });
      assert.equal(page1.statusCode, 200);
      const body1 = JSON.parse(page1.body);
      assert.equal(body1.total, 4);
      assert.equal(body1.limit, 2);
      assert.equal(body1.results.length, 2);
      assert.equal(body1.results[0].tx_id, hex(3));
      assert.equal(body1.results[0].asset.type, 'stx');
      assert.equal(body1.results[1].asset.type, 'ft');
      assert.deepEqual(body1.cursor, {
        next: '2:0:3:3:SP3D6PV2ACBPEKYJTCMH7HEN02KP87QSP8KTEH335.Candies::candy',
        previous: null,
        current: '2:0:3:1:stx',
      });

      // Second page: starts at the nft of hex(3), then crosses over to the stx of hex(1).
      const page2 = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${testAddr1}/balance-changes`,
        query: {
          tx_id: [hex(1), hex(3)],
          limit: '2',
          cursor: '2:0:3:3:SP3D6PV2ACBPEKYJTCMH7HEN02KP87QSP8KTEH335.Candies::candy',
        },
      });
      assert.equal(page2.statusCode, 200);
      const body2 = JSON.parse(page2.body);
      assert.equal(body2.results.length, 2);
      assert.equal(body2.results[0].tx_id, hex(3));
      assert.equal(body2.results[0].asset.type, 'nft');
      assert.equal(body2.results[1].tx_id, hex(1));
      assert.equal(body2.results[1].asset.type, 'stx');
      assert.deepEqual(body2.cursor, {
        next: null,
        previous: '2:0:3:1:stx',
        current: '2:0:3:3:SP3D6PV2ACBPEKYJTCMH7HEN02KP87QSP8KTEH335.Candies::candy',
      });
    });

    test('should return 304 when ETag matches and refresh ETag on new principal activity', async () => {
      // This endpoint uses the principal cache, so the ETag tracks the principal's last
      // confirmed activity — independent of the requested tx_id batch.
      const first = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${testAddr1}/balance-changes`,
        query: { tx_id: hex(3) },
      });
      assert.equal(first.statusCode, 200);
      const etag = first.headers['etag'];
      assert.ok(etag, 'expected ETag header to be set');

      // Same ETag returns 304 with an empty body.
      const cached = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${testAddr1}/balance-changes`,
        query: { tx_id: hex(3) },
        headers: { 'if-none-match': etag as string },
      });
      assert.equal(cached.statusCode, 304);
      assert.equal(cached.body, '');

      // A stale ETag returns 200 with the current data and ETag.
      const stale = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${testAddr1}/balance-changes`,
        query: { tx_id: hex(3) },
        headers: { 'if-none-match': '"0xdeadbeef"' },
      });
      assert.equal(stale.statusCode, 200);
      assert.equal(stale.headers['etag'], etag);

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
          })
          .build()
      );
      const afterActivity = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${testAddr1}/balance-changes`,
        query: { tx_id: hex(3) },
        headers: { 'if-none-match': etag as string },
      });
      assert.equal(afterActivity.statusCode, 200);
      const newEtag = afterActivity.headers['etag'];
      assert.ok(newEtag);
      assert.notEqual(newEtag, etag);
    });
  });

  describe('/v3/principals/:principal/balances/stx', () => {
    // Fresh principals not touched by the shared block setup.
    const balAddr = 'ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5';
    const lockAddr = 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP';

    const getStxBalance = async (principal: string) => {
      const res = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${principal}/balances/stx`,
      });
      assert.equal(res.statusCode, 200, res.body);
      return JSON.parse(res.body);
    };

    // Block 3: credits `balAddr` 1,000,000 µSTX, and credits + locks 400,000 of
    // `lockAddr`'s STX via a pox-4 lock that unlocks far in the future.
    const buildBlock3 = () =>
      new TestBlockBuilder({
        block_height: 3,
        block_hash: hex(3),
        index_block_hash: hex(3),
        parent_index_block_hash: hex(2),
        parent_block_hash: hex(2),
        burn_block_height: 3,
      })
        .addTx({
          tx_id: hex(301),
          block_hash: hex(3),
          index_block_hash: hex(3),
          burn_block_height: 3,
          sender_address: testAddr4,
        })
        .addTxStxEvent({ recipient: balAddr, sender: testAddr4, amount: 1_000_000n })
        .addTx({
          tx_id: hex(302),
          block_hash: hex(3),
          index_block_hash: hex(3),
          burn_block_height: 3,
          tx_index: 1,
          sender_address: testAddr4,
        })
        .addTxStxEvent({ recipient: lockAddr, sender: testAddr4, amount: 1_000_000n })
        .addTxStxLockEvent({
          locked_address: lockAddr,
          locked_amount: 400_000,
          unlock_height: 1000,
          contract_name: 'pox-4',
        })
        .build();

    test('returns zeroed balance for a principal with no activity', async () => {
      const body = await getStxBalance(emptyPrincipal);
      assert.deepEqual(body, {
        balance: '0',
        available: '0',
        locked: null,
        mempool: null,
      });
    });

    test('returns the confirmed STX balance with no lock or mempool activity', async () => {
      await db.update(buildBlock3());
      const body = await getStxBalance(balAddr);
      assert.deepEqual(body, {
        balance: '1000000',
        available: '1000000',
        locked: null,
        mempool: null,
      });
    });

    test('reports locked STX with available = balance − locked', async () => {
      await db.update(buildBlock3());
      const body = await getStxBalance(lockAddr);
      assert.equal(body.balance, '1000000');
      assert.equal(body.available, '600000');
      assert.equal(body.mempool, null);
      assert.deepEqual(body.locked, {
        amount: '400000',
        pox_version: 4,
        lock_tx_id: hex(302),
        stacks_lock_height: 3,
        burn_lock_height: 3,
        burn_unlock_height: 1000,
      });
    });

    test('includes pending mempool balance and projects the estimated balance', async () => {
      await db.update(buildBlock3());
      // A pending outbound transfer of 50,000 µSTX + 1,234 fee from balAddr.
      await db.updateMempoolTxs({
        mempoolTxs: [
          testMempoolTx({
            tx_id: hex(401),
            sender_address: balAddr,
            token_transfer_amount: 50_000n,
            fee_rate: 1_234n,
          }),
        ],
      });
      const body = await getStxBalance(balAddr);
      assert.equal(body.balance, '1000000');
      assert.equal(body.available, '1000000');
      assert.equal(body.locked, null);
      assert.deepEqual(body.mempool, {
        // available (1,000,000) − outbound (50,000 + 1,234)
        estimated_balance: '948766',
        inbound: '0',
        outbound: '51234',
      });
    });

    test('ETag tracks mempool changes (handlePrincipalMempoolCache)', async () => {
      await db.update(buildBlock3());

      const first = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${balAddr}/balances/stx`,
      });
      assert.equal(first.statusCode, 200);
      const etag = first.headers['etag'];
      assert.ok(etag, 'expected ETag header to be set');

      // Same ETag returns 304.
      const cached = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${balAddr}/balances/stx`,
        headers: { 'if-none-match': etag as string },
      });
      assert.equal(cached.statusCode, 304);
      assert.equal(cached.body, '');

      // A new pending mempool tx for the principal invalidates the ETag.
      await db.updateMempoolTxs({
        mempoolTxs: [
          testMempoolTx({
            tx_id: hex(402),
            sender_address: balAddr,
            token_transfer_amount: 10_000n,
            fee_rate: 500n,
          }),
        ],
      });

      const afterMempool = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${balAddr}/balances/stx`,
        headers: { 'if-none-match': etag as string },
      });
      assert.equal(afterMempool.statusCode, 200);
      const newEtag = afterMempool.headers['etag'];
      assert.ok(newEtag);
      assert.notEqual(newEtag, etag);
    });
  });

  describe('/v3/principals/:principal/balances/ft', () => {
    const ftAddr = 'ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5';
    const tokenBig = 'SP000000000000000000002Q6VF78.token-big::big';
    const tokenMid = 'SP000000000000000000002Q6VF78.token-mid::mid';
    const tokenSmall = 'SP000000000000000000002Q6VF78.token-small::small';
    const tokenZero = 'SP000000000000000000002Q6VF78.token-zero::zero';

    const getFtBalances = async (principal: string, query: Record<string, string> = {}) => {
      const res = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${principal}/balances/ft`,
        query,
      });
      assert.equal(res.statusCode, 200, res.body);
      return JSON.parse(res.body);
    };

    // Block 3: credits `ftAddr` three tokens of distinct balances, an STX
    // balance (must be excluded), and a token that nets to zero (must be excluded).
    const buildFtBlock = () =>
      new TestBlockBuilder({
        block_height: 3,
        block_hash: hex(3),
        index_block_hash: hex(3),
        parent_index_block_hash: hex(2),
        parent_block_hash: hex(2),
        burn_block_height: 3,
      })
        .addTx({
          tx_id: hex(310),
          block_hash: hex(3),
          index_block_hash: hex(3),
          burn_block_height: 3,
          sender_address: testAddr4,
        })
        .addTxStxEvent({ recipient: ftAddr, sender: testAddr4, amount: 9_999n })
        .addTxFtEvent({
          recipient: ftAddr,
          sender: testAddr4,
          asset_identifier: tokenBig,
          amount: 3_000_000n,
        })
        .addTxFtEvent({
          recipient: ftAddr,
          sender: testAddr4,
          asset_identifier: tokenMid,
          amount: 2_000_000n,
        })
        .addTxFtEvent({
          recipient: ftAddr,
          sender: testAddr4,
          asset_identifier: tokenSmall,
          amount: 1_000_000n,
        })
        .addTxFtEvent({
          recipient: ftAddr,
          sender: testAddr4,
          asset_identifier: tokenZero,
          amount: 500_000n,
        })
        .addTxFtEvent({
          sender: ftAddr,
          recipient: testAddr4,
          asset_identifier: tokenZero,
          amount: 500_000n,
        })
        .build();

    test('returns an empty page for a principal with no FT balances', async () => {
      const body = await getFtBalances(emptyPrincipal);
      assert.deepEqual(body, {
        total: 0,
        limit: 100,
        cursor: { next: null, previous: null, current: null },
        results: [],
      });
    });

    test('lists FT positions sorted by balance descending, excluding stx and zero balances', async () => {
      await db.update(buildFtBlock());
      const body = await getFtBalances(ftAddr);
      assert.equal(body.total, 3);
      assert.deepEqual(body.results, [
        { asset_identifier: tokenBig, balance: '3000000' },
        { asset_identifier: tokenMid, balance: '2000000' },
        { asset_identifier: tokenSmall, balance: '1000000' },
      ]);
      assert.deepEqual(body.cursor, { next: null, previous: null, current: `3000000:${tokenBig}` });
    });

    test('paginates with cursors across pages', async () => {
      await db.update(buildFtBlock());

      // Page 1.
      const page1 = await getFtBalances(ftAddr, { limit: '1' });
      assert.equal(page1.total, 3);
      assert.equal(page1.limit, 1);
      assert.deepEqual(page1.results, [{ asset_identifier: tokenBig, balance: '3000000' }]);
      assert.deepEqual(page1.cursor, {
        next: `2000000:${tokenMid}`,
        previous: null,
        current: `3000000:${tokenBig}`,
      });

      // Page 2.
      const page2 = await getFtBalances(ftAddr, { limit: '1', cursor: page1.cursor.next });
      assert.deepEqual(page2.results, [{ asset_identifier: tokenMid, balance: '2000000' }]);
      assert.deepEqual(page2.cursor, {
        next: `1000000:${tokenSmall}`,
        previous: `3000000:${tokenBig}`,
        current: `2000000:${tokenMid}`,
      });

      // Page 3 (last).
      const page3 = await getFtBalances(ftAddr, { limit: '1', cursor: page2.cursor.next });
      assert.deepEqual(page3.results, [{ asset_identifier: tokenSmall, balance: '1000000' }]);
      assert.deepEqual(page3.cursor, {
        next: null,
        previous: `2000000:${tokenMid}`,
        current: `1000000:${tokenSmall}`,
      });
    });

    describe('single token lookup', () => {
      const getFtBalance = (principal: string, assetIdentifier: string) =>
        api.fastifyApp.inject({
          method: 'GET',
          url: `/extended/v3/principals/${principal}/balances/ft/${assetIdentifier}`,
        });

      test('returns the balance for a single held token', async () => {
        await db.update(buildFtBlock());
        const res = await getFtBalance(ftAddr, tokenMid);
        assert.equal(res.statusCode, 200, res.body);
        assert.deepEqual(JSON.parse(res.body), {
          asset_identifier: tokenMid,
          balance: '2000000',
        });
      });

      test('returns a zero balance for a token the principal does not hold', async () => {
        await db.update(buildFtBlock());
        const tokenNone = 'SP000000000000000000002Q6VF78.token-none::none';
        const res = await getFtBalance(ftAddr, tokenNone);
        assert.equal(res.statusCode, 200, res.body);
        assert.deepEqual(JSON.parse(res.body), {
          asset_identifier: tokenNone,
          balance: '0',
        });
      });

      test('returns a zero balance for a token that nets to zero', async () => {
        await db.update(buildFtBlock());
        const res = await getFtBalance(ftAddr, tokenZero);
        assert.equal(res.statusCode, 200, res.body);
        assert.deepEqual(JSON.parse(res.body), {
          asset_identifier: tokenZero,
          balance: '0',
        });
      });

      test('rejects a malformed asset identifier with 400', async () => {
        const res = await getFtBalance(ftAddr, 'not-a-valid-asset-id');
        assert.equal(res.statusCode, 400, res.body);
      });
    });
  });

  describe('/v3/principals/:principal/balances/nft', () => {
    const nftAddr = 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP';
    const collectionA = 'SP000000000000000000002Q6VF78.collection-a::A';
    const collectionB = 'SP000000000000000000002Q6VF78.collection-b::B';
    const cvHex = (n: number) => '0x' + serializeCV(uintCV(n));
    const vA1 = cvHex(1);
    const vA2 = cvHex(2);
    const vB1 = cvHex(1);

    const getNftBalances = async (principal: string, query: Record<string, string> = {}) => {
      const res = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${principal}/balances/nft`,
        query,
      });
      assert.equal(res.statusCode, 200, res.body);
      return JSON.parse(res.body);
    };

    // Block 3: transfers three NFT instances to `nftAddr` — two of collection A
    // (token ids 1, 2) and one of collection B (token id 1).
    const buildNftBlock = () =>
      new TestBlockBuilder({
        block_height: 3,
        block_hash: hex(3),
        index_block_hash: hex(3),
        parent_index_block_hash: hex(2),
        parent_block_hash: hex(2),
        burn_block_height: 3,
      })
        .addTx({
          tx_id: hex(320),
          block_hash: hex(3),
          index_block_hash: hex(3),
          burn_block_height: 3,
          sender_address: testAddr4,
        })
        .addTxNftEvent({
          recipient: nftAddr,
          sender: testAddr4,
          asset_identifier: collectionA,
          value: vA1,
        })
        .addTxNftEvent({
          recipient: nftAddr,
          sender: testAddr4,
          asset_identifier: collectionA,
          value: vA2,
        })
        .addTxNftEvent({
          recipient: nftAddr,
          sender: testAddr4,
          asset_identifier: collectionB,
          value: vB1,
        })
        .build();

    test('returns an empty page for a principal with no NFTs', async () => {
      const body = await getNftBalances(emptyPrincipal);
      assert.deepEqual(body, {
        total: 0,
        limit: 100,
        cursor: { next: null, previous: null, current: null },
        results: [],
      });
    });

    test('lists owned NFT instances sorted by asset identifier then value', async () => {
      await db.update(buildNftBlock());
      const body = await getNftBalances(nftAddr);
      assert.equal(body.total, 3);
      assert.deepEqual(body.results, [
        { asset_identifier: collectionA, value: { hex: vA1, repr: 'u1' } },
        { asset_identifier: collectionA, value: { hex: vA2, repr: 'u2' } },
        { asset_identifier: collectionB, value: { hex: vB1, repr: 'u1' } },
      ]);
      assert.deepEqual(body.cursor, {
        next: null,
        previous: null,
        current: `${vA1}:${collectionA}`,
      });
    });

    test('paginates with cursors across pages', async () => {
      await db.update(buildNftBlock());

      // Page 1.
      const page1 = await getNftBalances(nftAddr, { limit: '1' });
      assert.equal(page1.total, 3);
      assert.deepEqual(page1.results, [
        { asset_identifier: collectionA, value: { hex: vA1, repr: 'u1' } },
      ]);
      assert.deepEqual(page1.cursor, {
        next: `${vA2}:${collectionA}`,
        previous: null,
        current: `${vA1}:${collectionA}`,
      });

      // Page 2.
      const page2 = await getNftBalances(nftAddr, { limit: '1', cursor: page1.cursor.next });
      assert.deepEqual(page2.results, [
        { asset_identifier: collectionA, value: { hex: vA2, repr: 'u2' } },
      ]);
      assert.deepEqual(page2.cursor, {
        next: `${vB1}:${collectionB}`,
        previous: `${vA1}:${collectionA}`,
        current: `${vA2}:${collectionA}`,
      });

      // Page 3 (last).
      const page3 = await getNftBalances(nftAddr, { limit: '1', cursor: page2.cursor.next });
      assert.deepEqual(page3.results, [
        { asset_identifier: collectionB, value: { hex: vB1, repr: 'u1' } },
      ]);
      assert.deepEqual(page3.cursor, {
        next: null,
        previous: `${vA2}:${collectionA}`,
        current: `${vB1}:${collectionB}`,
      });
    });
  });

  describe('/v3/principals/:principal/nonces', () => {
    const nonceAddr = 'ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5';

    const getNonces = async (principal: string) => {
      const res = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${principal}/nonces`,
      });
      assert.equal(res.statusCode, 200, res.body);
      return JSON.parse(res.body);
    };

    // Confirms `nonceAddr` transactions at nonces 0, 1, 2 in block 3.
    const buildConfirmedNonces = () => {
      const block = new TestBlockBuilder({
        block_height: 3,
        block_hash: hex(3),
        index_block_hash: hex(3),
        parent_index_block_hash: hex(2),
        parent_block_hash: hex(2),
        burn_block_height: 3,
      });
      for (let nonce = 0; nonce <= 2; nonce++) {
        block.addTx({
          tx_id: hex(310 + nonce),
          block_hash: hex(3),
          index_block_hash: hex(3),
          burn_block_height: 3,
          tx_index: nonce,
          sender_address: nonceAddr,
          nonce,
        });
      }
      return block.build();
    };

    test('returns a zeroed result for a principal with no activity', async () => {
      const body = await getNonces(emptyPrincipal);
      assert.deepEqual(body, {
        next_nonce: 0,
        last_confirmed_nonce: null,
        mempool: { last_nonce: null, pending_nonces: [], missing_nonces: [] },
      });
    });

    test('rejects a contract principal with 400 (contracts have no nonces)', async () => {
      const res = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/SP000000000000000000002Q6VF78.pox-3/nonces`,
      });
      assert.equal(res.statusCode, 400, res.body);
    });

    test('reports the last confirmed nonce and next nonce with no mempool gap', async () => {
      await db.update(buildConfirmedNonces());
      // A single pending mempool tx at the next sequential nonce (3) — no gap.
      await db.updateMempoolTxs({
        mempoolTxs: [testMempoolTx({ tx_id: hex(401), sender_address: nonceAddr, nonce: 3 })],
      });
      const body = await getNonces(nonceAddr);
      assert.deepEqual(body, {
        next_nonce: 4,
        last_confirmed_nonce: 2,
        mempool: { last_nonce: 3, pending_nonces: [], missing_nonces: [] },
      });
    });

    test('detects missing and pending mempool nonces across a gap', async () => {
      await db.update(buildConfirmedNonces());
      // Mempool has nonces 3 and 5 (4 is missing), leaving a gap above confirmed nonce 2.
      await db.updateMempoolTxs({
        mempoolTxs: [
          testMempoolTx({ tx_id: hex(402), sender_address: nonceAddr, nonce: 3 }),
          testMempoolTx({ tx_id: hex(403), sender_address: nonceAddr, nonce: 5 }),
        ],
      });
      const body = await getNonces(nonceAddr);
      assert.equal(body.next_nonce, 6);
      assert.equal(body.last_confirmed_nonce, 2);
      assert.equal(body.mempool.last_nonce, 5);
      assert.deepEqual(body.mempool.pending_nonces, [3]);
      assert.deepEqual(body.mempool.missing_nonces, [4]);
    });
  });

  describe('/v3/principals/:principal/mempool/transactions', () => {
    // Addresses not touched by the shared block setup, so the seeded mempool txs
    // are not pruned by confirmed txs from the same sender.
    const memAddr = 'ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5';
    const otherAddr = 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6';
    const poxContract = 'SP000000000000000000002Q6VF78.pox-4';
    const deployContract = 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6.cool-contract';

    const getMempoolTxs = async (principal: string, query: Record<string, string> = {}) => {
      const res = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${principal}/mempool/transactions`,
        query,
      });
      assert.equal(res.statusCode, 200, res.body);
      return JSON.parse(res.body);
    };

    // Seeds 5 pending txs: memAddr as sender (1000), memAddr as token-transfer
    // recipient (2000), a contract-call to poxContract by otherAddr (3000), an
    // unrelated transfer between other parties (4000), and a smart-contract deploy
    // of deployContract by otherAddr (5000).
    const seedMempool = () =>
      db.updateMempoolTxs({
        mempoolTxs: [
          testMempoolTx({
            tx_id: hex(0x51),
            receipt_time: 1000,
            sender_address: memAddr,
            nonce: 0,
          }),
          testMempoolTx({
            tx_id: hex(0x52),
            receipt_time: 2000,
            sender_address: otherAddr,
            token_transfer_recipient_address: memAddr,
            nonce: 1,
          }),
          testMempoolTx({
            tx_id: hex(0x53),
            receipt_time: 3000,
            type_id: DbTxTypeId.ContractCall,
            sender_address: otherAddr,
            contract_call_contract_id: poxContract,
            contract_call_function_name: 'stack-stx',
            nonce: 2,
          }),
          testMempoolTx({
            tx_id: hex(0x54),
            receipt_time: 4000,
            sender_address: otherAddr,
            token_transfer_recipient_address: 'ST2CY5V39NHDPWSXMW9QDT3HC3GD6Q6XX4CFRK9AG',
            nonce: 3,
          }),
          testMempoolTx({
            tx_id: hex(0x55),
            receipt_time: 5000,
            type_id: DbTxTypeId.SmartContract,
            sender_address: otherAddr,
            smart_contract_contract_id: deployContract,
            nonce: 4,
          }),
        ],
      });

    test('returns an empty page for a principal with no mempool activity', async () => {
      const body = await getMempoolTxs(emptyPrincipal);
      assert.equal(body.total, 0);
      assert.deepEqual(body.results, []);
      assert.deepEqual(body.cursor, { next: null, previous: null, current: null });
    });

    test('returns pending txs where the principal is the sender or a recipient', async () => {
      await seedMempool();
      const body = await getMempoolTxs(memAddr);
      assert.equal(body.total, 2);
      // Ordered by receipt_time desc: recipient tx (2000) before sender tx (1000).
      assert.deepEqual(
        body.results.map((r: { tx_id: string }) => r.tx_id),
        [hex(0x52), hex(0x51)]
      );
      // The unrelated tx is excluded.
      assert.ok(!body.results.some((r: { tx_id: string }) => r.tx_id === hex(0x54)));
    });

    test('returns pending txs where a contract principal is the called contract', async () => {
      await seedMempool();
      const body = await getMempoolTxs(poxContract);
      assert.equal(body.total, 1);
      assert.deepEqual(
        body.results.map((r: { tx_id: string }) => r.tx_id),
        [hex(0x53)]
      );
    });

    test('returns pending txs where a contract principal is being deployed', async () => {
      await seedMempool();
      const body = await getMempoolTxs(deployContract);
      assert.equal(body.total, 1);
      assert.deepEqual(
        body.results.map((r: { tx_id: string }) => r.tx_id),
        [hex(0x55)]
      );
    });

    test('paginates with cursors', async () => {
      await seedMempool();
      const page1 = await getMempoolTxs(memAddr, { limit: '1' });
      assert.equal(page1.total, 2);
      assert.deepEqual(
        page1.results.map((r: { tx_id: string }) => r.tx_id),
        [hex(0x52)]
      );
      const page2 = await getMempoolTxs(memAddr, { limit: '1', cursor: page1.cursor.next });
      assert.deepEqual(
        page2.results.map((r: { tx_id: string }) => r.tx_id),
        [hex(0x51)]
      );
      assert.equal(page2.cursor.next, null);
    });
  });
});
