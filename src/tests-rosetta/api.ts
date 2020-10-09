import { PgDataStore, cycleMigrations, runMigrations } from '../datastore/postgres-store';
import { PoolClient } from 'pg';
import * as BigNum from 'bn.js';
import { ApiServer, startApiServer } from '../api/init';
import * as supertest from 'supertest';
import { startEventServer } from '../event-stream/event-server';
import { Server } from 'net';
import { DbBlock, DbTx, DbMempoolTx, DbTxStatus } from '../datastore/common';
import * as assert from 'assert';
import {
  createStacksPrivateKey,
  getPublicKey,
  makeSTXTokenTransfer,
  makeUnsignedSTXTokenTransfer,
  pubKeyfromPrivKey,
  publicKeyToString,
  SignedTokenTransferOptions,
  StacksTestnet,
  standardPrincipalCV,
  UnsignedTokenTransferOptions,
} from '@blockstack/stacks-transactions';
import * as BN from 'bn.js';
import { getCoreNodeEndpoint, StacksCoreRpcClient } from '../core-rpc/client';
import { bufferToHexPrefixString } from '../helpers';
import {
  RosettaConstructionDeriveRequest,
  RosettaConstructionDeriveResponse,
  RosettaConstructionHashRequest,
  RosettaConstructionHashResponse,
  RosettaConstructionMetadataRequest,
  RosettaConstructionParseRequest,
  RosettaConstructionParseResponse,
  RosettaConstructionPreprocessRequest,
  RosettaConstructionPreprocessResponse,
} from '@blockstack/stacks-blockchain-api-types';
import { RosettaConstants, RosettaErrors } from '../api/rosetta-constants';
import { GetStacksTestnetNetwork, testnetKeys } from '../api/routes/debug';

