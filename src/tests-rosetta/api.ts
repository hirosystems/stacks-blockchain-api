import { ApiServer, startApiServer } from '../api/init';
import * as supertest from 'supertest';
import { DbMempoolTxRaw, DbTxStatus, DbTxTypeId, DbTxAnchorMode } from '../datastore/common';
import * as assert from 'assert';
import {
  AnchorMode,
  ChainID,
} from '@stacks/transactions';
import {
  RosettaAccount,
  RosettaAccountBalanceRequest,
  RosettaAccountBalanceResponse,
  RosettaAmount,
  RosettaMempoolRequest,
  RosettaMempoolResponse,
  RosettaMempoolTransactionRequest,
  RosettaMempoolTransactionResponse,
  RosettaOperation,
  RosettaTransaction,
} from '@stacks/stacks-blockchain-api-types';
import {
  RosettaErrors,
  RosettaOperationTypes,
  RosettaOperationStatuses,
  RosettaConstants,
} from '../api/rosetta-constants';
import { TestBlockBuilder } from '../test-utils/test-builders';
import { PgWriteStore } from '../datastore/pg-write-store';
import { cycleMigrations, runMigrations } from '../datastore/migrations';
import { PgSqlClient } from '../datastore/connection';
import { bufferToHexPrefixString } from '../helpers';
import * as nock from 'nock';

