import * as supertest from 'supertest';
import { ChainID } from '@stacks/transactions';
import { PoolClient } from 'pg';
import { ApiServer, startApiServer } from '../api/init';
import { TestBlockBuilder } from '../test-utils/test-builders';
import { DbAssetEventTypeId, DbFungibleTokenMetadata } from '../datastore/common';
import { PgWriteStore } from '../datastore/pg-write-store';
import { cycleMigrations, runMigrations } from '../datastore/migrations';

describe('/account tests', () => {
  let db: PgWriteStore;
  let api: ApiServer;

  beforeEach(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgWriteStore.connect({ usageName: 'tests' });
    api = await startApiServer({ datastore: db, chainId: ChainID.Testnet });
  });

  test('/account/balance - returns ft balances', async () => {
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
      .addTxStxEvent({
        amount: 1200n,
        sender: addr1,
        recipient: addr2
      })
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
      .post(`/rosetta/v1/account/balance`)
      .send({
        network_identifier: { blockchain: 'stacks', network: 'testnet' },
        block_identifier: { index: 2, hash: '0xf1f1' },
        account_identifier: { address: addr2 },
      });
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');
    const result1 = JSON.parse(query1.text);
    expect(result1.balances).toEqual([
      {
        currency: {
          decimals: 6,
          symbol: 'STX'
        },
        value: '1200'
      },
      {
        currency: {
          decimals: 0,
          symbol: 'NYC'
        },
        value: '7500'
      }
    ]);
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
