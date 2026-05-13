import { describe, test, beforeEach, afterEach } from 'node:test';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { ApiServer, startApiServer } from '../../../src/api/init.ts';
import { migrate } from '../../test-helpers.ts';
import { STACKS_TESTNET } from '@stacks/network';
import * as assert from 'node:assert/strict';
import { TestBlockBuilder } from '../test-builders.ts';
import { DbTxStatus, DbTxTypeId } from 'src/datastore/common.ts';
import { hex } from '../test-helpers.ts';

describe('principals', () => {
  let db: PgWriteStore;
  let api: ApiServer;

  const testAddr1 = 'ST3J8EVYHVKH6XXPD61EE8XEHW4Y2K83861225AB1';
  const testAddr2 = 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4';
  const testContractAddr = 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world';
  const testAddr4 = 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C';
  const emptyPrincipal = 'SP466FNC0P7JWTNM2R9T199QRZN1MYEDTAR0KP2X';
  const emptyTxId = '0x0000000000000000000000000000000000000000000000000000000000000000';

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
            memo: '0x',
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
        affected_asset_types: {
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
        affected_asset_types: {
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
    });
  });

  describe('/v3/principals/:principal/transactions/:tx_id/balance-changes', () => {
    test('should return an empty list', async () => {
      const response = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/principals/${emptyPrincipal}/transactions/${emptyTxId}/balance-changes`,
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
          cursor: '2:SP2H8PY27SEZ03MWRKS5XABZYQN17ETGQS3527SA5.newyorkcitycoin-token::newyorkcitycoin',
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
          current: '2:SP2H8PY27SEZ03MWRKS5XABZYQN17ETGQS3527SA5.newyorkcitycoin-token::newyorkcitycoin',
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
  });
});
