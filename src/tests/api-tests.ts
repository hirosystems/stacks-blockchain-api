import * as supertest from 'supertest';
import {
  makeContractCall,
  NonFungibleConditionCode,
  FungibleConditionCode,
  bufferCVFromString,
  ClarityAbi,
  ClarityType,
  makeContractDeploy,
  serializeCV,
  sponsorTransaction,
} from '@blockstack/stacks-transactions';
import {
  createNonFungiblePostCondition,
  createFungiblePostCondition,
  createSTXPostCondition,
} from '@blockstack/stacks-transactions/lib/postcondition';
import * as BN from 'bn.js';
import { readTransaction } from '../p2p/tx';
import { BufferReader } from '../binary-reader';
import { getTxFromDataStore, getBlockFromDataStore } from '../api/controllers/db-controller';
import {
  createDbTxFromCoreMsg,
  DbBlock,
  DbTx,
  DbTxTypeId,
  DbStxEvent,
  DbEventTypeId,
  DbAssetEventTypeId,
  DbFtEvent,
  DbNftEvent,
  DbMempoolTx,
  DbSmartContract,
  DbSmartContractEvent,
  DbTxStatus,
} from '../datastore/common';
import { startApiServer, ApiServer } from '../api/init';
import { PgDataStore, cycleMigrations, runMigrations } from '../datastore/postgres-store';
import { PoolClient } from 'pg';

