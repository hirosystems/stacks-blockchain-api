import * as supertest from 'supertest';
import { ChainID, stringAsciiCV, uintCV } from '@stacks/transactions';
import { ApiServer, startApiServer } from '../api/init';
import { TestBlockBuilder } from '../test-utils/test-builders';
import { DbAssetEventTypeId, DbFungibleTokenMetadata, DbTxTypeId } from '../datastore/common';
import { createClarityValueArray } from '../stacks-encoding-helpers';
import { PgWriteStore } from '../datastore/pg-write-store';
import { cycleMigrations, runMigrations } from '../datastore/migrations';
import { bufferToHexPrefixString } from '../helpers';

describe('/block tests', () => {
  let db: PgWriteStore;
  let api: ApiServer;

  beforeEach(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgWriteStore.connect({ usageName: 'tests' });
    api = await startApiServer({ datastore: db, chainId: ChainID.Testnet, httpLogLevel: 'silly' });
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
        contract_call_function_args: bufferToHexPrefixString(createClarityValueArray(uintCV(123456), stringAsciiCV('hello'))),
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

    // Declare fungible token
    const ftMetadata: DbFungibleTokenMetadata = {
      token_uri: 'https://cdn.citycoins.co/metadata/newyorkcitycoin.json',
      name: 'newyorkcitycoin',
      description: 'A CityCoin for New York City, ticker is NYC, Stack it to earn Stacks (STX)',
      image_uri: 'https://stacks-api.imgix.net/https%3A%2F%2Fcdn.citycoins.co%2Flogos%2Fnewyorkcitycoin.png?s=38a8d89aa6b4ef3fcc9958da3eb34480',
      image_canonical_uri: 'https://cdn.citycoins.co/logos/newyorkcitycoin.png',
      symbol: 'NYC',
      decimals: 0,
      tx_id: '0x9c8ddc44fcfdfc67af5425c4174833fc5814627936d573fe38fc29a46ba746e6',
      sender_address: 'SP2H8PY27SEZ03MWRKS5XABZYQN17ETGQS3527SA5',
      contract_id: 'SP2H8PY27SEZ03MWRKS5XABZYQN17ETGQS3527SA5.newyorkcitycoin-token'
    };
    await db.updateFtMetadata(ftMetadata, 1);

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
      block_hash: '0xf1f1'
    })
      .addTx({ tx_id: '0x1111', sender_address: addr1 })
      .addTxFtEvent({
        asset_identifier: 'SP2H8PY27SEZ03MWRKS5XABZYQN17ETGQS3527SA5.newyorkcitycoin-token::newyorkcitycoin',
        asset_event_type_id: DbAssetEventTypeId.Transfer,
        amount: 7500n,
        sender: addr1,
        recipient: addr2
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
      block_hash: '0xf1f2'
    })
      .addTx({ tx_id: '0x1112', sender_address: addr1 })
      .addTxFtEvent({
        asset_identifier: 'SP2H8PY27SEZ03MWRKS5XABZYQN17ETGQS3527SA5.newyorkcitycoin-token::newyorkcitycoin',
        asset_event_type_id: DbAssetEventTypeId.Burn,
        amount: 100n,
        sender: addr1
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
      block_hash: '0xf1f3'
    })
      .addTx({ tx_id: '0x1113', sender_address: addr1 })
      .addTxFtEvent({
        asset_identifier: 'SP2H8PY27SEZ03MWRKS5XABZYQN17ETGQS3527SA5.newyorkcitycoin-token::newyorkcitycoin',
        asset_event_type_id: DbAssetEventTypeId.Mint,
        amount: 500n,
        recipient: addr1
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
      block_hash: '0xf1f4'
    })
      .addTx({ tx_id: '0x1114', sender_address: addr1 })
      .addTxFtEvent({
        asset_identifier: 'SP2H8PY27SEZ03MWRKS5XABZYQN17ETGQS3527SA5.miamicoin-token::miamicoin',
        asset_event_type_id: DbAssetEventTypeId.Mint,
        amount: 500n,
        recipient: addr1
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
      block_hash: '0xf1f5'
    })
      .addTx({ tx_id: '0x1115', sender_address: addr1 })
      .addTxFtEvent({
        asset_identifier: 'SP2H8PY27SEZ03MWRKS5XABZYQN17ETGQS3527SA5.miamicoin-token::miamicoin',
        asset_event_type_id: DbAssetEventTypeId.Mint,
        amount: 500n,
        recipient: addr1
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

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
