import supertest from 'supertest';
import { DbAssetEventTypeId } from '../../../src/datastore/common.ts';
import { startApiServer, ApiServer } from '../../../src/api/init.ts';
import { microStxToStx, STACKS_DECIMAL_PLACES } from '../../../src/helpers.ts';
import { FEE_RATE } from '../../../src/api/routes/v1/fee-rate.ts';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { getPagingQueryLimit, ResourceType } from '../../../src/api/pagination.ts';
import { migrate } from '../../test-helpers.ts';
import { TestBlockBuilder } from '../test-builders.ts';
import { hex } from '../test-helpers.ts';
import { beforeEach, afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { STACKS_TESTNET } from '@stacks/network';

describe('other tests', () => {
  let db: PgWriteStore;
  let api: ApiServer;

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    api = await startApiServer({ datastore: db, chainId: STACKS_TESTNET.chainId });
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await migrate('down');
  });

  test('stx-supply', async () => {
    const stxMintAmount1 = 230_000_000_000_000n;
    const stxMintAmount2 = 5_000_000_000_000n;
    await db.update(
      new TestBlockBuilder({
        block_height: 1,
        index_block_hash: hex(1),
        parent_index_block_hash: hex(0),
      })
        .addTx({ tx_id: hex(0x11) })
        .addTxStxEvent({ asset_event_type_id: DbAssetEventTypeId.Mint, amount: stxMintAmount1 })
        .addTxStxEvent({ asset_event_type_id: DbAssetEventTypeId.Mint, amount: stxMintAmount2 })
        .build()
    );

    const result1 = await supertest(api.server).get(`/extended/v1/stx_supply`);
    assert.equal(result1.status, 200);
    assert.equal(result1.type, 'application/json');
    const expectedResp1 = {
      unlocked_percent: '100.00',
      total_stx: '235000000.000000',
      total_stx_year_2050: '2318000000.000000',
      unlocked_stx: '235000000.000000',
      block_height: 1,
    };

    assert.deepEqual(JSON.parse(result1.text), expectedResp1);

    // ensure burned STX reduce the unlocked stx supply
    const stxBurnAmount = 10_000_000_000_000n;
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        index_block_hash: hex(2),
        parent_index_block_hash: hex(1),
      })
        .addTx({ tx_id: hex(0x22) })
        .addTxStxEvent({ asset_event_type_id: DbAssetEventTypeId.Burn, amount: stxBurnAmount })
        .build()
    );
    const expectedTotalStx2 = stxMintAmount1 + stxMintAmount2 - stxBurnAmount;
    const result2 = await supertest(api.server).get(`/extended/v1/stx_supply`);
    assert.equal(result2.status, 200);
    assert.equal(result2.type, 'application/json');
    const expectedResp2 = {
      unlocked_percent: '100.00',
      total_stx: microStxToStx(expectedTotalStx2),
      unlocked_stx: microStxToStx(expectedTotalStx2),
      total_stx_year_2050: '2318000000.000000',
      block_height: 2,
    };
    assert.deepEqual(JSON.parse(result2.text), expectedResp2);

    // ensure matured miner coinbase rewards are included, but not tx fees
    const coinbaseAmount = 15_000_000_000_000n;
    await db.update(
      new TestBlockBuilder({
        block_height: 3,
        index_block_hash: hex(3),
        parent_index_block_hash: hex(2),
      })
        .addMinerReward({
          coinbase_amount: coinbaseAmount,
          tx_fees_anchored: 1_000_000_000_000n,
          tx_fees_streamed_confirmed: 2_000_000_000_000n,
          tx_fees_streamed_produced: 3_000_000_000_000n,
        })
        .build()
    );
    const expectedTotalStx3 = stxMintAmount1 + stxMintAmount2 - stxBurnAmount + coinbaseAmount;
    const result3 = await supertest(api.server).get(`/extended/v1/stx_supply`);
    assert.equal(result3.status, 200);
    assert.equal(result3.type, 'application/json');
    const expectedResp3 = {
      unlocked_percent: '100.00',
      total_stx: microStxToStx(expectedTotalStx3),
      total_stx_year_2050: '2318000000.000000',
      unlocked_stx: microStxToStx(expectedTotalStx3),
      block_height: 3,
    };
    assert.deepEqual(JSON.parse(result3.text), expectedResp3);

    // a height at the tip is served from the chain_tip counter
    const resultAtTip = await supertest(api.server).get(`/extended/v1/stx_supply?height=3`);
    assert.equal(resultAtTip.status, 200);
    assert.deepEqual(JSON.parse(resultAtTip.text), expectedResp3);

    // an earlier height still returns the historical supply
    const resultHistorical = await supertest(api.server).get(`/extended/v1/stx_supply?height=1`);
    assert.equal(resultHistorical.status, 200);
    assert.deepEqual(JSON.parse(resultHistorical.text), expectedResp1);
    assert.notEqual(JSON.parse(resultHistorical.text).total_stx, expectedResp3.total_stx);

    const result4 = await supertest(api.server).get(`/extended/v1/stx_supply/total/plain`);
    assert.equal(result4.status, 200);
    assert.equal(result4.type, 'text/plain');
    assert.deepEqual(result4.text, '240000000.000000');

    const result5 = await supertest(api.server).get(`/extended/v1/stx_supply/circulating/plain`);
    assert.equal(result5.status, 200);
    assert.equal(result5.type, 'text/plain');
    assert.deepEqual(result5.text, microStxToStx(expectedTotalStx3));

    // test legacy endpoint response formatting
    const result6 = await supertest(api.server).get(`/extended/v1/stx_supply/legacy_format`);
    assert.equal(result6.status, 200);
    assert.equal(result6.type, 'application/json');
    const expectedResp6 = {
      unlockedPercent: '100.00',
      totalStacks: microStxToStx(expectedTotalStx3),
      totalStacksFormatted: new Intl.NumberFormat('en', {
        minimumFractionDigits: STACKS_DECIMAL_PLACES,
      }).format(parseInt(microStxToStx(expectedTotalStx3))),
      unlockedSupply: microStxToStx(expectedTotalStx3),
      unlockedSupplyFormatted: new Intl.NumberFormat('en', {
        minimumFractionDigits: STACKS_DECIMAL_PLACES,
      }).format(parseInt(microStxToStx(expectedTotalStx3))),
      totalStacksYear2050: '2318000000.000000',
      totalStacksYear2050Formatted: '2,318,000,000.000000',
      blockHeight: '3',
    };
    assert.deepEqual(JSON.parse(result6.text), expectedResp6);
  });

  test('Get fee rate', async () => {
    const request = {
      transaction: '0x5e9f3933e358df6a73fec0d47ce3e1062c20812c129f5294e6f37a8d27c051d9',
    };
    const result = await supertest(api.server).post('/extended/v1/fee_rate').send(request);
    assert.equal(result.status, 200);
    assert.equal(result.type, 'application/json');
    assert.equal(result.body.fee_rate, FEE_RATE);
  });

  test('400 response errors', async () => {
    const tx_id = '0x8407751d1a8d11ee986aca32a6459d9cd798283a12e048ebafcd4cc7dadb29a';
    const block_hash = '0xd10ccecfd7ac9e5f8a10de0532fac028559b31a6ff494d82147f6297fb66313';
    const principal_addr = 'S.hello-world';
    const odd_tx_error = {
      message: `Hex string is an odd number of digits`,
    };
    const odd_block_error = {
      message: `Hex string is an odd number of digits`,
    };
    const metadata_error = {
      message: `querystring/include_metadata must be boolean`,
    };
    const principal_error = {
      message: 'invalid STX address "S.hello-world"',
    };
    const pagination_error = {
      message: `querystring/limit must be <= ${getPagingQueryLimit(ResourceType.Tx, 50)}`,
    };
    // extended/v1/tx
    const searchResult1 = await supertest(api.server).get(`/extended/v1/tx/${tx_id}`);
    assert.equal(JSON.parse(searchResult1.text).message, odd_tx_error.message);
    assert.equal(searchResult1.status, 400);
    const searchResult2 = await supertest(api.server).get(
      `/extended/v1/tx/multiple?tx_id=${tx_id}`
    );
    assert.equal(JSON.parse(searchResult2.text).message, odd_tx_error.message);
    assert.equal(searchResult2.status, 400);
    const searchResult3 = await supertest(api.server).get(`/extended/v1/tx/${tx_id}/raw`);
    assert.equal(JSON.parse(searchResult3.text).message, odd_tx_error.message);
    assert.equal(searchResult3.status, 400);
    const searchResult4 = await supertest(api.server).get(`/extended/v1/tx/block/${block_hash}`);
    assert.equal(JSON.parse(searchResult4.text).message, odd_block_error.message);
    assert.equal(searchResult4.status, 400);

    // extended/v1/block
    const searchResult5 = await supertest(api.server).get(`/extended/v1/block/${block_hash}`);
    assert.equal(JSON.parse(searchResult5.text).message, odd_block_error.message);
    assert.equal(searchResult5.status, 400);

    // extended/v1/search
    const searchResult7 = await supertest(api.server).get(
      `/extended/v1/search/${block_hash}?include_metadata=bac`
    );
    assert.equal(JSON.parse(searchResult7.text).message, metadata_error.message);
    assert.equal(searchResult7.status, 400);

    // extended/v1/address
    const searchResult8 = await supertest(api.server).get(
      `/extended/v1/address/${principal_addr}/stx`
    );
    assert.equal(JSON.parse(searchResult8.text).message, principal_error.message);
    assert.equal(searchResult8.status, 400);

    // pagination queries
    const searchResult9 = await supertest(api.server).get(
      '/extended/v1/tx/mempool?limit=201&offset=2'
    );
    assert.equal(JSON.parse(searchResult9.text).message, pagination_error.message);
    assert.equal(searchResult9.status, 400);
  });

  test('active status', async () => {
    const result = await supertest(api.server).get(`/extended/`);
    assert.equal(result.body.status, 'ready');
  });

  test('database unavailable responses', async () => {
    // Close connection so we get an error.
    await db.close();
    const result = await supertest(api.server).get(`/extended/v1/block/`);
    assert.equal(result.body.error, 'The database service is unavailable');
  });
});