describe('api tests', () => {
  let db: PgDataStore;
  let client: PoolClient;
  let api: ApiServer;

  beforeEach(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgDataStore.connect();
    client = await db.pool.connect();
    api = await startApiServer(db, new Map());
  });

  test('fetch mempool-tx', async () => {
    const mempoolTx: DbMempoolTx = {
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
      raw_tx: Buffer.from('test-raw-tx'),
      type_id: DbTxTypeId.Coinbase,
      status: DbTxStatus.Pending,
      receipt_time: 1594307695,
      coinbase_payload: Buffer.from('coinbase hi'),
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: BigInt(1234),
      sponsored: false,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
    };
    await db.updateMempoolTx({ mempoolTx });

    const searchResult1 = await supertest(api.server).get(`/extended/v1/tx/${mempoolTx.tx_id}`);
    expect(searchResult1.status).toBe(200);
    expect(searchResult1.type).toBe('application/json');
    const expectedResp1 = {
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
      tx_status: 'pending',
      tx_type: 'coinbase',
      fee_rate: '1234',
      sender_address: 'sender-addr',
      sponsored: false,
      post_condition_mode: 'allow',
      receipt_time: 1594307695,
      receipt_time_iso: '2020-07-09T15:14:55.000Z',
      coinbase_payload: { data: '0x636f696e62617365206869' },
    };

    expect(JSON.parse(searchResult1.text)).toEqual(expectedResp1);
  });

  test('fetch mempool-tx - sponsored', async () => {
    const mempoolTx: DbMempoolTx = {
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
      raw_tx: Buffer.from('test-raw-tx'),
      type_id: DbTxTypeId.Coinbase,
      status: DbTxStatus.Pending,
      receipt_time: 1594307695,
      coinbase_payload: Buffer.from('coinbase hi'),
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: BigInt(1234),
      sponsored: true,
      sender_address: 'sender-addr',
      sponsor_address: 'sponsor-addr',
      origin_hash_mode: 1,
    };
    await db.updateMempoolTx({ mempoolTx });

    const searchResult1 = await supertest(api.server).get(`/extended/v1/tx/${mempoolTx.tx_id}`);
    expect(searchResult1.status).toBe(200);
    expect(searchResult1.type).toBe('application/json');
    const expectedResp1 = {
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
      tx_status: 'pending',
      tx_type: 'coinbase',
      fee_rate: '1234',
      sender_address: 'sender-addr',
      sponsor_address: 'sponsor-addr',
      sponsored: true,
      post_condition_mode: 'allow',
      receipt_time: 1594307695,
      receipt_time_iso: '2020-07-09T15:14:55.000Z',
      coinbase_payload: { data: '0x636f696e62617365206869' },
    };

    expect(JSON.parse(searchResult1.text)).toEqual(expectedResp1);
  });

  test('fetch mempool-tx list', async () => {
    for (let i = 0; i < 10; i++) {
      const mempoolTx: DbMempoolTx = {
        tx_id: `0x891200000000000000000000000000000000000000000000000000000000000${i}`,
        raw_tx: Buffer.from('test-raw-tx'),
        type_id: DbTxTypeId.Coinbase,
        receipt_time: (new Date(`2020-07-09T15:14:0${i}Z`).getTime() / 1000) | 0,
        coinbase_payload: Buffer.from('coinbase hi'),
        status: 1,
        post_conditions: Buffer.from([0x01, 0xf5]),
        fee_rate: BigInt(1234),
        sponsored: false,
        sender_address: 'sender-addr',
        origin_hash_mode: 1,
      };
      await db.updateMempoolTx({ mempoolTx });
    }
    const searchResult1 = await supertest(api.server).get(
      '/extended/v1/tx/mempool?limit=3&offset=2'
    );
    expect(searchResult1.status).toBe(200);
    expect(searchResult1.type).toBe('application/json');
    const expectedResp1 = {
      limit: 3,
      offset: 2,
      total: 10,
      results: [
        {
          tx_id: '0x8912000000000000000000000000000000000000000000000000000000000007',
          tx_status: 'success',
          tx_type: 'coinbase',
          receipt_time: 1594307647,
          receipt_time_iso: '2020-07-09T15:14:07.000Z',
          fee_rate: '1234',
          sender_address: 'sender-addr',
          sponsored: false,
          post_condition_mode: 'allow',
          coinbase_payload: { data: '0x636f696e62617365206869' },
        },
        {
          tx_id: '0x8912000000000000000000000000000000000000000000000000000000000006',
          tx_status: 'success',
          tx_type: 'coinbase',
          receipt_time: 1594307646,
          receipt_time_iso: '2020-07-09T15:14:06.000Z',
          fee_rate: '1234',
          sender_address: 'sender-addr',
          sponsored: false,
          post_condition_mode: 'allow',
          coinbase_payload: { data: '0x636f696e62617365206869' },
        },
        {
          tx_id: '0x8912000000000000000000000000000000000000000000000000000000000005',
          tx_status: 'success',
          tx_type: 'coinbase',
          receipt_time: 1594307645,
          receipt_time_iso: '2020-07-09T15:14:05.000Z',
          fee_rate: '1234',
          sender_address: 'sender-addr',
          sponsored: false,
          post_condition_mode: 'allow',
          coinbase_payload: { data: '0x636f696e62617365206869' },
        },
      ],
    };
    expect(JSON.parse(searchResult1.text)).toEqual(expectedResp1);
  });

  test('search term - hash', async () => {
    const block: DbBlock = {
      block_hash: '0x1234000000000000000000000000000000000000000000000000000000000000',
      index_block_hash: '0xdeadbeef',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0xff0011',
      parent_microblock: '0x9876',
      block_height: 1235,
      burn_block_time: 94869286,
      canonical: true,
    };
    await db.updateBlock(client, block);
    const tx: DbTx = {
      tx_id: '0x4567000000000000000000000000000000000000000000000000000000000000',
      tx_index: 4,
      raw_tx: Buffer.alloc(0),
      index_block_hash: block.index_block_hash,
      block_hash: block.block_hash,
      block_height: 68456,
      burn_block_time: 2837565,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: Buffer.from('coinbase hi'),
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: BigInt(1234),
      sponsored: false,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
    };
    await db.updateTx(client, tx);

    const mempoolTx: DbMempoolTx = {
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
      raw_tx: Buffer.from('test-raw-tx'),
      type_id: DbTxTypeId.Coinbase,
      receipt_time: 123456,
      coinbase_payload: Buffer.from('coinbase hi'),
      status: 1,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: BigInt(1234),
      sponsored: false,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
    };
    await db.updateMempoolTx({ mempoolTx });

    const searchResult1 = await supertest(api.server).get(
      `/extended/v1/search/0x1234000000000000000000000000000000000000000000000000000000000000`
    );
    expect(searchResult1.status).toBe(200);
    expect(searchResult1.type).toBe('application/json');
    const expectedResp1 = {
      found: true,
      result: {
        entity_id: '0x1234000000000000000000000000000000000000000000000000000000000000',
        entity_type: 'block_hash',
        block_data: {
          canonical: true,
          hash: '0x1234000000000000000000000000000000000000000000000000000000000000',
          parent_block_hash: '0xff0011',
          burn_block_time: 94869286,
          height: 1235,
        },
      },
    };
    expect(JSON.parse(searchResult1.text)).toEqual(expectedResp1);

    // test without 0x-prefix
    const searchResult2 = await supertest(api.server).get(
      `/extended/v1/search/1234000000000000000000000000000000000000000000000000000000000000`
    );
    expect(searchResult2.status).toBe(200);
    expect(searchResult2.type).toBe('application/json');
    const expectedResp2 = {
      found: true,
      result: {
        entity_id: '0x1234000000000000000000000000000000000000000000000000000000000000',
        entity_type: 'block_hash',
        block_data: {
          canonical: true,
          hash: '0x1234000000000000000000000000000000000000000000000000000000000000',
          parent_block_hash: '0xff0011',
          burn_block_time: 94869286,
          height: 1235,
        },
      },
    };
    expect(JSON.parse(searchResult2.text)).toEqual(expectedResp2);

    // test whitespace
    const searchResult3 = await supertest(api.server).get(
      `/extended/v1/search/ 1234000000000000000000000000000000000000000000000000000000000000 `
    );
    expect(searchResult3.status).toBe(200);
    expect(searchResult3.type).toBe('application/json');
    const expectedResp3 = {
      found: true,
      result: {
        entity_id: '0x1234000000000000000000000000000000000000000000000000000000000000',
        entity_type: 'block_hash',
        block_data: {
          canonical: true,
          hash: '0x1234000000000000000000000000000000000000000000000000000000000000',
          parent_block_hash: '0xff0011',
          burn_block_time: 94869286,
          height: 1235,
        },
      },
    };
    expect(JSON.parse(searchResult3.text)).toEqual(expectedResp3);

    // test tx search
    const searchResult4 = await supertest(api.server).get(
      `/extended/v1/search/0x4567000000000000000000000000000000000000000000000000000000000000`
    );
    expect(searchResult4.status).toBe(200);
    expect(searchResult4.type).toBe('application/json');
    const expectedResp4 = {
      found: true,
      result: {
        entity_id: '0x4567000000000000000000000000000000000000000000000000000000000000',
        entity_type: 'tx_id',
        tx_data: {
          canonical: true,
          block_hash: '0x1234000000000000000000000000000000000000000000000000000000000000',
          burn_block_time: 2837565,
          block_height: 68456,
          tx_type: 'coinbase',
        },
      },
    };
    expect(JSON.parse(searchResult4.text)).toEqual(expectedResp4);

    // test mempool tx search
    const searchResult5 = await supertest(api.server).get(
      `/extended/v1/search/0x8912000000000000000000000000000000000000000000000000000000000000`
    );
    expect(searchResult5.status).toBe(200);
    expect(searchResult5.type).toBe('application/json');
    const expectedResp5 = {
      found: true,
      result: {
        entity_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
        entity_type: 'mempool_tx_id',
        tx_data: { tx_type: 'coinbase' },
      },
    };
    expect(JSON.parse(searchResult5.text)).toEqual(expectedResp5);

    // test hash not found
    const searchResult6 = await supertest(api.server).get(
      `/extended/v1/search/0x1111000000000000000000000000000000000000000000000000000000000000`
    );
    expect(searchResult6.status).toBe(404);
    expect(searchResult6.type).toBe('application/json');
    const expectedResp6 = {
      found: false,
      result: { entity_type: 'unknown_hash' },
      error:
        'No block or transaction found with hash "0x1111000000000000000000000000000000000000000000000000000000000000"',
    };
    expect(JSON.parse(searchResult6.text)).toEqual(expectedResp6);

    // test invalid hash hex
    const invalidHex = '0x1111w00000000000000000000000000000000000000000000000000000000000';
    const searchResult7 = await supertest(api.server).get(`/extended/v1/search/${invalidHex}`);
    expect(searchResult7.status).toBe(404);
    expect(searchResult7.type).toBe('application/json');
    const expectedResp7 = {
      found: false,
      result: { entity_type: 'invalid_term' },
      error:
        'The term "0x1111w00000000000000000000000000000000000000000000000000000000000" is not a valid block hash, transaction ID, contract principal, or account address principal',
    };
    expect(JSON.parse(searchResult7.text)).toEqual(expectedResp7);
  });

  test('search term - principal', async () => {
    const addr1 = 'ST3J8EVYHVKH6XXPD61EE8XEHW4Y2K83861225AB1';
    const addr2 = 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4';
    const addr3 = 'ST37VASHEJRMFRS91GWK1HZZKKEYQTEP85ARXCQPH';
    const addr4 = 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C';
    const addr5 = 'ST3YKTGBCY1BNKN6J18A3QKAX7CE36SZH3A5XN9ZQ';
    const addr6 = 'SZ2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKQ9H6DPR';
    const addr7 = 'SM2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKQVX8X0G';
    const addr8 = 'ST3AMFNNS7KBQ28ECMJMN2G3AGJ37SSA2HSY82CMH';
    const addr9 = 'STAR26VJ4BC24SMNKRY533MAM0K3JA5ZJDVBD45A';
    const addr10 = 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6';
    const addr11 = 'ST3R34339DRYJ7V6E4Y78P9ZQYRJ7D68SG2RYDEEX';
    const addr12 = 'STG087YK10C83YJVPGSVZA7276A9REH656HCAKPT';
    const addr13 = 'ST2WVE3HKMQ7YQ6QMRDM8QE6S9G9CG9JNXD0A4P8W';
    const contractAddr1 = 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world';
    const contractAddr2 = 'STSPS4JYDEYCPPCSHE3MM2NCEGR07KPBETNEZCBQ.contract-name';
    const contractAddr3 = 'STSPS4JYDEYCPPCSHE3MM2NCEGR07KPBETNEZCBQ.test-contract';

    const stxTx1: DbTx = {
      tx_id: '0x1111000000000000000000000000000000000000000000000000000000000000',
      tx_index: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: '0x5432',
      block_hash: '0x9876',
      block_height: 68456,
      burn_block_time: 2837565,
      type_id: DbTxTypeId.TokenTransfer,
      token_transfer_amount: BigInt(1),
      token_transfer_memo: Buffer.from('hi'),
      token_transfer_recipient_address: 'none',
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: BigInt(1234),
      sponsored: false,
      sender_address: addr1,
      origin_hash_mode: 1,
    };
    await db.updateTx(client, stxTx1);

    // test address as a tx sender
    const searchResult1 = await supertest(api.server).get(`/extended/v1/search/${addr1}`);
    expect(searchResult1.status).toBe(200);
    expect(searchResult1.type).toBe('application/json');
    const expectedResp1 = {
      found: true,
      result: {
        entity_type: 'standard_address',
        entity_id: addr1,
      },
    };
    expect(JSON.parse(searchResult1.text)).toEqual(expectedResp1);

    const stxTx2: DbTx = {
      tx_id: '0x2222000000000000000000000000000000000000000000000000000000000000',
      tx_index: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: '0x5432',
      block_hash: '0x9876',
      block_height: 68456,
      burn_block_time: 2837565,
      type_id: DbTxTypeId.TokenTransfer,
      token_transfer_amount: BigInt(1),
      token_transfer_memo: Buffer.from('hi'),
      token_transfer_recipient_address: addr2,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: BigInt(1234),
      sponsored: false,
      sender_address: 'none',
      origin_hash_mode: 1,
    };
    await db.updateTx(client, stxTx2);

    // test address as a stx tx recipient
    const searchResult2 = await supertest(api.server).get(`/extended/v1/search/${addr2}`);
    expect(searchResult2.status).toBe(200);
    expect(searchResult2.type).toBe('application/json');
    const expectedResp2 = {
      found: true,
      result: {
        entity_type: 'standard_address',
        entity_id: addr2,
      },
    };
    expect(JSON.parse(searchResult2.text)).toEqual(expectedResp2);

    const stxEvent1: DbStxEvent = {
      canonical: true,
      event_type: DbEventTypeId.StxAsset,
      asset_event_type_id: DbAssetEventTypeId.Transfer,
      event_index: 0,
      tx_id: '0x1111000000000000000000000000000000000000000000000000000000000000',
      tx_index: 1,
      block_height: 1,
      amount: BigInt(1),
      recipient: addr3,
      sender: 'none',
    };
    await db.updateStxEvent(client, stxTx1, stxEvent1);

    // test address as a stx event recipient
    const searchResult3 = await supertest(api.server).get(`/extended/v1/search/${addr3}`);
    expect(searchResult3.status).toBe(200);
    expect(searchResult3.type).toBe('application/json');
    const expectedResp3 = {
      found: true,
      result: {
        entity_type: 'standard_address',
        entity_id: addr3,
      },
    };
    expect(JSON.parse(searchResult3.text)).toEqual(expectedResp3);

    const stxEvent2: DbStxEvent = {
      canonical: true,
      event_type: DbEventTypeId.StxAsset,
      asset_event_type_id: DbAssetEventTypeId.Transfer,
      event_index: 0,
      tx_id: '0x1111000000000000000000000000000000000000000000000000000000000000',
      tx_index: 1,
      block_height: 1,
      amount: BigInt(1),
      recipient: 'none',
      sender: addr4,
    };
    await db.updateStxEvent(client, stxTx1, stxEvent2);

    // test address as a stx event sender
    const searchResult4 = await supertest(api.server).get(`/extended/v1/search/${addr4}`);
    expect(searchResult4.status).toBe(200);
    expect(searchResult4.type).toBe('application/json');
    const expectedResp4 = {
      found: true,
      result: {
        entity_type: 'standard_address',
        entity_id: addr4,
      },
    };
    expect(JSON.parse(searchResult4.text)).toEqual(expectedResp4);

    const ftEvent1: DbFtEvent = {
      canonical: true,
      event_type: DbEventTypeId.FungibleTokenAsset,
      asset_event_type_id: DbAssetEventTypeId.Transfer,
      event_index: 0,
      tx_id: '0x1111000000000000000000000000000000000000000000000000000000000000',
      tx_index: 1,
      block_height: 1,
      asset_identifier: 'some-asset',
      amount: BigInt(1),
      recipient: addr5,
      sender: 'none',
    };
    await db.updateFtEvent(client, stxTx1, ftEvent1);

    // test address as a ft event recipient
    const searchResult5 = await supertest(api.server).get(`/extended/v1/search/${addr5}`);
    expect(searchResult5.status).toBe(200);
    expect(searchResult5.type).toBe('application/json');
    const expectedResp5 = {
      found: true,
      result: {
        entity_type: 'standard_address',
        entity_id: addr5,
      },
    };
    expect(JSON.parse(searchResult5.text)).toEqual(expectedResp5);

    const ftEvent2: DbFtEvent = {
      canonical: true,
      event_type: DbEventTypeId.FungibleTokenAsset,
      asset_event_type_id: DbAssetEventTypeId.Transfer,
      event_index: 0,
      tx_id: '0x1111000000000000000000000000000000000000000000000000000000000000',
      tx_index: 1,
      block_height: 1,
      asset_identifier: 'some-asset',
      amount: BigInt(1),
      recipient: 'none',
      sender: addr6,
    };
    await db.updateFtEvent(client, stxTx1, ftEvent2);

    // test address as a ft event sender
    const searchResult6 = await supertest(api.server).get(`/extended/v1/search/${addr6}`);
    expect(searchResult6.status).toBe(200);
    expect(searchResult6.type).toBe('application/json');
    const expectedResp6 = {
      found: true,
      result: {
        entity_type: 'standard_address',
        entity_id: addr6,
      },
    };
    expect(JSON.parse(searchResult6.text)).toEqual(expectedResp6);

    const nftEvent1: DbNftEvent = {
      canonical: true,
      event_type: DbEventTypeId.NonFungibleTokenAsset,
      asset_event_type_id: DbAssetEventTypeId.Transfer,
      event_index: 0,
      tx_id: '0x1111000000000000000000000000000000000000000000000000000000000000',
      tx_index: 1,
      block_height: 1,
      asset_identifier: 'some-asset',
      value: Buffer.from([0]),
      recipient: addr7,
      sender: 'none',
    };
    await db.updateNftEvent(client, stxTx1, nftEvent1);

    // test address as a nft event recipient
    const searchResult7 = await supertest(api.server).get(`/extended/v1/search/${addr7}`);
    expect(searchResult7.status).toBe(200);
    expect(searchResult7.type).toBe('application/json');
    const expectedResp7 = {
      found: true,
      result: {
        entity_type: 'standard_address',
        entity_id: addr7,
      },
    };
    expect(JSON.parse(searchResult7.text)).toEqual(expectedResp7);

    const nftEvent2: DbNftEvent = {
      canonical: true,
      event_type: DbEventTypeId.NonFungibleTokenAsset,
      asset_event_type_id: DbAssetEventTypeId.Transfer,
      event_index: 0,
      tx_id: '0x1111000000000000000000000000000000000000000000000000000000000000',
      tx_index: 1,
      block_height: 1,
      asset_identifier: 'some-asset',
      value: Buffer.from([0]),
      recipient: 'none',
      sender: addr8,
    };
    await db.updateNftEvent(client, stxTx1, nftEvent2);

    // test address as a nft event sender
    const searchResult8 = await supertest(api.server).get(`/extended/v1/search/${addr8}`);
    expect(searchResult8.status).toBe(200);
    expect(searchResult8.type).toBe('application/json');
    const expectedResp8 = {
      found: true,
      result: {
        entity_type: 'standard_address',
        entity_id: addr8,
      },
    };
    expect(JSON.parse(searchResult8.text)).toEqual(expectedResp8);

    const smartContract: DbTx = {
      type_id: DbTxTypeId.SmartContract,
      tx_id: '0x1111880000000000000000000000000000000000000000000000000000000000',
      raw_tx: Buffer.alloc(0),
      canonical: true,
      smart_contract_contract_id: contractAddr1,
      smart_contract_source_code: '(some-src)',
      block_height: 1,
      tx_index: 0,
      index_block_hash: '0x543288',
      block_hash: '0x9876',
      burn_block_time: 2837565,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: BigInt(1234),
      sponsored: false,
      sender_address: 'none',
      origin_hash_mode: 1,
    };
    await db.updateTx(client, smartContract);

    // test contract address
    const searchResult9 = await supertest(api.server).get(`/extended/v1/search/${contractAddr1}`);
    expect(searchResult9.status).toBe(200);
    expect(searchResult9.type).toBe('application/json');
    const expectedResp9 = {
      found: true,
      result: {
        entity_id: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
        entity_type: 'contract_address',
        tx_data: {
          canonical: true,
          block_hash: '0x9876',
          burn_block_time: 2837565,
          block_height: 1,
          tx_type: 'smart_contract',
        },
      },
    };
    expect(JSON.parse(searchResult9.text)).toEqual(expectedResp9);

    const smartContractMempoolTx: DbMempoolTx = {
      type_id: DbTxTypeId.SmartContract,
      tx_id: '0x1111882200000000000000000000000000000000000000000000000000000000',
      raw_tx: Buffer.from('test-raw-tx'),
      receipt_time: 123456,
      smart_contract_contract_id: contractAddr2,
      smart_contract_source_code: '(some-src)',
      status: 1,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: BigInt(1234),
      sponsored: false,
      sender_address: 'none',
      origin_hash_mode: 1,
    };
    await db.updateMempoolTx({ mempoolTx: smartContractMempoolTx });

    // test contract address associated with mempool tx
    const searchResult10 = await supertest(api.server).get(`/extended/v1/search/${contractAddr2}`);
    expect(searchResult10.status).toBe(200);
    expect(searchResult10.type).toBe('application/json');
    const expectedResp10 = {
      found: true,
      result: {
        entity_id: 'STSPS4JYDEYCPPCSHE3MM2NCEGR07KPBETNEZCBQ.contract-name',
        entity_type: 'contract_address',
        tx_data: { tx_type: 'smart_contract' },
      },
    };
    expect(JSON.parse(searchResult10.text)).toEqual(expectedResp10);

    // test contract address not found
    const searchResult11 = await supertest(api.server).get(`/extended/v1/search/${contractAddr3}`);
    expect(searchResult11.status).toBe(404);
    expect(searchResult11.type).toBe('application/json');
    const expectedResp11 = {
      found: false,
      result: { entity_type: 'contract_address' },
      error:
        'No principal found with address "STSPS4JYDEYCPPCSHE3MM2NCEGR07KPBETNEZCBQ.test-contract"',
    };
    expect(JSON.parse(searchResult11.text)).toEqual(expectedResp11);

    // test standard address not found
    const searchResult12 = await supertest(api.server).get(`/extended/v1/search/${addr9}`);
    expect(searchResult12.status).toBe(404);
    expect(searchResult12.type).toBe('application/json');
    const expectedResp12 = {
      found: false,
      result: { entity_type: 'standard_address' },
      error: 'No principal found with address "STAR26VJ4BC24SMNKRY533MAM0K3JA5ZJDVBD45A"',
    };
    expect(JSON.parse(searchResult12.text)).toEqual(expectedResp12);

    // test invalid term
    const invalidTerm = 'bogus123';
    const searchResult13 = await supertest(api.server).get(`/extended/v1/search/${invalidTerm}`);
    expect(searchResult13.status).toBe(404);
    expect(searchResult13.type).toBe('application/json');
    const expectedResp13 = {
      found: false,
      result: { entity_type: 'invalid_term' },
      error:
        'The term "bogus123" is not a valid block hash, transaction ID, contract principal, or account address principal',
    };
    expect(JSON.parse(searchResult13.text)).toEqual(expectedResp13);
  });

  test('address info', async () => {
    const testAddr1 = 'ST3J8EVYHVKH6XXPD61EE8XEHW4Y2K83861225AB1';
    const testAddr2 = 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4';
    const testContractAddr = 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world';
    const testAddr4 = 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C';

    let indexIdIndex = 0;
    const createStxTx = (
      sender: string,
      recipient: string,
      amount: number,
      canonical: boolean = true
    ): DbTx => {
      const tx: DbTx = {
        tx_id: '0x1234' + (++indexIdIndex).toString().padStart(4, '0'),
        tx_index: indexIdIndex,
        raw_tx: Buffer.alloc(0),
        index_block_hash: '0x5432',
        block_hash: '0x9876',
        block_height: 68456,
        burn_block_time: 1594647994,
        type_id: DbTxTypeId.TokenTransfer,
        token_transfer_amount: BigInt(amount),
        token_transfer_memo: Buffer.from('hi'),
        token_transfer_recipient_address: recipient,
        status: 1,
        raw_result: '0x0100000000000000000000000000000001', // u1
        canonical,
        post_conditions: Buffer.from([0x01, 0xf5]),
        fee_rate: BigInt(1234),
        sponsored: false,
        sender_address: sender,
        origin_hash_mode: 1,
      };
      return tx;
    };

    const txs = [
      createStxTx(testAddr1, testAddr2, 100_000),
      createStxTx(testAddr2, testContractAddr, 100),
      createStxTx(testAddr2, testContractAddr, 250),
      createStxTx(testAddr2, testContractAddr, 40, false),
      createStxTx(testContractAddr, testAddr4, 15),
      createStxTx(testAddr2, testAddr4, 35),
    ];
    for (const tx of txs) {
      await db.updateTx(client, tx);
    }

    const tx: DbTx = {
      tx_id: '0x1234',
      tx_index: 4,
      raw_tx: Buffer.alloc(0),
      index_block_hash: '0x5432',
      block_hash: '0x9876',
      block_height: 68456,
      burn_block_time: 1594647994,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: Buffer.from('coinbase hi'),
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: BigInt(1234),
      sponsored: false,
      sender_address: testAddr1,
      origin_hash_mode: 1,
    };
    const createStxEvent = (
      sender: string,
      recipient: string,
      amount: number,
      canonical: boolean = true
    ): DbStxEvent => {
      const stxEvent: DbStxEvent = {
        canonical,
        event_type: DbEventTypeId.StxAsset,
        asset_event_type_id: DbAssetEventTypeId.Transfer,
        event_index: 0,
        tx_id: tx.tx_id,
        tx_index: tx.tx_index,
        block_height: tx.block_height,
        amount: BigInt(amount),
        recipient,
        sender,
      };
      return stxEvent;
    };
    const events = [
      createStxEvent(testAddr1, testAddr2, 100_000),
      createStxEvent(testAddr2, testContractAddr, 100),
      createStxEvent(testAddr2, testContractAddr, 1250),
      createStxEvent(testAddr2, testContractAddr, 40, false),
      createStxEvent(testContractAddr, testAddr4, 15),
      createStxEvent(testAddr2, testAddr4, 35),
    ];
    for (const event of events) {
      await db.updateStxEvent(client, tx, event);
    }

    const createFtEvent = (
      sender: string,
      recipient: string,
      assetId: string,
      amount: number,
      canonical: boolean = true
    ): DbFtEvent => {
      const ftEvent: DbFtEvent = {
        canonical,
        event_type: DbEventTypeId.FungibleTokenAsset,
        asset_event_type_id: DbAssetEventTypeId.Transfer,
        event_index: 0,
        tx_id: tx.tx_id,
        tx_index: tx.tx_index,
        block_height: tx.block_height,
        asset_identifier: assetId,
        amount: BigInt(amount),
        recipient,
        sender,
      };
      return ftEvent;
    };
    const ftEvents = [
      createFtEvent(testAddr1, testAddr2, 'bux', 100_000),
      createFtEvent(testAddr2, testContractAddr, 'bux', 100),
      createFtEvent(testAddr2, testContractAddr, 'bux', 250),
      createFtEvent(testAddr2, testContractAddr, 'bux', 40, false),
      createFtEvent(testContractAddr, testAddr4, 'bux', 15),
      createFtEvent(testAddr2, testAddr4, 'bux', 35),
      createFtEvent(testAddr1, testAddr2, 'gox', 200_000),
      createFtEvent(testAddr2, testContractAddr, 'gox', 200),
      createFtEvent(testAddr2, testContractAddr, 'gox', 350),
      createFtEvent(testAddr2, testContractAddr, 'gox', 60, false),
      createFtEvent(testContractAddr, testAddr4, 'gox', 25),
      createFtEvent(testAddr2, testAddr4, 'gox', 75),
      createFtEvent(testAddr1, testAddr2, 'cash', 500_000),
      createFtEvent(testAddr2, testAddr1, 'tendies', 1_000_000),
    ];
    for (const event of ftEvents) {
      await db.updateFtEvent(client, tx, event);
    }

    const createNFtEvents = (
      sender: string,
      recipient: string,
      assetId: string,
      count: number,
      canonical: boolean = true
    ): DbNftEvent[] => {
      const events: DbNftEvent[] = [];
      for (let i = 0; i < count; i++) {
        const nftEvent: DbNftEvent = {
          canonical,
          event_type: DbEventTypeId.NonFungibleTokenAsset,
          asset_event_type_id: DbAssetEventTypeId.Transfer,
          event_index: 0,
          tx_id: tx.tx_id,
          tx_index: tx.tx_index,
          block_height: tx.block_height,
          asset_identifier: assetId,
          value: Buffer.from([0]),
          recipient,
          sender,
        };
        events.push(nftEvent);
      }
      return events;
    };
    const nftEvents = [
      createNFtEvents(testAddr1, testAddr2, 'bux', 300),
      createNFtEvents(testAddr2, testContractAddr, 'bux', 10),
      createNFtEvents(testAddr2, testContractAddr, 'bux', 25),
      createNFtEvents(testAddr2, testContractAddr, 'bux', 4, false),
      createNFtEvents(testContractAddr, testAddr4, 'bux', 1),
      createNFtEvents(testAddr2, testAddr4, 'bux', 3),
      createNFtEvents(testAddr1, testAddr2, 'gox', 200),
      createNFtEvents(testAddr2, testContractAddr, 'gox', 20),
      createNFtEvents(testAddr2, testContractAddr, 'gox', 35),
      createNFtEvents(testAddr2, testContractAddr, 'gox', 6, false),
      createNFtEvents(testContractAddr, testAddr4, 'gox', 2),
      createNFtEvents(testAddr2, testAddr4, 'gox', 7),
      createNFtEvents(testAddr1, testAddr2, 'cash', 500),
      createNFtEvents(testAddr2, testAddr1, 'tendies', 100),
    ];
    for (const event of nftEvents.flat()) {
      await db.updateNftEvent(client, tx, event);
    }

    const fetchAddrBalance1 = await supertest(api.server).get(
      `/extended/v1/address/${testAddr2}/balances`
    );
    expect(fetchAddrBalance1.status).toBe(200);
    expect(fetchAddrBalance1.type).toBe('application/json');
    const expectedResp1 = {
      stx: { balance: '94913', total_sent: '1385', total_received: '100000' },
      fungible_tokens: {
        bux: { balance: '99615', total_sent: '385', total_received: '100000' },
        cash: { balance: '500000', total_sent: '0', total_received: '500000' },
        gox: { balance: '199375', total_sent: '625', total_received: '200000' },
        tendies: { balance: '-1000000', total_sent: '1000000', total_received: '0' },
      },
      non_fungible_tokens: {
        bux: { count: '262', total_sent: '38', total_received: '300' },
        cash: { count: '500', total_sent: '0', total_received: '500' },
        gox: { count: '138', total_sent: '62', total_received: '200' },
        tendies: { count: '-100', total_sent: '100', total_received: '0' },
      },
    };
    expect(JSON.parse(fetchAddrBalance1.text)).toEqual(expectedResp1);

    const fetchAddrBalance2 = await supertest(api.server).get(
      `/extended/v1/address/${testContractAddr}/balances`
    );
    expect(fetchAddrBalance2.status).toBe(200);
    expect(fetchAddrBalance2.type).toBe('application/json');
    const expectedResp2 = {
      stx: { balance: '101', total_sent: '15', total_received: '1350' },
      fungible_tokens: {
        bux: { balance: '335', total_sent: '15', total_received: '350' },
        gox: { balance: '525', total_sent: '25', total_received: '550' },
      },
      non_fungible_tokens: {
        bux: { count: '34', total_sent: '1', total_received: '35' },
        gox: { count: '53', total_sent: '2', total_received: '55' },
      },
    };
    expect(JSON.parse(fetchAddrBalance2.text)).toEqual(expectedResp2);

    const fetchAddrStxBalance1 = await supertest(api.server).get(
      `/extended/v1/address/${testContractAddr}/stx`
    );
    expect(fetchAddrStxBalance1.status).toBe(200);
    expect(fetchAddrStxBalance1.type).toBe('application/json');
    const expectedStxResp1 = { balance: '101', total_sent: '15', total_received: '1350' };
    expect(JSON.parse(fetchAddrStxBalance1.text)).toEqual(expectedStxResp1);

    const fetchAddrAssets1 = await supertest(api.server).get(
      `/extended/v1/address/${testContractAddr}/assets?limit=8&offset=2`
    );
    expect(fetchAddrAssets1.status).toBe(200);
    expect(fetchAddrAssets1.type).toBe('application/json');
    const expectedResp3 = {
      limit: 8,
      offset: 2,
      total: 0,
      results: [
        {
          event_index: 0,
          event_type: 'fungible_token_asset',
          asset: {
            asset_event_type: 'transfer',
            asset_id: 'bux',
            sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
            recipient: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
            amount: '100',
          },
        },
        {
          event_index: 0,
          event_type: 'fungible_token_asset',
          asset: {
            asset_event_type: 'transfer',
            asset_id: 'bux',
            sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
            recipient: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
            amount: '250',
          },
        },
        {
          event_index: 0,
          event_type: 'fungible_token_asset',
          asset: {
            asset_event_type: 'transfer',
            asset_id: 'bux',
            sender: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
            recipient: 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C',
            amount: '15',
          },
        },
        {
          event_index: 0,
          event_type: 'fungible_token_asset',
          asset: {
            asset_event_type: 'transfer',
            asset_id: 'gox',
            sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
            recipient: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
            amount: '200',
          },
        },
        {
          event_index: 0,
          event_type: 'fungible_token_asset',
          asset: {
            asset_event_type: 'transfer',
            asset_id: 'gox',
            sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
            recipient: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
            amount: '350',
          },
        },
        {
          event_index: 0,
          event_type: 'fungible_token_asset',
          asset: {
            asset_event_type: 'transfer',
            asset_id: 'gox',
            sender: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
            recipient: 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C',
            amount: '25',
          },
        },
        {
          event_index: 0,
          event_type: 'non_fungible_token_asset',
          asset: {
            asset_event_type: 'transfer',
            asset_id: 'bux',
            sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
            recipient: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
            value: { hex: '0x00', repr: '0' },
          },
        },
        {
          event_index: 0,
          event_type: 'stx_asset',
          asset: {
            asset_event_type: 'transfer',
            sender: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
            recipient: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
            amount: '100',
          },
        },
      ],
    };
    expect(JSON.parse(fetchAddrAssets1.text)).toEqual(expectedResp3);

    const fetchAddrTx1 = await supertest(api.server).get(
      `/extended/v1/address/${testContractAddr}/transactions`
    );
    expect(fetchAddrTx1.status).toBe(200);
    expect(fetchAddrTx1.type).toBe('application/json');
    const expectedResp4 = {
      limit: 20,
      offset: 0,
      total: 3,
      results: [
        {
          tx_id: '0x12340005',
          tx_status: 'success',
          tx_result: {
            hex: '0x0100000000000000000000000000000001', // u1
            repr: 'u1',
          },
          tx_type: 'token_transfer',
          fee_rate: '1234',
          sender_address: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
          sponsored: false,
          post_condition_mode: 'allow',
          block_hash: '0x9876',
          block_height: 68456,
          burn_block_time: 1594647994,
          burn_block_time_iso: '2020-07-13T13:46:34.000Z',
          canonical: true,
          tx_index: 5,
          token_transfer: {
            recipient_address: 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C',
            amount: '15',
            memo: '0x6869',
          },
          events: [],
        },
        {
          tx_id: '0x12340003',
          tx_status: 'success',
          tx_result: {
            hex: '0x0100000000000000000000000000000001', // u1
            repr: 'u1',
          },
          tx_type: 'token_transfer',
          fee_rate: '1234',
          sender_address: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
          sponsored: false,
          post_condition_mode: 'allow',
          block_hash: '0x9876',
          block_height: 68456,
          burn_block_time: 1594647994,
          burn_block_time_iso: '2020-07-13T13:46:34.000Z',
          canonical: true,
          tx_index: 3,
          token_transfer: {
            recipient_address: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
            amount: '250',
            memo: '0x6869',
          },
          events: [],
        },
        {
          tx_id: '0x12340002',
          tx_status: 'success',
          tx_result: {
            hex: '0x0100000000000000000000000000000001', // u1
            repr: 'u1',
          },
          tx_type: 'token_transfer',
          fee_rate: '1234',
          sender_address: 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4',
          sponsored: false,
          post_condition_mode: 'allow',
          block_hash: '0x9876',
          block_height: 68456,
          burn_block_time: 1594647994,
          burn_block_time_iso: '2020-07-13T13:46:34.000Z',
          canonical: true,
          tx_index: 2,
          token_transfer: {
            recipient_address: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
            amount: '100',
            memo: '0x6869',
          },
          events: [],
        },
      ],
    };
    expect(JSON.parse(fetchAddrTx1.text)).toEqual(expectedResp4);
  });

  test('list contract log events', async () => {
    const block1: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0xdeadbeef',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0xff0011',
      parent_microblock: '0x9876',
      block_height: 1,
      burn_block_time: 1594647996,
      canonical: true,
    };
    const tx1: DbTx = {
      tx_id: '0x421234',
      tx_index: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: '0x1234',
      block_hash: '0x5678',
      block_height: block1.block_height,
      burn_block_time: 1594647995,
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: Buffer.from([]),
      fee_rate: BigInt(1234),
      sponsored: false,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      coinbase_payload: Buffer.from('hi'),
    };
    const tx2: DbTx = {
      ...tx1,
      tx_id: '0x012345',
      tx_index: 1,
    };
    const contractLogEvent1: DbSmartContractEvent = {
      event_index: 4,
      tx_id: '0x421234',
      tx_index: 0,
      block_height: block1.block_height,
      canonical: true,
      event_type: DbEventTypeId.SmartContractLog,
      contract_identifier: 'some-contract-id',
      topic: 'some-topic',
      value: serializeCV(bufferCVFromString('some val')),
    };
    const smartContract1: DbSmartContract = {
      tx_id: '0x421234',
      canonical: true,
      block_height: block1.block_height,
      contract_id: 'some-contract-id',
      source_code: '(some-contract-src)',
      abi: '{"some-abi":1}',
    };
    await db.update({
      block: block1,
      txs: [
        {
          tx: tx1,
          stxEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [contractLogEvent1],
          smartContracts: [smartContract1],
        },
        {
          tx: tx2,
          stxEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          smartContracts: [],
        },
      ],
    });

    const fetchTx = await supertest(api.server).get(
      '/extended/v1/contract/some-contract-id/events'
    );
    expect(fetchTx.status).toBe(200);
    expect(fetchTx.type).toBe('application/json');
    expect(JSON.parse(fetchTx.text)).toEqual({
      limit: 20,
      offset: 0,
      results: [
        {
          event_index: 4,
          event_type: 'smart_contract_log',
          contract_log: {
            contract_id: 'some-contract-id',
            topic: 'some-topic',
            value: { hex: '0x0200000008736f6d652076616c', repr: '"some val"' },
          },
        },
      ],
    });
  });

  test('getTxList() returns object', async () => {
    const expectedResp = {
      limit: 96,
      offset: 0,
      results: [],
      total: 0,
    };
    const fetchTx = await supertest(api.server).get('/extended/v1/tx/');
    expect(fetchTx.status).toBe(200);
    expect(fetchTx.type).toBe('application/json');
    expect(JSON.parse(fetchTx.text)).toEqual(expectedResp);
  });

  test('block store and process', async () => {
    const block: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0xdeadbeef',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0xff0011',
      parent_microblock: '0x9876',
      block_height: 1235,
      burn_block_time: 1594647996,
      canonical: true,
    };
    await db.updateBlock(client, block);
    const tx: DbTx = {
      tx_id: '0x1234',
      tx_index: 4,
      raw_tx: Buffer.alloc(0),
      index_block_hash: block.index_block_hash,
      block_hash: block.block_hash,
      block_height: 68456,
      burn_block_time: 1594647995,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: Buffer.from('coinbase hi'),
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: Buffer.from([0x01, 0xf5]),
      fee_rate: BigInt(1234),
      sponsored: false,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
    };
    await db.updateTx(client, tx);

    const blockQuery = await getBlockFromDataStore(block.block_hash, db);
    if (!blockQuery.found) {
      throw new Error('block not found');
    }

    const expectedResp = {
      burn_block_time: 1594647996,
      burn_block_time_iso: '2020-07-13T13:46:36.000Z',
      canonical: true,
      hash: '0x1234',
      height: 1235,
      parent_block_hash: '0xff0011',
      txs: ['0x1234'],
    };

    expect(blockQuery.result).toEqual(expectedResp);

    const fetchTx = await supertest(api.server).get(`/extended/v1/block/${block.block_hash}`);
    expect(fetchTx.status).toBe(200);
    expect(fetchTx.type).toBe('application/json');
    expect(JSON.parse(fetchTx.text)).toEqual(expectedResp);
  });

  test('tx - sponsored', async () => {
    const txBuilder = await makeContractCall({
      contractAddress: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y',
      contractName: 'hello-world',
      functionName: 'fn-name',
      functionArgs: [{ type: ClarityType.Int, value: new BN(556) }],
      fee: new BN(200),
      senderKey: 'b8d99fd45da58038d630d9855d3ca2466e8e0f89d3894c4724f0efc9ff4b51f001',
      nonce: new BN(0),
      sponsored: true,
    });
    const sponsoredTx = await sponsorTransaction({
      transaction: txBuilder,
      sponsorPrivateKey: '381314da39a45f43f45ffd33b5d8767d1a38db0da71fea50ed9508e048765cf301',
      fee: new BN(300),
      sponsorNonce: new BN(2),
    });
    const serialized = sponsoredTx.serialize();
    const tx = readTransaction(new BufferReader(serialized));
    const dbTx = createDbTxFromCoreMsg({
      core_tx: {
        raw_tx: '0x' + serialized.toString('hex'),
        result: void 0,
        status: 'success',
        raw_result: '0x0100000000000000000000000000000001', // u1
        txid: '0x' + txBuilder.txid(),
        tx_index: 2,
        contract_abi: null,
      },
      raw_tx: Buffer.alloc(0),
      parsed_tx: tx,
      sender_address: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y',
      sponsor_address: 'SP2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7GB36ZAR0',
      index_block_hash: '0xaa',
      block_hash: '0xff',
      block_height: 123,
      burn_block_time: 1594647995,
    });
    await db.updateTx(client, dbTx);
    const contractAbi: ClarityAbi = {
      functions: [
        {
          name: 'fn-name',
          args: [{ name: 'arg1', type: 'int128' }],
          access: 'public',
          outputs: { type: 'bool' },
        },
      ],
      variables: [],
      maps: [],
      fungible_tokens: [],
      non_fungible_tokens: [],
    };
    await db.updateSmartContract(client, dbTx, {
      tx_id: dbTx.tx_id,
      canonical: true,
      contract_id: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y.hello-world',
      block_height: 123,
      source_code: '()',
      abi: JSON.stringify(contractAbi),
    });
    const txQuery = await getTxFromDataStore(dbTx.tx_id, db);
    expect(txQuery.found).toBe(true);
    if (!txQuery.found) {
      throw Error('not found');
    }

    const expectedResp = {
      block_hash: '0xff',
      block_height: 123,
      burn_block_time: 1594647995,
      burn_block_time_iso: '2020-07-13T13:46:35.000Z',
      canonical: true,
      tx_id: '0x4c4f690ffd560f64c991b387559c2587a084376296f83a64ba4e76f68d5fd956',
      tx_index: 2,
      tx_status: 'success',
      tx_result: {
        hex: '0x0100000000000000000000000000000001', // u1
        repr: 'u1',
      },
      tx_type: 'contract_call',
      fee_rate: '200',
      sender_address: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y',
      sponsor_address: 'SP2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7GB36ZAR0',
      sponsored: true,
      post_condition_mode: 'deny',
      post_conditions: [],
      contract_call: {
        contract_id: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y.hello-world',
        function_name: 'fn-name',
        function_signature: '(define-public (fn-name (arg1 int)))',
        function_args: [
          { hex: '0x000000000000000000000000000000022c', repr: '556', name: 'arg1', type: 'int' },
        ],
      },
      events: [],
    };
    expect(txQuery.result).toEqual(expectedResp);

    const fetchTx = await supertest(api.server).get(`/extended/v1/tx/${dbTx.tx_id}`);
    expect(fetchTx.status).toBe(200);
    expect(fetchTx.type).toBe('application/json');
    expect(JSON.parse(fetchTx.text)).toEqual(expectedResp);
  });

  test('tx store and processing', async () => {
    const pc1 = createNonFungiblePostCondition(
      'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR',
      NonFungibleConditionCode.Owns,
      'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP.hello::asset-name',
      bufferCVFromString('asset-value')
    );

    const pc2 = createFungiblePostCondition(
      'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR',
      FungibleConditionCode.GreaterEqual,
      new BN(123456),
      'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP.hello-ft::asset-name-ft'
    );

    const pc3 = createSTXPostCondition(
      'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR',
      FungibleConditionCode.LessEqual,
      new BN(36723458)
    );

    const txBuilder = await makeContractCall({
      contractAddress: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y',
      contractName: 'hello-world',
      functionName: 'fn-name',
      functionArgs: [{ type: ClarityType.Int, value: new BN(556) }],
      fee: new BN(200),
      senderKey: 'b8d99fd45da58038d630d9855d3ca2466e8e0f89d3894c4724f0efc9ff4b51f001',
      postConditions: [pc1, pc2, pc3],
      nonce: new BN(0),
    });
    const serialized = txBuilder.serialize();
    const tx = readTransaction(new BufferReader(serialized));
    const dbTx = createDbTxFromCoreMsg({
      core_tx: {
        raw_tx: '0x' + serialized.toString('hex'),
        result: void 0,
        status: 'success',
        raw_result: '0x0100000000000000000000000000000001', // u1
        txid: '0x' + txBuilder.txid(),
        tx_index: 2,
        contract_abi: null,
      },
      raw_tx: Buffer.alloc(0),
      parsed_tx: tx,
      sender_address: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y',
      index_block_hash: '0xaa',
      block_hash: '0xff',
      block_height: 123,
      burn_block_time: 1594647995,
    });
    await db.updateTx(client, dbTx);
    const contractAbi: ClarityAbi = {
      functions: [
        {
          name: 'fn-name',
          args: [{ name: 'arg1', type: 'int128' }],
          access: 'public',
          outputs: { type: 'bool' },
        },
      ],
      variables: [],
      maps: [],
      fungible_tokens: [],
      non_fungible_tokens: [],
    };
    await db.updateSmartContract(client, dbTx, {
      tx_id: dbTx.tx_id,
      canonical: true,
      contract_id: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y.hello-world',
      block_height: 123,
      source_code: '()',
      abi: JSON.stringify(contractAbi),
    });
    const txQuery = await getTxFromDataStore(dbTx.tx_id, db);
    expect(txQuery.found).toBe(true);
    if (!txQuery.found) {
      throw Error('not found');
    }

    const expectedResp = {
      block_hash: '0xff',
      block_height: 123,
      burn_block_time: 1594647995,
      burn_block_time_iso: '2020-07-13T13:46:35.000Z',
      canonical: true,
      tx_id: '0xc3e2fabaf7017fa2f6967db4f21be4540fdeae2d593af809c18a6adf369bfb03',
      tx_index: 2,
      tx_status: 'success',
      tx_result: {
        hex: '0x0100000000000000000000000000000001', // u1
        repr: 'u1',
      },
      tx_type: 'contract_call',
      fee_rate: '200',
      sender_address: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y',
      sponsored: false,
      post_condition_mode: 'deny',
      post_conditions: [
        {
          type: 'non_fungible',
          condition_code: 'not_sent',
          principal: {
            type_id: 'principal_standard',
            address: 'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR',
          },
          asset: {
            contract_name: 'hello',
            asset_name: 'asset-name',
            contract_address: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP',
          },
          asset_value: { hex: '0x020000000b61737365742d76616c7565', repr: '"asset-value"' },
        },
        {
          type: 'fungible',
          condition_code: 'sent_greater_than',
          amount: '123456',
          principal: {
            type_id: 'principal_standard',
            address: 'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR',
          },
          asset: {
            contract_name: 'hello-ft',
            asset_name: 'asset-name-ft',
            contract_address: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP',
          },
        },
        {
          type: 'stx',
          condition_code: 'sent_less_than',
          amount: '36723458',
          principal: {
            type_id: 'principal_standard',
            address: 'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR',
          },
        },
      ],
      contract_call: {
        contract_id: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y.hello-world',
        function_name: 'fn-name',
        function_signature: '(define-public (fn-name (arg1 int)))',
        function_args: [
          { hex: '0x000000000000000000000000000000022c', repr: '556', name: 'arg1', type: 'int' },
        ],
      },
      events: [],
    };
    expect(txQuery.result).toEqual(expectedResp);

    const fetchTx = await supertest(api.server).get(`/extended/v1/tx/${dbTx.tx_id}`);
    expect(fetchTx.status).toBe(200);
    expect(fetchTx.type).toBe('application/json');
    expect(JSON.parse(fetchTx.text)).toEqual(expectedResp);
  });

  test('tx store and processing - abort_by_response', async () => {
    const txBuilder = await makeContractDeploy({
      contractName: 'hello-world',
      codeBody: '()',
      fee: new BN(200),
      senderKey: 'b8d99fd45da58038d630d9855d3ca2466e8e0f89d3894c4724f0efc9ff4b51f001',
      postConditions: [],
    });
    const serialized = txBuilder.serialize();
    const tx = readTransaction(new BufferReader(serialized));
    const dbTx = createDbTxFromCoreMsg({
      core_tx: {
        raw_tx: '0x' + serialized.toString('hex'),
        raw_result: '0x0100000000000000000000000000000001', // u1
        result: void 0,
        status: 'abort_by_response',
        txid: '0x' + txBuilder.txid(),
        tx_index: 2,
        contract_abi: null,
      },
      raw_tx: Buffer.alloc(0),
      parsed_tx: tx,
      sender_address: 'SP2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7GB36ZAR0',
      index_block_hash: '0xaa',
      block_hash: '0xff',
      block_height: 123,
      burn_block_time: 1594647995,
    });
    await db.updateTx(client, dbTx);

    const txQuery = await getTxFromDataStore(dbTx.tx_id, db);
    expect(txQuery.found).toBe(true);
    if (!txQuery.found) {
      throw Error('not found');
    }

    const expectedResp = {
      block_hash: '0xff',
      block_height: 123,
      burn_block_time: 1594647995,
      burn_block_time_iso: '2020-07-13T13:46:35.000Z',
      canonical: true,
      tx_id: '0x79abc7783de19569106087302b02379dd02cbb52d20c6c3a7c3d79cbedd559fa',
      tx_index: 2,
      tx_status: 'abort_by_response',
      tx_result: {
        hex: '0x0100000000000000000000000000000001', // u1
        repr: 'u1',
      },
      tx_type: 'smart_contract',
      fee_rate: '200',
      sender_address: 'SP2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7GB36ZAR0',
      sponsored: false,
      post_condition_mode: 'deny',
      post_conditions: [],
      smart_contract: {
        contract_id: 'SP2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7GB36ZAR0.hello-world',
        source_code: '()',
      },
      events: [],
    };
    expect(txQuery.result).toEqual(expectedResp);

    const fetchTx = await supertest(api.server).get(`/extended/v1/tx/${dbTx.tx_id}`);
    expect(fetchTx.status).toBe(200);
    expect(fetchTx.type).toBe('application/json');
    expect(JSON.parse(fetchTx.text)).toEqual(expectedResp);
  });

  test('tx store and processing - abort_by_post_condition', async () => {
    const txBuilder = await makeContractDeploy({
      contractName: 'hello-world',
      codeBody: '()',
      fee: new BN(200),
      senderKey: 'b8d99fd45da58038d630d9855d3ca2466e8e0f89d3894c4724f0efc9ff4b51f001',
      postConditions: [],
      nonce: new BN(0),
    });
    const serialized = txBuilder.serialize();
    const tx = readTransaction(new BufferReader(serialized));
    const dbTx = createDbTxFromCoreMsg({
      core_tx: {
        raw_tx: '0x' + serialized.toString('hex'),
        result: void 0,
        raw_result: '0x0100000000000000000000000000000001', // u1
        status: 'abort_by_post_condition',
        txid: '0x' + txBuilder.txid(),
        tx_index: 2,
        contract_abi: null,
      },
      raw_tx: Buffer.alloc(0),
      parsed_tx: tx,
      sender_address: 'SP2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7GB36ZAR0',
      index_block_hash: '0xaa',
      block_hash: '0xff',
      block_height: 123,
      burn_block_time: 1594647995,
    });
    await db.updateTx(client, dbTx);

    const txQuery = await getTxFromDataStore(dbTx.tx_id, db);
    expect(txQuery.found).toBe(true);
    if (!txQuery.found) {
      throw Error('not found');
    }

    const expectedResp = {
      block_hash: '0xff',
      block_height: 123,
      burn_block_time: 1594647995,
      burn_block_time_iso: '2020-07-13T13:46:35.000Z',
      canonical: true,
      tx_id: '0x79abc7783de19569106087302b02379dd02cbb52d20c6c3a7c3d79cbedd559fa',
      tx_index: 2,
      tx_status: 'abort_by_post_condition',
      tx_result: {
        hex: '0x0100000000000000000000000000000001', // u1
        repr: 'u1',
      },
      tx_type: 'smart_contract',
      fee_rate: '200',
      sender_address: 'SP2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7GB36ZAR0',
      sponsored: false,
      post_condition_mode: 'deny',
      post_conditions: [],
      smart_contract: {
        contract_id: 'SP2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7GB36ZAR0.hello-world',
        source_code: '()',
      },
      events: [],
    };
    expect(txQuery.result).toEqual(expectedResp);

    const fetchTx = await supertest(api.server).get(`/extended/v1/tx/${dbTx.tx_id}`);
    expect(fetchTx.status).toBe(200);
    expect(fetchTx.type).toBe('application/json');
    expect(JSON.parse(fetchTx.text)).toEqual(expectedResp);
  });

  afterEach(async () => {
    await new Promise(resolve => api.server.close(() => resolve()));
    client.release();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
