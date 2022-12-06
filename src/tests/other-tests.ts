import * as supertest from 'supertest';
import { ChainID } from '@stacks/transactions';
import {
  DbBlock,
  DbTxRaw,
  DbTxTypeId,
  DbStxEvent,
  DbEventTypeId,
  DbAssetEventTypeId,
  DbMinerReward,
} from '../datastore/common';
import { startApiServer, ApiServer } from '../api/init';
import { bufferToHexPrefixString, I32_MAX, microStxToStx, STACKS_DECIMAL_PLACES } from '../helpers';
import { FEE_RATE } from '../api/routes/fee-rate';
import { FeeRateRequest } from 'docs/generated';
import { PgWriteStore } from '../datastore/pg-write-store';
import { cycleMigrations, runMigrations } from '../datastore/migrations';
import { PgSqlClient } from '../datastore/connection';

describe('other tests', () => {
  let db: PgWriteStore;
  let client: PgSqlClient;
  let api: ApiServer;

  beforeEach(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    client = db.sql;
    api = await startApiServer({ datastore: db, chainId: ChainID.Testnet, httpLogLevel: 'silly' });
  });

  test('stx-supply', async () => {
    const testAddr1 = 'testAddr1';
    const dbBlock1: DbBlock = {
      block_hash: '0x0123',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      burn_block_time: 39486,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    const tx: DbTxRaw = {
      tx_id: '0x1234',
      tx_index: 4,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '',
      index_block_hash: dbBlock1.index_block_hash,
      block_hash: dbBlock1.block_hash,
      block_height: dbBlock1.block_height,
      burn_block_time: dbBlock1.burn_block_time,
      parent_burn_block_time: 0,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: bufferToHexPrefixString(Buffer.from('coinbase hi')),
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
      parent_index_block_hash: '',
      parent_block_hash: '',
      post_conditions: '0x01f5',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: testAddr1,
      origin_hash_mode: 1,
      event_count: 5,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    const stxMintEvent1: DbStxEvent = {
      event_index: 0,
      tx_id: tx.tx_id,
      tx_index: tx.tx_index,
      block_height: tx.block_height,
      canonical: true,
      asset_event_type_id: DbAssetEventTypeId.Mint,
      recipient: tx.sender_address,
      event_type: DbEventTypeId.StxAsset,
      amount: 230_000_000_000_000n,
    };
    const stxMintEvent2: DbStxEvent = {
      ...stxMintEvent1,
      amount: 5_000_000_000_000n,
    };
    await db.update({
      block: dbBlock1,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: tx,
          stxEvents: [stxMintEvent1, stxMintEvent2],
          stxLockEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          names: [],
          namespaces: [],
          smartContracts: [],
        },
      ],
    });

    const expectedTotalStx1 = stxMintEvent1.amount + stxMintEvent2.amount;
    const result1 = await supertest(api.server).get(`/extended/v1/stx_supply`);
    expect(result1.status).toBe(200);
    expect(result1.type).toBe('application/json');
    const expectedResp1 = {
      unlocked_percent: '17.38',
      total_stx: '1352464600.000000',
      unlocked_stx: microStxToStx(expectedTotalStx1),
      block_height: dbBlock1.block_height,
    };
    expect(JSON.parse(result1.text)).toEqual(expectedResp1);

    // ensure burned STX reduce the unlocked stx supply
    const stxBurnEvent1: DbStxEvent = {
      event_index: 0,
      tx_id: tx.tx_id,
      tx_index: tx.tx_index,
      block_height: tx.block_height,
      canonical: true,
      asset_event_type_id: DbAssetEventTypeId.Burn,
      sender: tx.sender_address,
      event_type: DbEventTypeId.StxAsset,
      amount: 10_000_000_000_000n,
    };
    await db.updateStxEvent(client, tx, stxBurnEvent1);
    const expectedTotalStx2 = stxMintEvent1.amount + stxMintEvent2.amount - stxBurnEvent1.amount;
    const result2 = await supertest(api.server).get(`/extended/v1/stx_supply`);
    expect(result2.status).toBe(200);
    expect(result2.type).toBe('application/json');
    const expectedResp2 = {
      unlocked_percent: '16.64',
      total_stx: '1352464600.000000',
      unlocked_stx: microStxToStx(expectedTotalStx2),
      block_height: dbBlock1.block_height,
    };
    expect(JSON.parse(result2.text)).toEqual(expectedResp2);

    // ensure miner coinbase rewards are included
    const minerReward1: DbMinerReward = {
      block_hash: dbBlock1.block_hash,
      index_block_hash: dbBlock1.index_block_hash,
      from_index_block_hash: dbBlock1.index_block_hash,
      mature_block_height: dbBlock1.block_height,
      canonical: true,
      recipient: testAddr1,
      coinbase_amount: 15_000_000_000_000n,
      tx_fees_anchored: 1_000_000_000_000n,
      tx_fees_streamed_confirmed: 2_000_000_000_000n,
      tx_fees_streamed_produced: 3_000_000_000_000n,
    };
    await db.updateMinerReward(client, minerReward1);
    const expectedTotalStx3 =
      stxMintEvent1.amount +
      stxMintEvent2.amount -
      stxBurnEvent1.amount +
      minerReward1.coinbase_amount;
    const result3 = await supertest(api.server).get(`/extended/v1/stx_supply`);
    expect(result3.status).toBe(200);
    expect(result3.type).toBe('application/json');
    const expectedResp3 = {
      unlocked_percent: '17.75',
      total_stx: '1352464600.000000',
      unlocked_stx: microStxToStx(expectedTotalStx3),
      block_height: dbBlock1.block_height,
    };
    expect(JSON.parse(result3.text)).toEqual(expectedResp3);

    const result4 = await supertest(api.server).get(`/extended/v1/stx_supply/total/plain`);
    expect(result4.status).toBe(200);
    expect(result4.type).toBe('text/plain');
    expect(result4.text).toEqual('1352464600.000000');

    const result5 = await supertest(api.server).get(`/extended/v1/stx_supply/circulating/plain`);
    expect(result5.status).toBe(200);
    expect(result5.type).toBe('text/plain');
    expect(result5.text).toEqual(microStxToStx(expectedTotalStx3));

    // test legacy endpoint response formatting
    const result6 = await supertest(api.server).get(`/extended/v1/stx_supply/legacy_format`);
    expect(result6.status).toBe(200);
    expect(result6.type).toBe('application/json');
    const expectedResp6 = {
      unlockedPercent: '17.75',
      totalStacks: '1352464600.000000',
      totalStacksFormatted: '1,352,464,600.000000',
      unlockedSupply: microStxToStx(expectedTotalStx3),
      unlockedSupplyFormatted: new Intl.NumberFormat('en', {
        minimumFractionDigits: STACKS_DECIMAL_PLACES,
      }).format(parseInt(microStxToStx(expectedTotalStx3))),
      blockHeight: dbBlock1.block_height.toString(),
    };
    expect(JSON.parse(result6.text)).toEqual(expectedResp6);
  });

  test('Get fee rate', async () => {
    const request: FeeRateRequest = {
      transaction: '0x5e9f3933e358df6a73fec0d47ce3e1062c20812c129f5294e6f37a8d27c051d9',
    };
    const result = await supertest(api.server).post('/extended/v1/fee_rate').send(request);
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
    expect(result.body.fee_rate).toBe(FEE_RATE);
  });

  test('400 response errors', async () => {
    const tx_id = '0x8407751d1a8d11ee986aca32a6459d9cd798283a12e048ebafcd4cc7dadb29a';
    const block_hash = '0xd10ccecfd7ac9e5f8a10de0532fac028559b31a6ff494d82147f6297fb66313';
    const principal_addr = 'S.hello-world';
    const odd_tx_error = {
      error: `Hex string is an odd number of digits: ${tx_id}`,
    };
    const odd_block_error = {
      error: `Hex string is an odd number of digits: ${block_hash}`,
    };
    const metadata_error = { error: `Unexpected value for 'include_metadata' parameter: "bac"` };
    const principal_error = { error: 'invalid STX address "S.hello-world"' };
    const pagination_error = { error: '`limit` must be equal to or less than 200' };
    // extended/v1/tx
    const searchResult1 = await supertest(api.server).get(`/extended/v1/tx/${tx_id}`);
    expect(JSON.parse(searchResult1.text)).toEqual(odd_tx_error);
    expect(searchResult1.status).toBe(400);
    const searchResult2 = await supertest(api.server).get(
      `/extended/v1/tx/multiple?tx_id=${tx_id}`
    );
    expect(JSON.parse(searchResult2.text)).toEqual(odd_tx_error);
    expect(searchResult2.status).toBe(400);
    const searchResult3 = await supertest(api.server).get(`/extended/v1/tx/${tx_id}/raw`);
    expect(JSON.parse(searchResult3.text)).toEqual(odd_tx_error);
    expect(searchResult3.status).toBe(400);
    const searchResult4 = await supertest(api.server).get(`/extended/v1/tx/block/${block_hash}`);
    expect(JSON.parse(searchResult4.text)).toEqual(odd_block_error);
    expect(searchResult4.status).toBe(400);

    // extended/v1/block
    const searchResult5 = await supertest(api.server).get(`/extended/v1/block/${block_hash}`);
    expect(JSON.parse(searchResult5.text)).toEqual(odd_block_error);
    expect(searchResult5.status).toBe(400);

    // extended/v1/microblock
    const searchResult6 = await supertest(api.server).get(`/extended/v1/microblock/${block_hash}`);
    expect(JSON.parse(searchResult6.text)).toEqual(odd_block_error);
    expect(searchResult6.status).toBe(400);

    // extended/v1/search
    const searchResult7 = await supertest(api.server).get(
      `/extended/v1/search/${block_hash}?include_metadata=bac`
    );
    expect(JSON.parse(searchResult7.text)).toEqual(metadata_error);
    expect(searchResult7.status).toBe(400);

    // extended/v1/address
    const searchResult8 = await supertest(api.server).get(
      `/extended/v1/address/${principal_addr}/stx`
    );
    expect(JSON.parse(searchResult8.text)).toEqual(principal_error);
    expect(searchResult8.status).toBe(400);

    // pagination queries
    const searchResult9 = await supertest(api.server).get(
      '/extended/v1/tx/mempool?limit=201&offset=2'
    );
    expect(JSON.parse(searchResult9.text)).toEqual(pagination_error);
    expect(searchResult9.status).toBe(400);
  });

  test('active status', async () => {
    const result = await supertest(api.server).get(`/extended/v1/status/`);
    expect(result.body.status).toBe('ready');
  });

  test('database unavailable responses', async () => {
    // Close connection so we get an error.
    await db.close();
    const result = await supertest(api.server).get(`/extended/v1/block/`);
    expect(result.body.error).toBe('The database service is unavailable');
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