describe('Rosetta API', () => {
  let db: PgWriteStore;
  let client: PgSqlClient;
  let api: ApiServer;

  beforeEach(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgWriteStore.connect({ usageName: 'tests' });
    client = db.sql;
    api = await startApiServer({ datastore: db, chainId: ChainID.Testnet });
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
        rosetta_version: '1.4.6',
        node_version: nodeVersion,
        middleware_version: middlewareVersion,
      },
      allow: {
        operation_statuses: RosettaOperationStatuses,
        operation_types: RosettaOperationTypes,
        errors: Object.values(RosettaErrors),
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
      retriable: false,
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
      retriable: false,
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
      retriable: false,
    });
  });

  test('network/status', async () => {
    // skip first a block (so we are at least N+1 blocks)
    const genesisData = new TestBlockBuilder().build();
    const blockBuilderData = {
      parent_block_hash: genesisData.block.block_hash,
      parent_index_block_hash: genesisData.block.index_block_hash,
      block_height: 2,
      index_block_hash: '0x12345678'
    } 
    const blockData = new TestBlockBuilder(blockBuilderData).build();

    await db.update(genesisData);
    await db.update(blockData);

    const block = blockData.block, genesisBlock = genesisData.block;

    nock('http://127.0.0.1:20443')
      .get('/v2/neighbors')
      .reply(200, {
        sample: [],
        inbound: [],
        outbound: []
      });
    nock('http://127.0.0.1:20443')
      .get('/v2/info')
      .reply(200, {
        burn_block_height: block.burn_block_height,
        burn_consensus: block.burn_block_hash,
        exit_at_block_height: null,
        network_id: 1,
        parent_network_id: 1,
        peer_version: 1,
        server_version: 1,
        stable_burn_block_height: block.burn_block_height,
        stable_burn_consensus: block.burn_block_hash,
        stacks_tip: block.block_hash,
        stacks_tip_burn_block: block.burn_block_height,
        stacks_tip_height: block.block_height,
        unanchored_tip: ''
      });
    const query1 = await supertest(api.address)
      .post(`/rosetta/v1/network/status`)
      .send({ network_identifier: { blockchain: 'stacks', network: 'testnet' } });
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');

    const expectResponse = {
      current_block_identifier: {
        index: block.block_height,
        hash: block.block_hash,
      },
      current_block_timestamp: block.burn_block_time * 1000,
      genesis_block_identifier: {
        index: genesisBlock.block_height,
        hash: genesisBlock.block_hash,
      },
      peers: [],
    };

    expect(JSON.parse(query1.text)).toHaveProperty('sync_status');
    expect(JSON.parse(query1.text).current_block_identifier).toEqual(
      expectResponse.current_block_identifier
    );
    expect(JSON.parse(query1.text).current_block_timestamp).toEqual(
      expectResponse.current_block_timestamp
    );
    expect(JSON.parse(query1.text).genesis_block_identifier).toEqual(
      expectResponse.genesis_block_identifier
    );
  });

  test('block - by index', async () => {
    const blockHeight = 2;
    const tx = {
      type_id: DbTxTypeId.Coinbase,
      anchor_mode: AnchorMode.OnChainOnly,
      status: DbTxStatus.Success,
      sender_address: 'ST2N3HQ5BZV43J0ZZY4X6T50NTQTQBMZ3AVRQ86A',
      coinbase_payload: Buffer.alloc(0)
    }
    const parentData = new TestBlockBuilder().addTx().build();
    const data = new TestBlockBuilder({
      block_height: 2, 
      parent_block_hash: parentData.block.block_hash, 
      block_hash: '0x1234', 
      parent_index_block_hash: parentData.block.index_block_hash, 
      index_block_hash: '0x1234'
    }).addTx(tx).build();
    await db.update(parentData)
    await db.update(data);
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
          hash: data.block.block_hash,
        },
        parent_block_identifier: {
          index: blockHeight - 1,
          hash: data.block.parent_block_hash,
        },
        timestamp: data.block.burn_block_time * 1000,
        transactions: [
          {
            transaction_identifier: {
              hash: data.txs[0].tx.tx_id,
            },
            operations: [
              {
                operation_identifier: { index: 0 },
                type: 'coinbase',
                status: 'success',
                account: { address: data.txs[0].tx.sender_address },
              },
            ],
          },
        ],
      },
    });
  });

  test('block - by hash', async () => {
    const blockHeight = 2;
    const tx = {
      type_id: DbTxTypeId.Coinbase,
      anchor_mode: AnchorMode.OnChainOnly,
      status: DbTxStatus.Success,
      sender_address: 'ST2N3HQ5BZV43J0ZZY4X6T50NTQTQBMZ3AVRQ86A',
      coinbase_payload: Buffer.alloc(0)
    }
    const parentData = new TestBlockBuilder().addTx().build();
    const data = new TestBlockBuilder({
      block_height: 2, 
      parent_block_hash: parentData.block.block_hash, 
      block_hash: '0x1234', 
      parent_index_block_hash: parentData.block.index_block_hash, 
      index_block_hash: '0x1234'
    }).addTx(tx).build();
    await db.update(parentData)
    await db.update(data);
    const query1 = await supertest(api.address)
      .post(`/rosetta/v1/block`)
      .send({
        network_identifier: { blockchain: 'stacks', network: 'testnet' },
        block_identifier: { hash: data.block.block_hash },
      });
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');
    expect(JSON.parse(query1.text)).toEqual({
      block: {
        block_identifier: {
          index: blockHeight,
          hash: data.block.block_hash,
        },
        parent_block_identifier: {
          index: blockHeight - 1,
          hash: data.block.parent_block_hash,
        },
        timestamp: data.block.burn_block_time * 1000,
        transactions: [
          {
            transaction_identifier: {
              hash: data.txs[0].tx.tx_id,
            },
            operations: [
              {
                operation_identifier: { index: 0 },
                type: 'coinbase',
                status: 'success',
                account: { address: data.txs[0].tx.sender_address },
              },
            ],
          },
        ],
      },
    });
  });

  test('block - get latest', async () => {
    const block1 = {
      block_hash: '0xf989ae0dd9df72ba3256737cc088579fda6c9ad3779515e1f88f6f9b6d68a4af',
      index_block_hash: '0x2d1a360199f2992176b6c517df02e0350de863ac1d704e27f873aca41d1d5c58',
      burn_block_time: 1647245793,
      burn_block_hash: '0x12771355e46cd47c71ed1721fd5319b383cca3a1f9fce3aa1c8cd3bd37af20d7',
    }

    const block2 = {
      block_hash: '0x152ea79ffe71b835ccb575b732ed70354b169d44c6317752b2e1d48d15decf83',
      index_block_hash: '0x0d5247fb314341a505fe27740d7bd84fe3f071ff6b06d3ccfb8a00ba4d51b84f',
      parent_index_block_hash: block1.index_block_hash,
      parent_block_hash: block1.block_hash,
      block_height: 2,
      burn_block_time: 94869286,
      burn_block_hash: '0xfe15c0d3ebe314fad720a08b839a004c2e6386f5aecc19ec74807d1920cb6aeb',
    }

    await db.update(new TestBlockBuilder(block1).addTx().build());
    await db.update(new TestBlockBuilder(block2).addTx().build());

    const query1 = await supertest(api.address)
      .post(`/rosetta/v1/block`)
      .send({
        network_identifier: { blockchain: 'stacks', network: 'testnet' },
        block_identifier: {},
      });

    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');
    expect(JSON.parse(query1.text)).toEqual({
      block: {
        block_identifier: {
          index: block2.block_height,
          hash: block2.block_hash,
        },
        parent_block_identifier: {
          index: block2.block_height - 1,
          hash: block2.parent_block_hash,
        },
        timestamp: block2.burn_block_time * 1000,
        transactions: expect.objectContaining({}),
      },
    });
  });

  test('block/transaction', async () => {
    const block = {
      block_hash: '0xd0dd05e3d0a1bd60640c9d9d30d57012ffe47b52fe643140c39199c757d37e3f',
      index_block_hash: '0x6a36c14514047074c2877065809bbb70d81d52507747f4616da997deb7228fad',
      parent_index_block_hash: '0x81580c80601341be11c6a2412aa342bd506a7f373fb26eda5e28d126e3429d17',
      parent_block_hash: '0x5b68076486afbb5c20730269c0ea3a0c2f26cfd200676488402a30bcdd2e8136',
      parent_microblock_hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      burn_block_hash: '0xfe15c0d3ebe314fad720a08b839a004c2e6386f5aecc19ec74807d1920cb6aeb',
      miner_txid: '0x0000000000000000000000000000000000000000000000000000000000000000',
    }
    const tx = {
      tx_id: '0xc152de9376bab4fc27291c9cd088643698290a12bb511d768f873cb3d280eb48',
      tx_index: 1,
      type_id: DbTxTypeId.TokenTransfer,
      anchor_mode: DbTxAnchorMode.Any,
      status: DbTxStatus.Success,
      raw_result: '0x0703',
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: 2147483647,
      microblock_hash: '0x00',
      post_conditions: '0x01f5',
      fee_rate: 180n,
      sender_address: 'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR',
      abi: undefined,
      token_transfer_recipient_address: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP',
      token_transfer_amount: 3852n,
      token_transfer_memo: bufferToHexPrefixString(Buffer.from('test1234')).padEnd(70, '0'),
    }
    const data = new TestBlockBuilder(block).addTx(tx).build();
    await db.update(data);
    const query1 = await supertest(api.server)
      .post(`/rosetta/v1/block/transaction`)
      .send({
        network_identifier: { blockchain: 'stacks', network: 'testnet' },
        block_identifier: { index: data.block.block_height, hash: data.block.block_hash },
        transaction_identifier: { hash: tx.tx_id },
      });
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');
    expect(JSON.parse(query1.text)).toEqual({
      transaction_identifier: {
        hash: tx.tx_id,
      },
      metadata: {
        memo: 'test1234',
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
              identifier: `${tx.tx_id}:1`,
            },
          },
        },
        {
          operation_identifier: { index: 2 },
          related_operations: [{ index: 1 }],
          type: 'token_transfer',
          status: 'success',
          account: { address: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP' },
          amount: { value: '3852', currency: { symbol: 'STX', decimals: 6 } },
          coin_change: {
            coin_action: 'coin_created',
            coin_identifier: {
              identifier: `${tx.tx_id}:2`,
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

  test('rosetta/mempool list', async () => {
    const mempoolTxs: DbMempoolTxRaw[] = [];
    for (let i = 0; i < 10; i++) {
      const mempoolTx: DbMempoolTxRaw = {
        pruned: false,
        tx_id: `0x891200000000000000000000000000000000000000000000000000000000000${i}`,
        anchor_mode: 3,
        nonce: 0,
        raw_tx: ('0x6655443322'),
        type_id: DbTxTypeId.Coinbase,
        receipt_time: (new Date(`2020-07-09T15:14:0${i}Z`).getTime() / 1000) | 0,
        coinbase_payload: '0x11818181',
        status: 1,
        post_conditions: '0x01f5',
        fee_rate: 1234n,
        sponsored: false,
        sponsor_address: undefined,
        sender_address: 'sender-addr',
        origin_hash_mode: 1,
      };
      mempoolTxs.push(mempoolTx);
    }
    
    await db.updateMempoolTxs({ mempoolTxs });

    const request1: RosettaMempoolRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
    };
    const searchResult1 = await supertest(api.server).post('/rosetta/v1/mempool/').send(request1);

    expect(searchResult1.status).toBe(200);
    expect(searchResult1.type).toBe('application/json');
    const expectedResp1: RosettaMempoolResponse = {
      transaction_identifiers: [
        {
          hash: '0x8912000000000000000000000000000000000000000000000000000000000007',
        },
        {
          hash: '0x8912000000000000000000000000000000000000000000000000000000000006',
        },
        {
          hash: '0x8912000000000000000000000000000000000000000000000000000000000005',
        },
      ],
    };

    const result: RosettaMempoolResponse = JSON.parse(searchResult1.text);

    expect(result).toHaveProperty('transaction_identifiers');

    expect(result.transaction_identifiers).toEqual(
      expect.arrayContaining(expectedResp1.transaction_identifiers)
    );
  });

  test('rosetta/mempool/transaction', async () => {
    const mempoolTx: DbMempoolTxRaw = {
      pruned: false,
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '0x6655443322',
      type_id: DbTxTypeId.Coinbase,
      status: DbTxStatus.Success,
      receipt_time: 1594307695,
      coinbase_payload: '0x11818181',
      post_conditions: '0x01f5',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
    };
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });

    const request1: RosettaMempoolTransactionRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      transaction_identifier: { hash: mempoolTx.tx_id },
    };

    const searchResult1 = await supertest(api.server)
      .post(`/rosetta/v1/mempool/transaction/`)
      .send(request1);
    expect(searchResult1.status).toBe(200);
    expect(searchResult1.type).toBe('application/json');

    const rosettaAccount: RosettaAccount = {
      address: 'sender-addr',
    };

    const rosettaOperation: RosettaOperation = {
      operation_identifier: {
        index: 0,
      },
      status: 'success',
      type: 'coinbase',
      account: rosettaAccount,
    };
    const rosettaOperations: RosettaOperation[] = [];
    rosettaOperations.push(rosettaOperation);
    const transaction: RosettaTransaction = {
      operations: rosettaOperations,
      transaction_identifier: {
        hash: mempoolTx.tx_id,
      },
    };

    const expectedResp1: RosettaMempoolTransactionResponse = {
      transaction: transaction,
    };

    expect(JSON.parse(searchResult1.text)).toEqual(expectedResp1);
  });

  test('account/balance success', async () => {
    const block = {
      block_hash: '0x6d0df2553d3dd500dec73d00e5252eec09eb6d7cd36999b7dbf011abd186bdf0',
      index_block_hash: '0x9cd482f368644b5292bf05f5bb59a9e864386f8b96c49091ccf0818fe01c6fc5',
    }

    const stxEvent = {
      amount: 10000000000003852n,
      recipient: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP',
    }

    const data = new TestBlockBuilder(block).addTx().addTxStxEvent(stxEvent).build();

    await db.update(data);

    const request1: RosettaAccountBalanceRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      account_identifier: {
        address: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP',
      },
    };


    const result1 = await supertest(api.server).post(`/rosetta/v1/account/balance/`).send(request1);
    expect(result1.status).toBe(200);
    expect(result1.type).toBe('application/json');

    const curren_block = await api.datastore.getCurrentBlock();
    assert(curren_block.found);

    const amount: RosettaAmount = {
      value: '10000000000003852',
      currency: {
        symbol: 'STX',
        decimals: 6,
      },
    };

    const expectedResponse: RosettaAccountBalanceResponse = {
      block_identifier: {
        hash: data.block.block_hash,
        index: data.block.block_height,
      },
      balances: [amount],

      metadata: {
        sequence_number: 0,
      },
    };

    expect(JSON.parse(result1.text)).toEqual(expectedResponse);
  });

  test('account/balance - nonce calculated properly', async () => {
    const testAddr1 = 'STNN931GWC0XMRBWXYJQXTEKT4YFB1Z7YTCV3RZN';
    const testAddr2 = 'ST2WFY0H48AS2VYPA7N69V2VJ8VKS8FSPQSPFE1Z8';
    const testAddr3 = 'ST5F760KN84TZK3VTZCTVFYCVXQBEVKNV9M7H2CW';

    const senderAddr1 = 'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR';

    const block1 = {
      block_hash: '0xf989ae0dd9df72ba3256737cc088579fda6c9ad3779515e1f88f6f9b6d68a4af',
      index_block_hash: '0x2d1a360199f2992176b6c517df02e0350de863ac1d704e27f873aca41d1d5c58',
      burn_block_time: 1647245793,
      burn_block_hash: '0x12771355e46cd47c71ed1721fd5319b383cca3a1f9fce3aa1c8cd3bd37af20d7',
    }

    const block2 = {
      block_hash: '0x152ea79ffe71b835ccb575b732ed70354b169d44c6317752b2e1d48d15decf83',
      index_block_hash: '0x0d5247fb314341a505fe27740d7bd84fe3f071ff6b06d3ccfb8a00ba4d51b84f',
      parent_index_block_hash: block1.index_block_hash,
      parent_block_hash: block1.block_hash,
      block_height: 2,
      burn_block_time: 1647245794,
      burn_block_hash: '0xfe15c0d3ebe314fad720a08b839a004c2e6386f5aecc19ec74807d1920cb6aeb',
    }

    const block3 = {
      block_hash: '0xd20083b03d0908bb7852bfbd7c9c7b5a3220dd6505b73c047da75d9a33bd59c3',
      index_block_hash: '0xc04d68178a9181d21f11d161b0ce2d6b6d26d7e69e4ec8e6d5415f6046df6f8e',
      parent_index_block_hash: block2.index_block_hash,
      parent_block_hash: block2.block_hash,
      block_height: 3,
      burn_block_time: 1647250849,
      burn_block_hash: '0x376da11fe3ab3d0eaaddb418ccb49b5426d5c2504f526f7766580f6e45984e3b',
    }

    const block4 = {
      block_hash: '0x7d96609236e7cb6b55e0f3f8e94001e9b9223f5447fc97858137fed0314e0cae',
      index_block_hash: '0x1ccfee962a39249655c9547fdf76e781e12698e0244de3f0f816f1e3d22aeb65',
      parent_index_block_hash: block3.index_block_hash,
      parent_block_hash: block3.block_hash,
      block_height: 4,
      burn_block_time: 1647250850,
      burn_block_hash: '0x4391a5c79ffdc79883036503ca551673c09deec28df432a8d88debc7fa2ec91e',
    }

    const tx_1 =  {
      tx_id: '0xa95f0f833cf3b90473a9654526e9cb02626b85f32efae7f05c139d3460225d5f',
      type_id: DbTxTypeId.TokenTransfer,
      anchor_mode: AnchorMode.Any,
      status: DbTxStatus.Success,
      sender_address: 'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR',
      event_count: 1,
      token_transfer_recipient_address: testAddr1,
      token_transfer_amount: 10000000n,
      token_transfer_memo: '0x25463526',
      fee_rate: 180n,
    }

    const tx_2 = {
      tx_id: '0xf03f217ebd89d2e0fd9bdf56ad2cc09b42455cd0d3442a4ebbb9f9dbf0dcc6b9',
      type_id: DbTxTypeId.TokenTransfer,
      anchor_mode: AnchorMode.Any,
      status: DbTxStatus.Success,
      sender_address: testAddr1,
      event_count: 1,
      token_transfer_recipient_address: testAddr2,
      token_transfer_amount: 10n,
      token_transfer_memo: '0x25463526',
      fee_rate: 180n,
    }

    const tx_3 = {
      tx_id: '0xc9d72d08ae48503e93f54b218b9048b1afdb1054f15baa3244490ad41a5a5902',
      type_id: DbTxTypeId.TokenTransfer,
      anchor_mode: AnchorMode.Any,
      status: DbTxStatus.Success,
      sender_address: testAddr1,
      event_count: 1,
      token_transfer_recipient_address: testAddr2,
      token_transfer_amount: 10n,
      token_transfer_memo: '0x25463526',
      nonce: 1,
      fee_rate: 180n,
    }

    const tx_4 = {
      tx_id: '0x552e94a0d57683fd8b8e4dfa5c807096e1fa7b6ab67f651f735b9d5e3c8bea93',
      type_id: DbTxTypeId.TokenTransfer,
      anchor_mode: AnchorMode.Any,
      status: DbTxStatus.Success,
      sender_address: testAddr1,
      event_count: 1,
      token_transfer_recipient_address: testAddr2,
      token_transfer_amount: 10n,
      token_transfer_memo: '0x25463526',
      fee_rate: 180n,
    }

    const stx1 =  {
      tx: tx_1,
      amount: 10000000n,
      sender: senderAddr1,
      recipient: testAddr1
    }

    const stx2 = {
      amount: 10n,
      tx: tx_2,
      sender: testAddr1,
      recipient: testAddr2
    }

    const stx3 = {
      amount: 10n,
      tx: tx_3,
      sender: testAddr1,
      recipient: testAddr2,
    }

    const stx4 = {
      amount: 10n,
      tx: tx_4,
      sender: testAddr1,
      recipient: testAddr2
    }

    const data1 = new TestBlockBuilder(block1).addTx(tx_1).addTxStxEvent(stx1).build();
    const data2 = new TestBlockBuilder(block2).addTx(tx_2).addTxStxEvent(stx2).build();
    const data3 = new TestBlockBuilder(block3).addTx(tx_3).addTxStxEvent(stx3).build();
    const data4 = new TestBlockBuilder(block4).addTx(tx_4).addTxStxEvent(stx4).build();

    await db.update(data1);
    await db.update(data2);
    await db.update(data3);
    await db.update(data4);

    const request1: RosettaAccountBalanceRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      block_identifier: {
        index: data3.block.block_height,
      },
      account_identifier: {
        address: testAddr1,
      },
    };
    const nonceResult1 = await supertest(api.server).post(`/rosetta/v1/account/balance/`).send(request1);
    expect(nonceResult1.status).toBe(200);
    expect(nonceResult1.type).toBe('application/json');
    const expectedResponse1: RosettaAccountBalanceResponse = {
      block_identifier: {
        hash: data3.block.block_hash,
        index: data3.block.block_height,
      },
      balances: [{
        value: '9999620',
        currency: {
          symbol: 'STX',
          decimals: 6,
        },
      }],
      metadata: {
        sequence_number: 2,
      },
    };
    expect(JSON.parse(nonceResult1.text)).toEqual(expectedResponse1);

    const request2: RosettaAccountBalanceRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      block_identifier: {
        index: data2.block.block_height,
      },
      account_identifier: {
        address: testAddr1,
      },
    };
    const nonceResult2 = await supertest(api.server).post(`/rosetta/v1/account/balance/`).send(request2);
    expect(nonceResult2.status).toBe(200);
    expect(nonceResult2.type).toBe('application/json');
    const expectedResponse2: RosettaAccountBalanceResponse = {
      block_identifier: {
        hash: data2.block.block_hash,
        index: data2.block.block_height,
      },
      balances: [{
        value: '9999810',
        currency: {
          symbol: 'STX',
          decimals: 6,
        },
      }],
      metadata: {
        sequence_number: 1,
      },
    };
    expect(JSON.parse(nonceResult2.text)).toEqual(expectedResponse2);

    // Test account without any existing txs, should have "next nonce" value of 0
    const request3: RosettaAccountBalanceRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      block_identifier: {
        index: data2.block.block_height,
      },
      account_identifier: {
        address: testAddr3,
      },
    };
    const nonceResult3 = await supertest(api.server).post(`/rosetta/v1/account/balance/`).send(request3);
    expect(nonceResult3.status).toBe(200);
    expect(nonceResult3.type).toBe('application/json');
    const expectedResponse3: RosettaAccountBalanceResponse = {
      block_identifier: {
        hash: data2.block.block_hash,
        index: data2.block.block_height,
      },
      balances: [{
        value: '0',
        currency: {
          symbol: 'STX',
          decimals: 6,
        },
      }],
      metadata: {
        sequence_number: 0,
      },
    };
    expect(JSON.parse(nonceResult3.text)).toEqual(expectedResponse3);
  });

  test('account/balance - fees calculated properly', async () => {
    const stxAddress = 'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR';
    const senderAddr = 'STNN931GWC0XMRBWXYJQXTEKT4YFB1Z7YTCV3RZN';

    const block1 = {
      block_hash: '0xf989ae0dd9df72ba3256737cc088579fda6c9ad3779515e1f88f6f9b6d68a4af',
      index_block_hash: '0x2d1a360199f2992176b6c517df02e0350de863ac1d704e27f873aca41d1d5c58',
      burn_block_time: 1647245793,
      burn_block_hash: '0x12771355e46cd47c71ed1721fd5319b383cca3a1f9fce3aa1c8cd3bd37af20d7',
    }

    const tx_1 =  {
      tx_id: '0xa95f0f833cf3b90473a9654526e9cb02626b85f32efae7f05c139d3460225d5f',
      type_id: DbTxTypeId.TokenTransfer,
      anchor_mode: AnchorMode.Any,
      status: DbTxStatus.Success,
      sender_address: senderAddr,
      event_count: 1,
      token_transfer_recipient_address: stxAddress,
      token_transfer_amount: 10000000000000000n,
      token_transfer_memo: '0x25463526',
    }

    const stx1 =  {
      tx: tx_1,
      amount: tx_1.token_transfer_amount,
      sender: senderAddr,
      recipient: stxAddress
    }

    const data1 = new TestBlockBuilder(block1).addTx(tx_1).addTxStxEvent(stx1).build();

    await db.update(data1);

    const request1: RosettaAccountBalanceRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      block_identifier: {
        index: 1,
      },
      account_identifier: {
        address: stxAddress,
      },
    };

    const result1 = await supertest(api.server).post(`/rosetta/v1/account/balance/`).send(request1);
    expect(result1.status).toBe(200);
    expect(result1.type).toBe('application/json');

    const amount: RosettaAmount = {
      value: '10000000000000000',
      currency: {
        symbol: 'STX',
        decimals: 6,
      },
    };

    const expectedResponse: RosettaAccountBalanceResponse = {
      block_identifier: {
        hash: data1.block.block_hash,
        index: data1.block.block_height,
      },
      balances: [amount],

      metadata: {
        sequence_number: 0,
      },
    };

    expect(JSON.parse(result1.text)).toEqual(expectedResponse);
  });

  test('account/balance - invalid account identifier', async () => {
    const request: RosettaAccountBalanceRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      account_identifier: {
        address: 'KK',
        metadata: {},
      },
    };

    const result = await supertest(api.server).post(`/rosetta/v1/account/balance/`).send(request);
    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    const expectResponse = {
      code: 601,
      message: 'Invalid Account.',
      retriable: true,
    };

    expect(JSON.parse(result.text)).toEqual(expectResponse);
  });

  test('account/balance - empty block identifier', async () => {
    const request: RosettaAccountBalanceRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      account_identifier: {
        address: 'SP2QXJDSWYFGT9022M6NCA9SS4XNQM79D8E7EDSPQ',
        metadata: {},
      },
      block_identifier: {},
    };

    const result = await supertest(api.server).post(`/rosetta/v1/account/balance/`).send(request);
    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    const expectResponse = {
      code: 615,
      message: 'Block identifier is null.',
      retriable: false,
    };

    expect(JSON.parse(result.text)).toEqual(expectResponse);
  });

  test('account/balance - invalid block hash', async () => {
    const request: RosettaAccountBalanceRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      account_identifier: {
        address: 'SP2QXJDSWYFGT9022M6NCA9SS4XNQM79D8E7EDSPQ',
        metadata: {},
      },
      block_identifier: {
        hash: 'afd',
      },
    };
    const result = await supertest(api.server).post(`/rosetta/v1/account/balance/`).send(request);
    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    const expectResponse = {
      code: 606,
      message: 'Invalid block hash.',
      retriable: true,
    };

    expect(JSON.parse(result.text)).toEqual(expectResponse);
  });

  test('search balance by block_hash', async () => {
    const block_hash = '0x123456';
    const request: RosettaAccountBalanceRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      account_identifier: {
        address: 'SP2QXJDSWYFGT9022M6NCA9SS4XNQM79D8E7EDSPQ',
        metadata: {},
      },
      block_identifier: {
        hash: block_hash,
      },
    };
    await db.update(new TestBlockBuilder({ block_hash }).build());
    const result = await supertest(api.server).post(`/rosetta/v1/account/balance/`).send(request);
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');

    const expectResponse = {
      block_identifier: { index: 1, hash: block_hash },
      balances: [ 
        { 
          value: '0', 
          currency: {
            decimals: 6,
            symbol: "STX",
          } 
        } 
      ],
      metadata: { sequence_number: 0 }
    }
    expect(JSON.parse(result.text)).toEqual(expectResponse);
  });

  test('missing account_identifier for balance', async () => {
    const request = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      block_identifier: {
        hash: 'afd',
      },
    };
    const result = await supertest(api.server).post(`/rosetta/v1/account/balance/`).send(request);
    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    const expectResponse = {
      code: 609,
      message: 'Invalid params.',
      retriable: false,
      details: { message: "should have required property 'account_identifier'" }
    }
    expect(JSON.parse(result.text)).toEqual(expectResponse);
  });

  test('block not found', async () => {
    const request: RosettaAccountBalanceRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      account_identifier: {
        address: 'SP2QXJDSWYFGT9022M6NCA9SS4XNQM79D8E7EDSPQ',
        metadata: {},
      },
      block_identifier: {
        hash: '0x123456',
      },
    };
    const result = await supertest(api.server).post(`/rosetta/v1/account/balance/`).send(request);
    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    const expectResponse = { 
      code: 605, 
      message: 'Block not found.', 
      retriable: true 
    }
    expect(JSON.parse(result.text)).toEqual(expectResponse);
  });

  test('invalid block_hash', async () => {
    const block_hash = '123456';
    const request: RosettaAccountBalanceRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      account_identifier: {
        address: 'SP2QXJDSWYFGT9022M6NCA9SS4XNQM79D8E7EDSPQ',
        metadata: {},
      },
      block_identifier: {
        hash: block_hash,
      },
    };
    await db.update(new TestBlockBuilder({ block_hash: '0x' + block_hash }).build());
    const result = await supertest(api.server).post(`/rosetta/v1/account/balance/`).send(request);
    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    const expectResponse = { 
      code: 606, 
      message: 'Invalid block hash.', 
      retriable: true 
    }
    expect(JSON.parse(result.text)).toEqual(expectResponse);
  });

  test('invalid sub_account_indentifier', async () => {
    const block_hash = '0x123456';
    const request: RosettaAccountBalanceRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      account_identifier: {
        address: 'SP2QXJDSWYFGT9022M6NCA9SS4XNQM79D8E7EDSPQ',
        sub_account: {
          address: 'invalid account'
        },
        metadata: {},
      },
      block_identifier: {
        hash: block_hash,
      },
    };
    await db.update(new TestBlockBuilder({ block_hash: block_hash }).build());
    const result = await supertest(api.server).post(`/rosetta/v1/account/balance/`).send(request);
    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');

    const expectResponse = { 
      code: 641, 
      message: 'Invalid sub-account', 
      retriable: false 
    }
    expect(JSON.parse(result.text)).toEqual(expectResponse);
  });

  test('vesting schedule amount', async () => {
    const block_hash = '0x123456';
    const address = 'SP2QXJDSWYFGT9022M6NCA9SS4XNQM79D8E7EDSPQ';
    const block = new TestBlockBuilder({ block_hash }).build();
    const request: RosettaAccountBalanceRequest = {
      network_identifier: {
        blockchain: 'stacks',
        network: 'testnet',
      },
      account_identifier: {
        address: 'SP2QXJDSWYFGT9022M6NCA9SS4XNQM79D8E7EDSPQ',
        sub_account: {
          address: RosettaConstants.VestingLockedBalance
        },
        metadata: {},
      },
      block_identifier: {
        hash: block_hash,
      },
    };
    await db.update(block);
    await db.updateBatchTokenOfferingLocked(client, [{ address, block: block.block.block_height, value: 50n }]);
    const result = await supertest(api.server).post(`/rosetta/v1/account/balance/`).send(request);
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');

    const expectResponse = {
      block_identifier: { index: 1, hash: block_hash },
      balances: [ 
        { 
          value: '0', 
          currency: {
            decimals: 6,
            symbol: 'STX'
          }, 
          metadata: {
            VestingSchedule: [
              JSON.stringify({
                amount: '50',
                unlock_height: 1
              })
            ]
          }
        } 
      ],
      metadata: { sequence_number: 0 }
    }
    expect(JSON.parse(result.text)).toEqual(expectResponse);
  });

  test('invalid rosetta block request', async () => {
    const result = await supertest(api.address)
      .post(`/rosetta/v1/block`)
      .send({
        network_identifier: { blockchain: 'stacks', network: 'testnet' }
      });
    const expectResponse = {
      code: 615,
      message: 'Block identifier is null.',
      retriable: false,
      details: { message: "should have required property 'block_identifier'" }
    }
    expect(JSON.parse(result.text)).toEqual(expectResponse);
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
