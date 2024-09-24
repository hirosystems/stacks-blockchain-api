import * as supertest from 'supertest';
import {
  bufferCV,
  ChainID,
  cvToHex,
  listCV,
  stringAsciiCV,
  stringUtf8CV,
  tupleCV,
  uintCV,
} from '@stacks/transactions';
import { ApiServer, startApiServer } from '../../src/api/init';
import { TestBlockBuilder } from '../utils/test-builders';
import { DbAssetEventTypeId, DbTxTypeId } from '../../src/datastore/common';
import { createClarityValueArray } from '../../src/stacks-encoding-helpers';
import { PgWriteStore } from '../../src/datastore/pg-write-store';
import { principalCV } from '@stacks/transactions/dist/clarity/types/principalCV';
import { migrate } from '../utils/test-helpers';
import { bufferToHex } from '@hirosystems/api-toolkit';
import nock = require('nock');

describe('/block tests', () => {
  let db: PgWriteStore;
  let api: ApiServer;

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({ usageName: 'tests' });
    api = await startApiServer({ datastore: db, chainId: ChainID.Testnet });
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await migrate('down');
  });

  test('block/transaction - contract_call contains parsed metadata', async () => {
    const testContractAddr = 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world';
    const contractJsonAbi = {
      maps: [],
      functions: [
        {
          args: [
            { type: 'uint128', name: 'amount' },
            { type: 'string-ascii', name: 'desc' },
          ],
          name: 'test-contract-fn',
          access: 'public',
          outputs: {
            type: {
              response: {
                ok: 'uint128',
                error: 'none',
              },
            },
          },
        },
      ],
      variables: [],
      fungible_tokens: [],
      non_fungible_tokens: [],
    };

    const block1 = new TestBlockBuilder({
      block_height: 1,
      index_block_hash: '0x01',
    })
      .addTx({ tx_id: '0x1111' })
      .addTxSmartContract({ contract_id: testContractAddr, abi: JSON.stringify(contractJsonAbi) })
      .addTxContractLogEvent({ contract_identifier: testContractAddr })
      .build();
    await db.update(block1);
    const block2 = new TestBlockBuilder({
      block_height: 2,
      index_block_hash: '0x02',
      parent_index_block_hash: '0x01',
      block_hash: '0xf1f1',
    })
      .addTx({
        tx_id: '0x1112',
        type_id: DbTxTypeId.ContractCall,
        sender_address: testContractAddr,
        contract_call_contract_id: testContractAddr,
        contract_call_function_name: 'test-contract-fn',
        contract_call_function_args: bufferToHex(
          createClarityValueArray(uintCV(123456), stringAsciiCV('hello'))
        ),
        abi: JSON.stringify(contractJsonAbi),
      })
      .build();
    await db.update(block2);

    const query1 = await supertest(api.server)
      .post(`/rosetta/v1/block/transaction`)
      .send({
        network_identifier: { blockchain: 'stacks', network: 'testnet' },
        block_identifier: { index: 2, hash: '0xf1f1' },
        transaction_identifier: { hash: '0x1112' },
      });
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');
    const result = JSON.parse(query1.text);
    expect(result.transaction_identifier.hash).toEqual('0x1112');
    expect(result.operations[1].metadata).toEqual({
      contract_id: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
      function_args: [
        {
          hex: '0x010000000000000000000000000001e240',
          name: 'amount',
          repr: 'u123456',
          type: 'uint',
        },
        {
          hex: '0x0d0000000568656c6c6f',
          name: 'desc',
          repr: '"hello"',
          type: 'string-ascii',
        },
      ],
      function_name: 'test-contract-fn',
      function_signature: '(define-public (test-contract-fn (amount uint) (desc string-ascii)))',
    });
  });

  test('block/transaction - ft transfers included in operations', async () => {
    process.env.STACKS_API_ENABLE_FT_METADATA = '1';
    const addr1 = 'SP3WV3VC6GM1WF215SDHP0MESQ3BNXHB1N6TPB70S';
    const addr2 = 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y';

    const nodeUrl = `http://${process.env['STACKS_CORE_RPC_HOST']}:${process.env['STACKS_CORE_RPC_PORT']}`;
    nock(nodeUrl)
      .persist()
      .post(
        '/v2/contracts/call-read/SP2H8PY27SEZ03MWRKS5XABZYQN17ETGQS3527SA5/newyorkcitycoin-token/get-decimals'
      )
      .reply(200, {
        okay: true,
        result: cvToHex(uintCV(0)),
      });
    nock(nodeUrl)
      .persist()
      .post(
        '/v2/contracts/call-read/SP2H8PY27SEZ03MWRKS5XABZYQN17ETGQS3527SA5/newyorkcitycoin-token/get-symbol'
      )
      .reply(200, {
        okay: true,
        result: cvToHex(stringUtf8CV('NYC')),
      });

    // FT transfer
    const block1 = new TestBlockBuilder({
      block_height: 1,
      index_block_hash: '0x01',
    })
      .addTx({ tx_id: '0x1110' })
      .build();
    await db.update(block1);
    const block2 = new TestBlockBuilder({
      block_height: 2,
      index_block_hash: '0x02',
      parent_index_block_hash: '0x01',
      block_hash: '0xf1f1',
    })
      .addTx({ tx_id: '0x1111', sender_address: addr1 })
      .addTxFtEvent({
        asset_identifier:
          'SP2H8PY27SEZ03MWRKS5XABZYQN17ETGQS3527SA5.newyorkcitycoin-token::newyorkcitycoin',
        asset_event_type_id: DbAssetEventTypeId.Transfer,
        amount: 7500n,
        sender: addr1,
        recipient: addr2,
      })
      .build();
    await db.update(block2);

    const query1 = await supertest(api.server)
      .post(`/rosetta/v1/block/transaction`)
      .send({
        network_identifier: { blockchain: 'stacks', network: 'testnet' },
        block_identifier: { index: 2, hash: '0xf1f1' },
        transaction_identifier: { hash: '0x1111' },
      });
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');
    const result1 = JSON.parse(query1.text);
    expect(result1.operations[1]).toEqual({
      account: {
        address: 'SP3WV3VC6GM1WF215SDHP0MESQ3BNXHB1N6TPB70S',
      },
      amount: {
        currency: {
          decimals: 0,
          symbol: 'NYC',
        },
        value: '-7500',
        metadata: {
          token_type: 'ft',
        },
      },
      coin_change: {
        coin_action: 'coin_spent',
        coin_identifier: {
          identifier: '0x1111:1',
        },
      },
      operation_identifier: {
        index: 1,
      },
      status: 'success',
      type: 'token_transfer',
    });
    expect(result1.operations[2]).toEqual({
      account: {
        address: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y',
      },
      amount: {
        currency: {
          decimals: 0,
          symbol: 'NYC',
        },
        value: '7500',
        metadata: {
          token_type: 'ft',
        },
      },
      coin_change: {
        coin_action: 'coin_created',
        coin_identifier: {
          identifier: '0x1111:2',
        },
      },
      operation_identifier: {
        index: 2,
      },
      related_operations: [
        {
          index: 1,
        },
      ],
      status: 'success',
      type: 'token_transfer',
    });

    // FT burn
    const block3 = new TestBlockBuilder({
      block_height: 3,
      index_block_hash: '0x03',
      parent_index_block_hash: '0x02',
      block_hash: '0xf1f2',
    })
      .addTx({ tx_id: '0x1112', sender_address: addr1 })
      .addTxFtEvent({
        asset_identifier:
          'SP2H8PY27SEZ03MWRKS5XABZYQN17ETGQS3527SA5.newyorkcitycoin-token::newyorkcitycoin',
        asset_event_type_id: DbAssetEventTypeId.Burn,
        amount: 100n,
        sender: addr1,
      })
      .build();
    await db.update(block3);

    const query2 = await supertest(api.server)
      .post(`/rosetta/v1/block/transaction`)
      .send({
        network_identifier: { blockchain: 'stacks', network: 'testnet' },
        block_identifier: { index: 3, hash: '0xf1f2' },
        transaction_identifier: { hash: '0x1112' },
      });
    expect(query2.status).toBe(200);
    expect(query2.type).toBe('application/json');
    const result2 = JSON.parse(query2.text);
    expect(result2.operations[1]).toEqual({
      account: {
        address: 'SP3WV3VC6GM1WF215SDHP0MESQ3BNXHB1N6TPB70S',
      },
      amount: {
        currency: {
          decimals: 0,
          symbol: 'NYC',
        },
        value: '-100',
        metadata: {
          token_type: 'ft',
        },
      },
      operation_identifier: {
        index: 1,
      },
      status: 'success',
      type: 'burn',
    });

    // FT mint
    const block4 = new TestBlockBuilder({
      block_height: 4,
      index_block_hash: '0x04',
      parent_index_block_hash: '0x03',
      block_hash: '0xf1f3',
    })
      .addTx({ tx_id: '0x1113', sender_address: addr1 })
      .addTxFtEvent({
        asset_identifier:
          'SP2H8PY27SEZ03MWRKS5XABZYQN17ETGQS3527SA5.newyorkcitycoin-token::newyorkcitycoin',
        asset_event_type_id: DbAssetEventTypeId.Mint,
        amount: 500n,
        recipient: addr1,
      })
      .build();
    await db.update(block4);

    const query3 = await supertest(api.server)
      .post(`/rosetta/v1/block/transaction`)
      .send({
        network_identifier: { blockchain: 'stacks', network: 'testnet' },
        block_identifier: { index: 4, hash: '0xf1f3' },
        transaction_identifier: { hash: '0x1113' },
      });
    expect(query3.status).toBe(200);
    expect(query3.type).toBe('application/json');
    const result3 = JSON.parse(query3.text);
    expect(result3.operations[1]).toEqual({
      account: {
        address: 'SP3WV3VC6GM1WF215SDHP0MESQ3BNXHB1N6TPB70S',
      },
      amount: {
        currency: {
          decimals: 0,
          symbol: 'NYC',
        },
        value: '500',
        metadata: {
          token_type: 'ft',
        },
      },
      operation_identifier: {
        index: 1,
      },
      status: 'success',
      type: 'mint',
    });

    // FT mint without metadata [mode=error]
    process.env.STACKS_API_TOKEN_METADATA_ERROR_MODE = 'error';
    const block5 = new TestBlockBuilder({
      block_height: 5,
      index_block_hash: '0x05',
      parent_index_block_hash: '0x04',
      block_hash: '0xf1f4',
    })
      .addTx({ tx_id: '0x1114', sender_address: addr1 })
      .addTxFtEvent({
        asset_identifier: 'SP2H8PY27SEZ03MWRKS5XABZYQN17ETGQS3527SA5.miamicoin-token::miamicoin',
        asset_event_type_id: DbAssetEventTypeId.Mint,
        amount: 500n,
        recipient: addr1,
      })
      .build();
    await db.update(block5);

    const query4 = await supertest(api.server)
      .post(`/rosetta/v1/block/transaction`)
      .send({
        network_identifier: { blockchain: 'stacks', network: 'testnet' },
        block_identifier: { index: 4, hash: '0xf1f4' },
        transaction_identifier: { hash: '0x1114' },
      });
    expect(query4.status).toBe(500); // Error
    expect(query4.type).toBe('application/json');

    // FT mint without metadata [mode=warning]
    process.env.STACKS_API_TOKEN_METADATA_ERROR_MODE = 'warning';
    const block6 = new TestBlockBuilder({
      block_height: 6,
      index_block_hash: '0x06',
      parent_index_block_hash: '0x05',
      block_hash: '0xf1f5',
    })
      .addTx({ tx_id: '0x1115', sender_address: addr1 })
      .addTxFtEvent({
        asset_identifier: 'SP2H8PY27SEZ03MWRKS5XABZYQN17ETGQS3527SA5.miamicoin-token::miamicoin',
        asset_event_type_id: DbAssetEventTypeId.Mint,
        amount: 500n,
        recipient: addr1,
      })
      .build();
    await db.update(block6);

    const query5 = await supertest(api.server)
      .post(`/rosetta/v1/block/transaction`)
      .send({
        network_identifier: { blockchain: 'stacks', network: 'testnet' },
        block_identifier: { index: 4, hash: '0xf1f5' },
        transaction_identifier: { hash: '0x1115' },
      });
    expect(query5.status).toBe(200);
    expect(query5.type).toBe('application/json');
    const result5 = JSON.parse(query5.text);
    // No operation, ignored due to missing metadata.
    expect(result5.operations[1]).toEqual(undefined);
  });

  test('block/transaction - send-many-memo includes memo metadata', async () => {
    const sendManyAddr = 'ST3F1X4QGV2SM8XD96X45M6RTQXKA1PZJZZCQAB4B.send-many-memo';
    const sendManyAbi = {
      maps: [],
      functions: [
        {
          args: [
            {
              name: 'result',
              type: { response: { ok: 'bool', error: 'uint128' } },
            },
            {
              name: 'prior',
              type: { response: { ok: 'bool', error: 'uint128' } },
            },
          ],
          name: 'check-err',
          access: 'private',
          outputs: {
            type: { response: { ok: 'bool', error: 'uint128' } },
          },
        },
        {
          args: [
            {
              name: 'recipient',
              type: {
                tuple: [
                  { name: 'memo', type: { buffer: { length: 34 } } },
                  { name: 'to', type: 'principal' },
                  { name: 'ustx', type: 'uint128' },
                ],
              },
            },
          ],
          name: 'send-stx',
          access: 'private',
          outputs: {
            type: { response: { ok: 'bool', error: 'uint128' } },
          },
        },
        {
          args: [
            {
              name: 'recipients',
              type: {
                list: {
                  type: {
                    tuple: [
                      { name: 'memo', type: { buffer: { length: 34 } } },
                      { name: 'to', type: 'principal' },
                      { name: 'ustx', type: 'uint128' },
                    ],
                  },
                  length: 200,
                },
              },
            },
          ],
          name: 'send-many',
          access: 'public',
          outputs: {
            type: { response: { ok: 'bool', error: 'uint128' } },
          },
        },
        {
          args: [
            { name: 'ustx', type: 'uint128' },
            { name: 'to', type: 'principal' },
            { name: 'memo', type: { buffer: { length: 34 } } },
          ],
          name: 'send-stx-with-memo',
          access: 'public',
          outputs: {
            type: { response: { ok: 'bool', error: 'uint128' } },
          },
        },
      ],
      variables: [],
      fungible_tokens: [],
      non_fungible_tokens: [],
    };

    // Deploy
    const block1 = new TestBlockBuilder({
      block_height: 1,
      index_block_hash: '0x01',
    })
      .addTx({ tx_id: '0x1111' })
      .addTxSmartContract({ contract_id: sendManyAddr, abi: JSON.stringify(sendManyAbi) })
      .build();
    await db.update(block1);

    // send-many
    const block2 = new TestBlockBuilder({
      block_height: 2,
      index_block_hash: '0x02',
      parent_index_block_hash: '0x01',
    })
      .addTx({
        tx_id: '0x1112',
        type_id: DbTxTypeId.ContractCall,
        sender_address: sendManyAddr,
        contract_call_contract_id: sendManyAddr,
        contract_call_function_name: 'send-many',
        contract_call_function_args: bufferToHex(
          createClarityValueArray(
            listCV([
              tupleCV({
                memo: bufferCV(Buffer.from('memo-1')),
                to: principalCV('SPG7RD94XW8HN5NS7V68YDJAY4PJVZ2KNY79Z518'),
                ustx: uintCV(2000),
              }),
              tupleCV({
                memo: bufferCV(Buffer.from('memo-2')),
                to: principalCV('SP2XN3N1C3HM1YFHKBE07EW7AFZBZPXDTHSP92HAX'),
                ustx: uintCV(2500),
              }),
              tupleCV({
                to: principalCV('SP2PDY84DFFJS0PQN3P0WBYZFW1EZSAC67N08BWH0'),
                ustx: uintCV(50000),
              }),
            ])
          )
        ),
        abi: JSON.stringify(sendManyAbi),
      })
      // Simulate events as they would come in the contract call (in order)
      .addTxStxEvent({
        sender: sendManyAddr,
        recipient: 'SPG7RD94XW8HN5NS7V68YDJAY4PJVZ2KNY79Z518',
        amount: 2000n,
      })
      .addTxContractLogEvent({
        contract_identifier: sendManyAddr,
        topic: 'print',
        value: cvToHex(bufferCV(Buffer.from('memo-1'))),
      })
      .addTxStxEvent({
        sender: sendManyAddr,
        recipient: 'SP2XN3N1C3HM1YFHKBE07EW7AFZBZPXDTHSP92HAX',
        amount: 2500n,
      })
      .addTxContractLogEvent({
        contract_identifier: sendManyAddr,
        topic: 'print',
        value: cvToHex(bufferCV(Buffer.from('memo-2'))),
      })
      .addTxStxEvent({
        sender: sendManyAddr,
        recipient: 'SP2PDY84DFFJS0PQN3P0WBYZFW1EZSAC67N08BWH0',
        amount: 50000n,
      })
      .build();
    await db.update(block2);

    const query1 = await supertest(api.server)
      .post(`/rosetta/v1/block/transaction`)
      .send({
        network_identifier: { blockchain: 'stacks', network: 'testnet' },
        block_identifier: { index: 2 },
        transaction_identifier: { hash: '0x1112' },
      });
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');
    const result = JSON.parse(query1.text);
    expect(result.transaction_identifier.hash).toEqual('0x1112');
    expect(result.operations[2].metadata).toEqual({ memo: 'memo-1' });
    expect(result.operations[2].operation_identifier.index).toEqual(2);
    expect(result.operations[3].metadata).toEqual({ memo: 'memo-1' });
    expect(result.operations[3].operation_identifier.index).toEqual(3);
    expect(result.operations[4].metadata).toEqual({ memo: 'memo-2' });
    expect(result.operations[4].operation_identifier.index).toEqual(4);
    expect(result.operations[5].metadata).toEqual({ memo: 'memo-2' });
    expect(result.operations[5].operation_identifier.index).toEqual(5);
    expect(result.operations[6].metadata).toEqual({ memo: '' });
    expect(result.operations[6].operation_identifier.index).toEqual(6);
    expect(result.operations[7].metadata).toEqual({ memo: '' });
    expect(result.operations[7].operation_identifier.index).toEqual(7);

    // send-stx-with-memo
    const block3 = new TestBlockBuilder({
      block_height: 3,
      index_block_hash: '0x03',
      parent_index_block_hash: '0x02',
    })
      .addTx({
        tx_id: '0x1113',
        type_id: DbTxTypeId.ContractCall,
        sender_address: sendManyAddr,
        contract_call_contract_id: sendManyAddr,
        contract_call_function_name: 'send-stx-with-memo',
        contract_call_function_args: bufferToHex(
          createClarityValueArray(
            uintCV(2000),
            principalCV('SPG7RD94XW8HN5NS7V68YDJAY4PJVZ2KNY79Z518'),
            bufferCV(Buffer.from('memo-1'))
          )
        ),
        abi: JSON.stringify(sendManyAbi),
      })
      // Simulate events as they would come in the contract call (in order)
      .addTxStxEvent({
        sender: sendManyAddr,
        recipient: 'SPG7RD94XW8HN5NS7V68YDJAY4PJVZ2KNY79Z518',
        amount: 2000n,
      })
      .build();
    await db.update(block3);

    const query2 = await supertest(api.server)
      .post(`/rosetta/v1/block/transaction`)
      .send({
        network_identifier: { blockchain: 'stacks', network: 'testnet' },
        block_identifier: { index: 3 },
        transaction_identifier: { hash: '0x1113' },
      });
    expect(query2.status).toBe(200);
    expect(query2.type).toBe('application/json');
    const result2 = JSON.parse(query2.text);
    expect(result2.transaction_identifier.hash).toEqual('0x1113');
    expect(result2.operations[2].metadata).toEqual({ memo: 'memo-1' });
    expect(result2.operations[3].metadata).toEqual({ memo: 'memo-1' });
  });
});
