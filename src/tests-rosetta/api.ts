import { PgDataStore, cycleMigrations, runMigrations } from '../datastore/postgres-store';
import { PoolClient } from 'pg';
import { ApiServer, startApiServer } from '../api/init';
import * as supertest from 'supertest';
import { startEventServer } from '../event-stream/event-server';
import { Server } from 'net';
import { DbBlock, DbTx, DbMempoolTx, DbTxStatus } from '../datastore/common';
import * as assert from 'assert';
import { makeSTXTokenTransfer, StacksTestnet } from '@blockstack/stacks-transactions';
import * as BN from 'bn.js';
import { getCoreNodeEndpoint, StacksCoreRpcClient } from '../core-rpc/client';
import { timeout } from '../helpers';

describe('Rosetta API', () => {
  let db: PgDataStore;
  let client: PoolClient;
  let eventServer: Server;
  let api: ApiServer;

  function getStacksTestnetNetwork() {
    const stacksNetwork = new StacksTestnet();
    stacksNetwork.coreApiUrl = `http://${getCoreNodeEndpoint()}`;
    return stacksNetwork;
  }

  beforeAll(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgDataStore.connect();
    client = await db.pool.connect();
    eventServer = await startEventServer({ db });
    api = await startApiServer(db);
  });

  test('network/list', async () => {
    const query1 = await supertest(api.server).post(`/rosetta/v1/network/list`);
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');
    expect(JSON.parse(query1.text)).toEqual({
      network_identifiers: [{ blockchain: 'stacks', network: 'testnet' }],
    });
  });

  test('network/options', async () => {
    const nodeVersion = process.version;
    const middlewareVersion = require('../../package.json').version;
    const query1 = await supertest(api.server)
      .post(`/rosetta/v1/network/options`)
      .send({ network_identifier: { blockchain: 'stacks', network: 'testnet' } });
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');
    expect(JSON.parse(query1.text)).toEqual({
      version: {
        rosetta_version: '1.4.2',
        node_version: nodeVersion,
        middleware_version: middlewareVersion,
      },
      allow: {
        operation_statuses: [
          { status: 'success', successful: true },
          { status: 'pending', successful: true },
          { status: 'abort_by_response', successful: false },
          { status: 'abort_by_post_condition', successful: false },
        ],
        operation_types: [
          'token_transfer',
          'contract_call',
          'smart_contract',
          'coinbase',
          'poison_microblock',
          'fee',
        ],
        errors: [
          { code: 601, message: 'Invalid Account.', retriable: true },
          { code: 602, message: 'Insufficient Funds.', retriable: true },
          { code: 603, message: 'Account is empty.', retriable: true },
          { code: 604, message: 'Invalid block index.', retriable: true },
          { code: 605, message: 'Block not found.', retriable: true },
          { code: 606, message: 'Invalid block hash.', retriable: true },
          { code: 607, message: 'Transaction not found.', retriable: true },
          { code: 608, message: 'Invalid transaction hash.', retriable: true },
          { code: 609, message: 'Invalid params.', retriable: true },
          { code: 610, message: 'Invalid network.', retriable: true },
          { code: 611, message: 'Invalid blockchain.', retriable: true },
          { code: 612, message: 'Unknown error.', retriable: false },
          { code: 613, message: 'Network identifier object is null.', retriable: true },
          { code: 614, message: 'Account identifier object is null.', retriable: true },
          { code: 615, message: 'Block identifier is null.', retriable: true },
          { code: 616, message: 'Transaction identifier is null.', retriable: true },
          { code: 617, message: 'Blockchain name is null.', retriable: true },
          { code: 618, message: 'Network name is null.', retriable: true },
          { code: 619, message: 'Invalid curve type.', retriable: false },
          { code: 620, message: 'invalid public key.', retriable: false },
          { code: 621, message: 'Invalid operation', retriable: false },
          { code: 622, message: 'Invalid fee', retriable: false },
          { code: 623, message: 'Invalid symbol', retriable: false },
          { code: 624, message: 'Invalid currency decimals', retriable: false },
          { code: 625, message: 'Invalid transaction type', retriable: false },
          { code: 626, message: 'Invalid sender address', retriable: false },
          { code: 627, message: 'Invalid recipient address', retriable: false },
        ],
        historical_balance_lookup: true,
      },
    });
  });

  test('network/options - bad request', async () => {
    const query1 = await supertest(api.server).post(`/rosetta/v1/network/options`).send({});
    expect(query1.status).toBe(400);
    expect(query1.type).toBe('application/json');
    expect(JSON.parse(query1.text)).toEqual({
      code: 613,
      message: 'Network identifier object is null.',
      retriable: true,
      details: { message: "should have required property 'network_identifier'" },
    });
  });

  test('network/status - invalid blockchain', async () => {
    const query1 = await supertest(api.server)
      .post(`/rosetta/v1/network/status`)
      .send({ network_identifier: { blockchain: 'bitcoin', network: 'testnet' } });
    expect(query1.status).toBe(400);
    expect(query1.type).toBe('application/json');
    expect(JSON.parse(query1.text)).toEqual({
      code: 611,
      message: 'Invalid blockchain.',
      retriable: true,
    });
  });

  test('network/status - invalid network', async () => {
    const query1 = await supertest(api.server)
      .post(`/rosetta/v1/network/status`)
      .send({ network_identifier: { blockchain: 'stacks', network: 'mainnet' } });
    expect(query1.status).toBe(400);
    expect(query1.type).toBe('application/json');
    expect(JSON.parse(query1.text)).toEqual({
      code: 610,
      message: 'Invalid network.',
      retriable: true,
    });
  });

  test('network/status', async () => {
    // skip first a block (so we are at least N+1 blocks)
    await new Promise<DbBlock>(resolve =>
      api.datastore.once('blockUpdate', block => resolve(block))
    );
    const block = await new Promise<DbBlock>(resolve =>
      api.datastore.once('blockUpdate', block => resolve(block))
    );
    const genesisBlock = await api.datastore.getBlockByHeight(1);
    assert(genesisBlock.found);
    const query1 = await supertest(api.address)
      .post(`/rosetta/v1/network/status`)
      .send({ network_identifier: { blockchain: 'stacks', network: 'testnet' } });
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');
    expect(JSON.parse(query1.text)).toEqual({
      current_block_identifier: {
        index: block.block_height,
        hash: block.block_hash,
      },
      current_block_timestamp: block.burn_block_time * 1000,
      genesis_block_identifier: {
        index: genesisBlock.result.block_height,
        hash: genesisBlock.result.block_hash,
      },
      peers: [],
    });
  });

  test('block - by index', async () => {
    const blockHeight = 2;
    const block = await api.datastore.getBlockByHeight(blockHeight);
    assert(block.found);
    const txs = await api.datastore.getBlockTxsRows(block.result.block_hash);
    assert(txs.found);
    const query1 = await supertest(api.address)
      .post(`/rosetta/v1/block`)
      .send({
        network_identifier: { blockchain: 'stacks', network: 'testnet' },
        block_identifier: { index: blockHeight },
      });
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');
    expect(JSON.parse(query1.text)).toEqual({
      block: {
        block_identifier: {
          index: blockHeight,
          hash: block.result.block_hash,
        },
        parent_block_identifier: {
          index: blockHeight - 1,
          hash: block.result.parent_block_hash,
        },
        timestamp: block.result.burn_block_time * 1000,
        transactions: [
          {
            transaction_identifier: {
              hash: txs.result[0].tx_id,
            },
            operations: [
              {
                operation_identifier: { index: 0 },
                type: 'coinbase',
                status: 'success',
                account: { address: txs.result[0].sender_address },
              },
            ],
          },
        ],
      },
    });
  });

  test('block - by hash', async () => {
    const blockHeight = 2;
    const block = await api.datastore.getBlockByHeight(blockHeight);
    assert(block.found);
    const txs = await api.datastore.getBlockTxsRows(block.result.block_hash);
    assert(txs.found);
    const query1 = await supertest(api.address)
      .post(`/rosetta/v1/block`)
      .send({
        network_identifier: { blockchain: 'stacks', network: 'testnet' },
        block_identifier: { hash: block.result.block_hash },
      });
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');
    expect(JSON.parse(query1.text)).toEqual({
      block: {
        block_identifier: {
          index: blockHeight,
          hash: block.result.block_hash,
        },
        parent_block_identifier: {
          index: blockHeight - 1,
          hash: block.result.parent_block_hash,
        },
        timestamp: block.result.burn_block_time * 1000,
        transactions: [
          {
            transaction_identifier: {
              hash: txs.result[0].tx_id,
            },
            operations: [
              {
                operation_identifier: { index: 0 },
                type: 'coinbase',
                status: 'success',
                account: { address: txs.result[0].sender_address },
              },
            ],
          },
        ],
      },
    });
  });

  test('block - get latest', async () => {
    const block = await api.datastore.getCurrentBlock();
    assert(block.found);
    const txs = await api.datastore.getBlockTxsRows(block.result.block_hash);
    assert(txs.found);
    const query1 = await supertest(api.address)
      .post(`/rosetta/v1/block`)
      .send({
        network_identifier: { blockchain: 'stacks', network: 'testnet' },
      });
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');
    expect(JSON.parse(query1.text)).toEqual({
      block: {
        block_identifier: {
          index: block.result.block_height,
          hash: block.result.block_hash,
        },
        parent_block_identifier: {
          index: block.result.block_height - 1,
          hash: block.result.parent_block_hash,
        },
        timestamp: block.result.burn_block_time * 1000,
        transactions: [
          {
            transaction_identifier: {
              hash: txs.result[0].tx_id,
            },
            operations: [
              {
                operation_identifier: { index: 0 },
                type: 'coinbase',
                status: 'success',
                account: { address: txs.result[0].sender_address },
              },
            ],
          },
        ],
      },
    });
  });

  test('block/transaction', async () => {
    let expectedTxId: string = '';
    const broadcastTx = new Promise<DbTx>(resolve => {
      const listener: (info: DbTx | DbMempoolTx) => void = info => {
        if (info.tx_id === expectedTxId && info.status === DbTxStatus.Success) {
          api.datastore.removeListener('txUpdate', listener);
          resolve(info as DbTx);
        }
      };
      api.datastore.addListener('txUpdate', listener);
    });
    const transferTx = await makeSTXTokenTransfer({
      recipient: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP',
      amount: new BN(3852),
      senderKey: 'c71700b07d520a8c9731e4d0f095aa6efb91e16e25fb27ce2b72e7b698f8127a01',
      network: getStacksTestnetNetwork(),
      memo: 'test1234',
    });
    expectedTxId = '0x' + transferTx.txid();
    const submitResult = await new StacksCoreRpcClient().sendTransaction(transferTx.serialize());
    expect(submitResult.txId).toBe(expectedTxId);
    await broadcastTx;
    const txDb = await api.datastore.getTx(expectedTxId);
    assert(txDb.found);
    const query1 = await supertest(api.server)
      .post(`/rosetta/v1/block/transaction`)
      .send({
        network_identifier: { blockchain: 'stacks', network: 'testnet' },
        block_identifier: { index: txDb.result.block_height, hash: txDb.result.block_hash },
        transaction_identifier: { hash: txDb.result.tx_id },
      });
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');
    expect(JSON.parse(query1.text)).toEqual({
      transaction_identifier: {
        hash: txDb.result.tx_id,
      },
      operations: [
        {
          operation_identifier: { index: 0 },
          type: 'fee',
          status: 'success',
          account: { address: 'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR' },
          amount: { value: '-180', currency: { symbol: 'STX', decimals: 6 } },
        },
        {
          operation_identifier: { index: 1 },
          type: 'token_transfer',
          status: 'success',
          account: { address: 'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR' },
          amount: { value: '-3852', currency: { symbol: 'STX', decimals: 6 } },
          coin_change: {
            coin_action: 'coin_spent',
            coin_identifier: {
              identifier: `${txDb.result.tx_id}:1`,
            },
          },
        },
        {
          operation_identifier: { index: 2 },
          related_operations: [{ index: 0, operation_identifier: { index: 1 } }],
          type: 'token_transfer',
          status: 'success',
          account: { address: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP' },
          amount: { value: '3852', currency: { symbol: 'STX', decimals: 6 } },
          coin_change: {
            coin_action: 'coin_created',
            coin_identifier: {
              identifier: `${txDb.result.tx_id}:2`,
            },
          },
        },
      ],
    });
  });

  test('block/transaction - invalid transaction hash', async () => {
    const query1 = await supertest(api.server)
      .post(`/rosetta/v1/block/transaction`)
      .send({
        network_identifier: { blockchain: 'stacks', network: 'testnet' },
        block_identifier: { index: 3, hash: '0x3a' },
        transaction_identifier: { hash: '3' },
      });
    expect(query1.status).toBe(400);
    expect(query1.type).toBe('application/json');
    expect(JSON.parse(query1.text)).toEqual({
      code: 608,
      message: 'Invalid transaction hash.',
      retriable: true,
    });
  });

  afterAll(async () => {
    await new Promise(resolve => eventServer.close(() => resolve()));
    await api.terminate();
    client.release();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