describe('Rosetta API', () => {
  let db: PgDataStore;
  let client: PoolClient;
  let eventServer: Server;
  let api: ApiServer;

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
          { code: 628, message: 'Invalid transaction string', retriable: false },
          { code: 629, message: 'Transaction not signed', retriable: false },
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
      network: GetStacksTestnetNetwork(),
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

  /* rosetta construction api tests below */

  test('construction/derive', async () => {
    const request: RosettaConstructionDeriveRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: RosettaConstants.network,
      },
      public_key: {
        curve_type: 'secp256k1',
        hex_bytes: '025c13b2fc2261956d8a4ad07d481b1a3b2cbf93a24f992249a61c3a1c4de79c51',
      },
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/derive`)
      .send(request);

    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');

    const expectResponse: RosettaConstructionDeriveResponse = {
      address: 'ST19SH1QSCR8VMEX6SVWP33WCF08RPDY5QVHX94BM',
    };

    expect(JSON.parse(result.text)).toEqual(expectResponse);

    const request2 = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: RosettaConstants.network,
      },
      public_key: {
        curve_type: 'this is an invalid curve type',
        hex_bytes: '025c13b2fc2261956d8a4ad07d481b1a3b2cbf93a24f992249a61c3a1c4de79c51',
      },
    };

    const result2 = await supertest(api.server)
      .post(`/rosetta/v1/construction/derive`)
      .send(request2);
    expect(result2.status).toBe(400);

    const expectedResponse2 = RosettaErrors.invalidCurveType;

    expect(JSON.parse(result2.text)).toEqual(expectedResponse2);

    const request3 = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: RosettaConstants.network,
      },
      public_key: {
        curve_type: 'secp256k1',
        hex_bytes: 'this is an invalid public key',
      },
    };

    const result3 = await supertest(api.server)
      .post(`/rosetta/v1/construction/derive`)
      .send(request3);
    expect(result3.status).toBe(400);

    const expectedResponse3 = RosettaErrors.invalidPublicKey;

    expect(JSON.parse(result3.text)).toEqual(expectedResponse3);
  });

  test('construction/preprocess', async () => {
    const request: RosettaConstructionPreprocessRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: RosettaConstants.network,
      },
      operations: [
        {
          operation_identifier: {
            index: 0,
            network_index: 0,
          },
          related_operations: [],
          type: 'fee',
          status: 'success',
          account: {
            address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
            metadata: {},
          },
          amount: {
            value: '-180',
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
            metadata: {},
          },
        },
        {
          operation_identifier: {
            index: 1,
            network_index: 0,
          },
          related_operations: [],
          type: 'token_transfer',
          status: 'success',
          account: {
            address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
            metadata: {},
          },
          amount: {
            value: '-500000',
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
            metadata: {},
          },
        },
        {
          operation_identifier: {
            index: 2,
            network_index: 0,
          },
          related_operations: [],
          type: 'token_transfer',
          status: 'success',
          account: {
            address: 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0',
            metadata: {},
          },
          amount: {
            value: '500000',
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
            metadata: {},
          },
        },
      ],
      metadata: {},
      max_fee: [
        {
          value: '12380898',
          currency: {
            symbol: 'STX',
            decimals: 6,
          },
          metadata: {},
        },
      ],
      suggested_fee_multiplier: 0,
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/preprocess`)
      .send(request);

    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');

    const expectResponse: RosettaConstructionPreprocessResponse = {
      options: {
        sender_address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        type: 'token_transfer',
        status: 'success',
        token_transfer_recipient_address: 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0',
        amount: '500000',
        symbol: 'STX',
        decimals: 6,
        fee: '-180',
        max_fee: '12380898',
      },
      required_public_keys: {
        address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
      },
    };

    expect(JSON.parse(result.text)).toEqual(expectResponse);
  });

  test('construction/preprocess - failure', async () => {
    const request2 = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: RosettaConstants.network,
      },
      operations: [
        {
          operation_identifier: {
            index: 0,
            network_index: 0,
          },
          related_operations: [],
          type: 'fee',
          status: 'success',
          account: {
            address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
            metadata: {},
          },
          amount: {
            value: '-180',
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
            metadata: {},
          },
        },
        {
          operation_identifier: {
            index: 1,
            network_index: 0,
          },
          related_operations: [],
          type: 'invalid operation type',
          status: 'success',
          account: {
            address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
            metadata: {},
          },
          amount: {
            value: '-500000',
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
            metadata: {},
          },
        },
        {
          operation_identifier: {
            index: 2,
            network_index: 0,
          },
          related_operations: [],
          type: 'token_transfer',
          status: 'success',
          account: {
            address: 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0',
            metadata: {},
          },
          amount: {
            value: '500000',
            currency: {
              symbol: 'STX',
              decimals: 6,
            },
            metadata: {},
          },
        },
      ],
      metadata: {},
      max_fee: [
        {
          value: '12380898',
          currency: {
            symbol: 'STX',
            decimals: 6,
          },
          metadata: {},
        },
      ],
      suggested_fee_multiplier: 0,
    };

    const result2 = await supertest(api.server)
      .post(`/rosetta/v1/construction/preprocess`)
      .send(request2);
    expect(result2.status).toBe(400);

    const expectedResponse2 = RosettaErrors.invalidOperation;

    expect(JSON.parse(result2.text)).toEqual(expectedResponse2);
  });

  test('construction/metadata - success', async () => {
    const publicKey = publicKeyToString(
      getPublicKey(createStacksPrivateKey(testnetKeys[0].secretKey))
    );
    const request: RosettaConstructionMetadataRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      options: {
        sender_address: testnetKeys[0].stacksAddress,
        type: 'token_transfer',
        status: 'success',
        token_transfer_recipient_address: testnetKeys[1].stacksAddress,
        amount: '500000',
        symbol: 'STX',
        decimals: 6,
        fee: '-180',
        max_fee: '12380898',
      },
      public_keys: [{ hex_bytes: publicKey, curve_type: 'secp256k1' }],
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/metadata`)
      .send(request);

    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
    expect(JSON.parse(result.text)).toHaveProperty('metadata');
  });

  test('construction/metadata - failure invalid public key', async () => {
    const publicKey = publicKeyToString(
      getPublicKey(createStacksPrivateKey(testnetKeys[2].secretKey))
    );
    const request: RosettaConstructionMetadataRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      options: {
        sender_address: testnetKeys[0].stacksAddress,
        type: 'token_transfer',
        status: 'success',
        token_transfer_recipient_address: testnetKeys[1].stacksAddress,
        amount: '500000',
        symbol: 'STX',
        decimals: 6,
        fee: '-180',
        max_fee: '12380898',
      },
      public_keys: [
        {
          hex_bytes: publicKey,
          curve_type: 'secp256k1',
        },
      ],
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/metadata`)
      .send(request);

    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    expect(JSON.parse(result.text)).toEqual(RosettaErrors.invalidPublicKey);
  });

  test('construction/metadata - empty network identifier', async () => {
    const request = {
      options: {
        sender_address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        type: 'token_transfer',
        status: 'success',
        token_transfer_recipient_address: 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0',
        amount: '500000',
        symbol: 'STX',
        decimals: 6,
        fee: '-180',
        max_fee: '12380898',
      },
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/metadata`)
      .send(request);

    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    const expectResponse = {
      code: 613,
      message: 'Network identifier object is null.',
      retriable: true,
      details: {
        message: "should have required property 'network_identifier'",
      },
    };

    expect(JSON.parse(result.text)).toEqual(expectResponse);
  });

  test('construction/metadata - invalid transfer type', async () => {
    const request: RosettaConstructionMetadataRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      options: {
        sender_address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        type: 'token',
        status: 'success',
        token_transfer_recipient_address: 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0',
        amount: '500000',
        symbol: 'STX',
        decimals: 6,
        fee: '-180',
        max_fee: '12380898',
      },
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/metadata`)
      .send(request);

    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    const expectResponse = {
      code: 625,
      message: 'Invalid transaction type',
      retriable: false,
    };

    expect(JSON.parse(result.text)).toEqual(expectResponse);
  });

  test('construction/metadata - invalid sender address', async () => {
    const request: RosettaConstructionMetadataRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      options: {
        sender_address: 'abc',
        type: 'token_transfer',
        status: 'success',
        token_transfer_recipient_address: 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0',
        amount: '500000',
        symbol: 'STX',
        decimals: 6,
        fee: '-180',
        max_fee: '12380898',
      },
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/metadata`)
      .send(request);

    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    const expectResponse = {
      code: 626,
      message: 'Invalid sender address',
      retriable: false,
    };

    expect(JSON.parse(result.text)).toEqual(expectResponse);
  });

  test('construction/metadata - invalid recipient address', async () => {
    const request: RosettaConstructionMetadataRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      options: {
        sender_address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
        type: 'token_transfer',
        status: 'success',
        token_transfer_recipient_address: 'xyz',
        amount: '500000',
        symbol: 'STX',
        decimals: 6,
        fee: '-180',
        max_fee: '12380898',
      },
    };

    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/metadata`)
      .send(request);

    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    const expectResponse = {
      code: 627,
      message: 'Invalid recipient address',
      retriable: false,
    };

    expect(JSON.parse(result.text)).toEqual(expectResponse);
  });

  test('construction/hash', async () => {
    const request: RosettaConstructionHashRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: RosettaConstants.network,
      },
      signed_transaction:
        '0x80800000000400539886f96611ba3ba6cef9618f8c78118b37c5be000000000000000000000000000000b400017a33a91515ef48608a99c6adecd2eb258e11534a1acf66348f5678c8e2c8f83d243555ed67a0019d3500df98563ca31321c1a675b43ef79f146e322fe08df75103020000000000051a1ae3f911d8f1d46d7416bfbe4b593fd41eac19cb000000000007a12000000000000000000000000000000000000000000000000000000000000000000000',
    };

    const result = await supertest(api.server).post(`/rosetta/v1/construction/hash`).send(request);
    expect(result.status).toBe(200);

    const expectedResponse: RosettaConstructionHashResponse = {
      transaction_identifier: {
        hash: '0xf3b054a5fbae98f7f35e5e917b65759fc365a3e073f8af1c3b8d211b286fa74a',
      },
    };

    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  test('construction/hash - no `0x` prefix', async () => {
    const request: RosettaConstructionHashRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: RosettaConstants.network,
      },
      signed_transaction:
        '80800000000400d429e0b599f9cba40ecc9f219df60f9d0a02212d000000000000000100000000000000000101cc0235071690bc762d0013f6d3e4be32aa8f8d01d0db9d845595589edba47e7425bd655f20398e3d931cbe60eea59bb66f44d3f28443078fe9d10082dccef80c010200000000040000000000000000000000000000000000000000000000000000000000000000',
    };

    const result = await supertest(api.server).post(`/rosetta/v1/construction/hash`).send(request);
    expect(result.status).toBe(400);

    const expectedResponse = RosettaErrors.invalidTransactionString;

    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  test('construction/hash - odd number of hex digits', async () => {
    const request: RosettaConstructionHashRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: RosettaConstants.network,
      },
      signed_transaction:
        '80800000000400d429e0b599f9cba40ecc9f219df60f9d0a02212d000000000000000100000000000000000101cc0235071690bc762d0013f6d3e4be32aa8f8d01d0db9d845595589edba47e7425bd655f20398e3d931cbe60eea59bb66f44d3f28443078fe9d10082dccef80c01020000000004000000000000000000000000000000000000000000000000000000000000000',
    };

    const result = await supertest(api.server).post(`/rosetta/v1/construction/hash`).send(request);
    expect(result.status).toBe(400);

    const expectedResponse = RosettaErrors.invalidTransactionString;

    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  test('construction/hash - unsigned transaction', async () => {
    const request: RosettaConstructionHashRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: RosettaConstants.network,
      },
      //unsigned transaction bytes
      signed_transaction:
        '0x80800000000400539886f96611ba3ba6cef9618f8c78118b37c5be000000000000000000000000000000b400000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003020000000000051a1ae3f911d8f1d46d7416bfbe4b593fd41eac19cb000000000007a12000000000000000000000000000000000000000000000000000000000000000000000',
    };

    const result = await supertest(api.server).post(`/rosetta/v1/construction/hash`).send(request);
    expect(result.status).toBe(400);

    const expectedResponse = RosettaErrors.transactionNotSigned;

    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  test('construction/parse - signed', async () => {
    const publicKey = publicKeyToString(
      getPublicKey(createStacksPrivateKey(testnetKeys[0].secretKey))
    );
    const senderAddr = testnetKeys[0].stacksAddress;
    const recipientAddr = 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0';
    const amount = new BN(1000);
    const fee = new BN(180);
    const options: SignedTokenTransferOptions = {
      recipient: recipientAddr,
      amount: amount,
      fee: fee,
      senderKey: testnetKeys[0].secretKey,
      network: GetStacksTestnetNetwork(),
    };
    const testTransaction = await makeSTXTokenTransfer(options);
    const request: RosettaConstructionParseRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      signed: true,
      transaction: bufferToHexPrefixString(testTransaction.serialize()),
    };

    const result = await supertest(api.server).post(`/rosetta/v1/construction/parse`).send(request);
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');

    const actual: RosettaConstructionParseResponse = JSON.parse(result.text);
    // test fee operation
    expect(actual.operations[0].account?.address).toEqual(senderAddr);
    expect(actual.operations[0].amount?.value).toEqual('-' + fee.toString());
    // test sender
    expect(actual.operations[1].account?.address).toEqual(senderAddr);
    expect(actual.operations[1].amount?.value).toEqual('-' + amount.toString());
    // test recipient
    expect(actual.operations[2].account?.address).toEqual(recipientAddr);
    expect(actual.operations[2].amount?.value).toEqual(amount.toString());
    // test signer
    expect(actual.account_identifier_signers?.[0].address).toEqual(senderAddr);
  });

  test('construction/parse - unsigned', async () => {
    const publicKey = publicKeyToString(
      getPublicKey(createStacksPrivateKey(testnetKeys[0].secretKey))
    );
    const senderAddr = testnetKeys[0].stacksAddress;
    const recipientAddr = 'STDE7Y8HV3RX8VBM2TZVWJTS7ZA1XB0SSC3NEVH0';
    const amount = new BN(1000);
    const fee = new BN(180);
    const tokenTransferOptions: UnsignedTokenTransferOptions = {
      recipient: recipientAddr,
      amount: amount,
      fee: fee,
      publicKey: publicKey,
      network: GetStacksTestnetNetwork(),
    };
    const testTransaction = await makeUnsignedSTXTokenTransfer(tokenTransferOptions);

    const request: RosettaConstructionParseRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      signed: false,
      transaction: bufferToHexPrefixString(testTransaction.serialize()),
    };

    const result = await supertest(api.server).post(`/rosetta/v1/construction/parse`).send(request);
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
    const actual: RosettaConstructionParseResponse = JSON.parse(result.text);
    // test fee operation
    expect(actual.operations[0].account?.address).toEqual(senderAddr);
    expect(actual.operations[0].amount?.value).toEqual('-' + fee.toString());
    // test sender
    expect(actual.operations[1].account?.address).toEqual(senderAddr);
    expect(actual.operations[1].amount?.value).toEqual('-' + amount.toString());
    // test recipient
    expect(actual.operations[2].account?.address).toEqual(recipientAddr);
    expect(actual.operations[2].amount?.value).toEqual(amount.toString());
  });

  test('construction/submit', async () => {
    const txOptions = {
      senderKey: testnetKeys[0].secretKey,
      recipient: standardPrincipalCV(testnetKeys[1].stacksAddress),
      amount: new BigNum(12345),
      network: GetStacksTestnetNetwork(),
      memo: 'test memo',
      nonce: new BigNum(0),
      fee: new BigNum(200),
    };

    const transaction = await makeSTXTokenTransfer(txOptions);
    const serializedTx = transaction.serialize().toString('hex');

    const request: RosettaConstructionHashRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: RosettaConstants.network,
      },
      // signed transaction bytes
      signed_transaction: '0x' + serializedTx,
    };
    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/submit`)
      .send(request);
    expect(result.status).toBe(200);
  });

  test('construction/submit - unsigned', async () => {
    const txOptions = {
      recipient: standardPrincipalCV(testnetKeys[1].stacksAddress),
      amount: new BigNum(12345),
      publicKey: publicKeyToString(pubKeyfromPrivKey(testnetKeys[0].secretKey)),
      network: GetStacksTestnetNetwork(),
      memo: 'test memo',
      nonce: new BigNum(0),
      fee: new BigNum(200),
    };

    const transaction = await makeUnsignedSTXTokenTransfer(txOptions);
    const serializedTx = transaction.serialize().toString('hex');

    const request: RosettaConstructionHashRequest = {
      network_identifier: {
        blockchain: RosettaConstants.blockchain,
        network: RosettaConstants.network,
      },
      //unsigned transaction bytes
      signed_transaction: '0x' + serializedTx,
    };
    const result = await supertest(api.server)
      .post(`/rosetta/v1/construction/submit`)
      .send(request);
    expect(result.status).toBe(400);
    const expectedResponse = RosettaErrors.invalidTransactionString;

    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  /* rosetta construction end */

  afterAll(async () => {
    await new Promise(resolve => eventServer.close(() => resolve()));
    await api.terminate();
    client.release();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
