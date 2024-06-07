import * as supertest from 'supertest';
import { ChainID, cvToHex, stringUtf8CV, uintCV } from '@stacks/transactions';
import { ApiServer, startApiServer } from '../api/init';
import { TestBlockBuilder } from '../test-utils/test-builders';
import { DbAssetEventTypeId } from '../datastore/common';
import { PgWriteStore } from '../datastore/pg-write-store';
import { migrate } from '../test-utils/test-helpers';
import nock = require('nock');

describe('/account tests', () => {
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
    await migrate('down')
  });

  test('/account/balance - returns ft balances', async () => {
    process.env.STACKS_API_ENABLE_FT_METADATA = '1';
    const addr1 = 'SP3WV3VC6GM1WF215SDHP0MESQ3BNXHB1N6TPB70S';
    const addr2 = 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y';

    const nodeUrl = `http://${process.env['STACKS_CORE_RPC_HOST']}:${process.env['STACKS_CORE_RPC_PORT']}`;
    nock(nodeUrl)
      .persist()
      .post('/v2/contracts/call-read/SP2H8PY27SEZ03MWRKS5XABZYQN17ETGQS3527SA5/newyorkcitycoin-token/get-decimals')
      .reply(200, {
        okay: true,
        result: cvToHex(uintCV(0)),
      });
    nock(nodeUrl)
      .persist()
      .post('/v2/contracts/call-read/SP2H8PY27SEZ03MWRKS5XABZYQN17ETGQS3527SA5/newyorkcitycoin-token/get-symbol')
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

    const expectedBalance = [
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
    ];
    const query1 = await supertest(api.server)
      .post(`/rosetta/v1/account/balance`)
      .send({
        network_identifier: { blockchain: 'stacks', network: 'testnet' },
        block_identifier: { index: 2, hash: '0xf1f1' },
        account_identifier: { address: addr2 },
      });
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');
    expect(JSON.parse(query1.text).balances).toEqual(expectedBalance);

    // ensure query works with block identifier omitted
    const query2 = await supertest(api.server)
      .post(`/rosetta/v1/account/balance`)
      .send({
        network_identifier: { blockchain: 'stacks', network: 'testnet' },
        account_identifier: { address: addr2 },
      });
    expect(query2.status).toBe(200);
    expect(query2.type).toBe('application/json');
    expect(JSON.parse(query2.text).balances).toEqual(expectedBalance);

    nock.cleanAll();
  });

});
