import * as supertest from 'supertest';
import { ChainID } from '@stacks/transactions';
import {
  DbBlock,
  DbTxRaw,
  DbTxTypeId,
  DbStxEvent,
  DbEventTypeId,
  DbAssetEventTypeId,
  DbFtEvent,
  DbNftEvent,
  DbMempoolTxRaw,
  DbSmartContract,
  DataStoreBlockUpdateData,
} from '../datastore/common';
import { startApiServer, ApiServer } from '../api/init';
import { I32_MAX } from '../helpers';
import { PgWriteStore } from '../datastore/pg-write-store';
import { PgSqlClient, bufferToHex } from '@hirosystems/api-toolkit';
import { migrate } from '../test-utils/test-helpers';

describe('search tests', () => {
  let db: PgWriteStore;
  let client: PgSqlClient;
  let api: ApiServer;

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    client = db.sql;
    api = await startApiServer({ datastore: db, chainId: ChainID.Testnet });
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await migrate('down');
  });

  test('search term - hash', async () => {
    const block: DbBlock = {
      block_hash: '0x1234000000000000000000000000000000000000000000000000000000000000',
      index_block_hash: '0xdeadbeef',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0xff0011',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1235,
      burn_block_time: 94869286,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      tx_count: 1,
    };
    await db.updateBlock(client, block);
    const tx: DbTxRaw = {
      tx_id: '0x4567000000000000000000000000000000000000000000000000000000000000',
      tx_index: 4,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '',
      index_block_hash: block.index_block_hash,
      block_hash: block.block_hash,
      block_height: 68456,
      burn_block_time: 2837565,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: bufferToHex(Buffer.from('coinbase hi')),
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
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      event_count: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    await db.updateTx(client, tx);

    const mempoolTx: DbMempoolTxRaw = {
      pruned: false,
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
      anchor_mode: 3,
      nonce: 0,
      raw_tx: bufferToHex(Buffer.from('test-raw-tx')),
      type_id: DbTxTypeId.Coinbase,
      receipt_time: 123456,
      coinbase_payload: bufferToHex(Buffer.from('coinbase hi')),
      status: 1,
      post_conditions: '0x01f5',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
    };
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });

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
      `/extended/v1/search/ 1234000000000000000000000000000000000000000000000000000000000000`
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

  test('search term - hash with metadata', async () => {
    const block: DbBlock = {
      block_hash: '0x1234000000000000000000000000000000000000000000000000000000000000',
      index_block_hash: '0xdeadbeef',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0xff0011',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      burn_block_time: 94869286,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      tx_count: 1,
    };

    const tx: DbTxRaw = {
      tx_id: '0x4567000000000000000000000000000000000000000000000000000000000000',
      tx_index: 4,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '',
      index_block_hash: block.index_block_hash,
      block_hash: block.block_hash,
      block_height: 1,
      burn_block_time: 2837565,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: bufferToHex(Buffer.from('coinbase hi')),
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
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
      event_count: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };

    const mempoolTx: DbMempoolTxRaw = {
      pruned: false,
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
      anchor_mode: 3,
      nonce: 0,
      raw_tx: bufferToHex(Buffer.from('test-raw-tx')),
      type_id: DbTxTypeId.Coinbase,
      receipt_time: 123456,
      coinbase_payload: bufferToHex(Buffer.from('coinbase hi')),
      status: 1,
      post_conditions: '0x01f5',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
    };
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });

    const dataStoreUpdate: DataStoreBlockUpdateData = {
      block: block,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: tx,
          stxEvents: [],
          stxLockEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          smartContracts: [],
          names: [],
          namespaces: [],
          pox2Events: [],
          pox3Events: [],
          pox4Events: [],
        },
      ],
    };

    await db.update(dataStoreUpdate);
    const blockMetadata = {
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      burn_block_time: 94869286,
      burn_block_time_iso: '1973-01-03T00:34:46.000Z',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      hash: '0x1234000000000000000000000000000000000000000000000000000000000000',
      height: 1,
      index_block_hash: '0xdeadbeef',
      microblocks_accepted: [],
      microblocks_streamed: [],
      miner_txid: '0x4321',
      parent_block_hash: '0xff0011',
      parent_microblock_hash: '0x',
      parent_microblock_sequence: 0,
      txs: ['0x4567000000000000000000000000000000000000000000000000000000000000'],
      microblock_tx_count: {},
    };

    const searchResult1 = await supertest(api.server).get(
      `/extended/v1/search/0x1234000000000000000000000000000000000000000000000000000000000000?include_metadata=true`
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
          height: 1,
        },
        metadata: blockMetadata,
      },
    };
    expect(JSON.parse(searchResult1.text)).toEqual(expectedResp1);

    // test without 0x-prefix
    const searchResult2 = await supertest(api.server).get(
      `/extended/v1/search/1234000000000000000000000000000000000000000000000000000000000000?include_metadata=true`
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
          height: 1,
        },
        metadata: blockMetadata,
      },
    };
    expect(JSON.parse(searchResult2.text)).toEqual(expectedResp2);

    // test whitespace
    const searchResult3 = await supertest(api.server).get(
      `/extended/v1/search/ 1234000000000000000000000000000000000000000000000000000000000000?include_metadata=true`
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
          height: 1,
        },
        metadata: blockMetadata,
      },
    };
    expect(JSON.parse(searchResult3.text)).toEqual(expectedResp3);

    // test mempool tx search
    const searchResult4 = await supertest(api.server).get(
      `/extended/v1/search/0x8912000000000000000000000000000000000000000000000000000000000000?include_metadata=1`
    );
    expect(searchResult4.status).toBe(200);
    expect(searchResult4.type).toBe('application/json');
    const expectedResp4 = {
      found: true,
      result: {
        entity_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
        entity_type: 'mempool_tx_id',
        tx_data: { tx_type: 'coinbase' },
        metadata: {
          anchor_mode: 'any',
          coinbase_payload: {
            data: '0x636f696e62617365206869',
            alt_recipient: null,
          },
          fee_rate: '1234',
          nonce: 0,
          post_condition_mode: 'allow',
          post_conditions: [],
          receipt_time: 123456,
          receipt_time_iso: '1970-01-02T10:17:36.000Z',
          sender_address: 'sender-addr',
          sponsored: false,
          tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
          tx_status: 'success',
          tx_type: 'coinbase',
        },
      },
    };
    expect(JSON.parse(searchResult4.text)).toEqual(expectedResp4);

    // test hash not found
    const searchResult5 = await supertest(api.server).get(
      `/extended/v1/search/0x1111000000000000000000000000000000000000000000000000000000000000?include_metadata=on`
    );
    expect(searchResult5.status).toBe(404);
    expect(searchResult5.type).toBe('application/json');
    const expectedResp6 = {
      found: false,
      result: { entity_type: 'unknown_hash' },
      error:
        'No block or transaction found with hash "0x1111000000000000000000000000000000000000000000000000000000000000"',
    };
    expect(JSON.parse(searchResult5.text)).toEqual(expectedResp6);

    // test invalid hash hex
    const invalidHex = '0x1111w00000000000000000000000000000000000000000000000000000000000';
    const searchResult6 = await supertest(api.server).get(
      `/extended/v1/search/${invalidHex}?include_metadata`
    );
    expect(searchResult6.status).toBe(404);
    expect(searchResult6.type).toBe('application/json');
    const expectedResp7 = {
      found: false,
      result: { entity_type: 'invalid_term' },
      error:
        'The term "0x1111w00000000000000000000000000000000000000000000000000000000000" is not a valid block hash, transaction ID, contract principal, or account address principal',
    };
    expect(JSON.parse(searchResult6.text)).toEqual(expectedResp7);

    // test tx search
    const searchResult8 = await supertest(api.server).get(
      `/extended/v1/search/0x4567000000000000000000000000000000000000000000000000000000000000?include_metadata`
    );
    expect(searchResult8.status).toBe(200);
    expect(searchResult8.type).toBe('application/json');

    const expectedResp8 = {
      found: true,
      result: {
        entity_id: '0x4567000000000000000000000000000000000000000000000000000000000000',
        entity_type: 'tx_id',
        tx_data: {
          canonical: true,
          block_hash: '0x1234000000000000000000000000000000000000000000000000000000000000',
          burn_block_time: 2837565,
          block_height: 1,
          tx_type: 'coinbase',
        },
        metadata: {
          tx_id: '0x4567000000000000000000000000000000000000000000000000000000000000',
          nonce: 0,
          fee_rate: '1234',
          sender_address: 'sender-addr',
          sponsored: false,
          post_condition_mode: 'allow',
          post_conditions: [],
          anchor_mode: 'any',
          is_unanchored: false,
          block_hash: '0x1234000000000000000000000000000000000000000000000000000000000000',
          parent_block_hash: '0x',
          block_height: 1,
          burn_block_time: 2837565,
          burn_block_time_iso: '1970-02-02T20:12:45.000Z',
          parent_burn_block_time: 1626122935,
          parent_burn_block_time_iso: '2021-07-12T20:48:55.000Z',
          canonical: true,
          tx_index: 4,
          tx_status: 'success',
          tx_result: {
            hex: '0x0100000000000000000000000000000001',
            repr: 'u1',
          },
          microblock_hash: '0x',
          microblock_sequence: 2147483647,
          microblock_canonical: true,
          event_count: 0,
          events: [],
          execution_cost_read_count: 0,
          execution_cost_read_length: 0,
          execution_cost_runtime: 0,
          execution_cost_write_count: 0,
          execution_cost_write_length: 0,
          tx_type: 'coinbase',
          coinbase_payload: {
            data: '0x636f696e62617365206869',
            alt_recipient: null,
          },
        },
      },
    };
    expect(JSON.parse(searchResult8.text)).toEqual(expectedResp8);
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
    const contractAddr1 = 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world';
    const contractAddr2 = 'STSPS4JYDEYCPPCSHE3MM2NCEGR07KPBETNEZCBQ.contract-name';
    const contractAddr3 = 'STSPS4JYDEYCPPCSHE3MM2NCEGR07KPBETNEZCBQ.test-contract';

    const block: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x2345',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 100123123,
      burn_block_time: 39486,
      burn_block_hash: '0x1234',
      burn_block_height: 100123123,
      miner_txid: '0x4321',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      tx_count: 1,
    };
    await db.updateBlock(client, block);

    const stxTx1: DbTxRaw = {
      tx_id: '0x1111000000000000000000000000000000000000000000000000000000000000',
      tx_index: 0,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '',
      index_block_hash: '0x5432',
      block_hash: '0x9876',
      block_height: 68456,
      burn_block_time: 2837565,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.TokenTransfer,
      token_transfer_amount: 1n,
      token_transfer_memo: bufferToHex(Buffer.from('hi')),
      token_transfer_recipient_address: 'none',
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
      sender_address: addr1,
      origin_hash_mode: 1,
      event_count: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
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

    const stxTx2: DbTxRaw = {
      tx_id: '0x2222000000000000000000000000000000000000000000000000000000000000',
      tx_index: 0,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '',
      index_block_hash: '0x5432',
      block_hash: '0x9876',
      block_height: 68456,
      burn_block_time: 2837565,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.TokenTransfer,
      token_transfer_amount: 1n,
      token_transfer_memo: bufferToHex(Buffer.from('test-raw-tx')),
      token_transfer_recipient_address: addr2,
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
      sender_address: 'none',
      origin_hash_mode: 1,
      event_count: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
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
      amount: 1n,
      recipient: addr3,
      sender: 'none',
    };
    await db.updateStxEvents(client, [{ tx: stxTx1, stxEvents: [stxEvent1] }]);

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
      amount: 1n,
      recipient: 'none',
      sender: addr4,
    };

    await db.updateStxEvents(client, [{ tx: stxTx1, stxEvents: [stxEvent2] }]);

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
      amount: 1n,
      recipient: addr5,
      sender: 'none',
    };
    await db.updateFtEvents(client, [{ tx: stxTx1, ftEvents: [ftEvent1] }]);

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
      amount: 1n,
      recipient: 'none',
      sender: addr6,
    };
    await db.updateFtEvents(client, [{ tx: stxTx1, ftEvents: [ftEvent2] }]);

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
      value: '0x0000000000000000000000000000000000',
      recipient: addr7,
      sender: 'none',
    };
    await db.updateNftEvents(client, stxTx1, [nftEvent1], false);

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
      value: '0x0000000000000000000000000000000000',
      recipient: 'none',
      sender: addr8,
    };
    await db.updateNftEvents(client, stxTx1, [nftEvent2], false);

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

    const smartContract: DbTxRaw = {
      type_id: DbTxTypeId.SmartContract,
      tx_id: '0x1111880000000000000000000000000000000000000000000000000000000000',
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '',
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
      parent_index_block_hash: '',
      parent_block_hash: '',
      smart_contract_contract_id: contractAddr1,
      smart_contract_source_code: '(some-src)',
      block_height: 1,
      tx_index: 0,
      index_block_hash: '0x543288',
      block_hash: '0x9876',
      burn_block_time: 2837565,
      parent_burn_block_time: 1626122935,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      post_conditions: '0x01f5',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'none',
      origin_hash_mode: 1,
      event_count: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
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
          tx_id: '0x1111880000000000000000000000000000000000000000000000000000000000',
        },
      },
    };
    expect(JSON.parse(searchResult9.text)).toEqual(expectedResp9);

    const smartContractMempoolTx: DbMempoolTxRaw = {
      pruned: false,
      type_id: DbTxTypeId.SmartContract,
      tx_id: '0x1111882200000000000000000000000000000000000000000000000000000000',
      anchor_mode: 3,
      nonce: 0,
      raw_tx: bufferToHex(Buffer.from('test-raw-tx')),
      receipt_time: 123456,
      smart_contract_contract_id: contractAddr2,
      smart_contract_source_code: '(some-src)',
      status: 1,
      post_conditions: '0x01f5',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'none',
      origin_hash_mode: 1,
    };
    await db.updateMempoolTxs({ mempoolTxs: [smartContractMempoolTx] });

    // test contract address associated with mempool tx
    const searchResult10 = await supertest(api.server).get(`/extended/v1/search/${contractAddr2}`);
    expect(searchResult10.status).toBe(200);
    expect(searchResult10.type).toBe('application/json');
    const expectedResp10 = {
      found: true,
      result: {
        entity_id: 'STSPS4JYDEYCPPCSHE3MM2NCEGR07KPBETNEZCBQ.contract-name',
        entity_type: 'contract_address',
        tx_data: {
          tx_type: 'smart_contract',
          tx_id: '0x1111882200000000000000000000000000000000000000000000000000000000',
        },
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

  test('search term - principal with metadata', async () => {
    const addr1 = 'ST3J8EVYHVKH6XXPD61EE8XEHW4Y2K83861225AB1';
    const addr2 = 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4';
    const addr3 = 'ST37VASHEJRMFRS91GWK1HZZKKEYQTEP85ARXCQPH';
    const addr4 = 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C';
    const addr5 = 'ST3YKTGBCY1BNKN6J18A3QKAX7CE36SZH3A5XN9ZQ';
    const addr6 = 'SZ2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKQ9H6DPR';
    const addr7 = 'SM2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKQVX8X0G';
    const addr8 = 'ST3AMFNNS7KBQ28ECMJMN2G3AGJ37SSA2HSY82CMH';
    const addr9 = 'STAR26VJ4BC24SMNKRY533MAM0K3JA5ZJDVBD45A';
    const contractAddr1 = 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world';
    const contractAddr2 = 'STSPS4JYDEYCPPCSHE3MM2NCEGR07KPBETNEZCBQ.contract-name';
    const contractAddr3 = 'STSPS4JYDEYCPPCSHE3MM2NCEGR07KPBETNEZCBQ.test-contract';

    const block: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x2345',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      burn_block_time: 39486,
      burn_block_hash: '0x1234',
      burn_block_height: 100123123,
      miner_txid: '0x4321',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      tx_count: 1,
    };

    const stxTx1: DbTxRaw = {
      tx_id: '0x1111000000000000000000000000000000000000000000000000000000000000',
      tx_index: 0,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '',
      index_block_hash: '0x5432',
      block_hash: block.block_hash,
      block_height: block.block_height,
      burn_block_time: 2837565,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.TokenTransfer,
      token_transfer_amount: 1n,
      token_transfer_memo: bufferToHex(Buffer.from('hi')),
      token_transfer_recipient_address: 'none',
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
      sender_address: addr1,
      origin_hash_mode: 1,
      event_count: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };

    const stxTx2: DbTxRaw = {
      tx_id: '0x2222000000000000000000000000000000000000000000000000000000000000',
      tx_index: 0,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '',
      index_block_hash: '0x5432',
      block_hash: block.block_hash,
      block_height: block.block_height,
      burn_block_time: 2837565,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.TokenTransfer,
      token_transfer_amount: 1n,
      token_transfer_memo: bufferToHex(Buffer.from('hi')),
      token_transfer_recipient_address: addr2,
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
      sender_address: 'none',
      origin_hash_mode: 1,
      event_count: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };

    const stxEvent1: DbStxEvent = {
      canonical: true,
      event_type: DbEventTypeId.StxAsset,
      asset_event_type_id: DbAssetEventTypeId.Transfer,
      event_index: 0,
      tx_id: '0x1111000000000000000000000000000000000000000000000000000000000000',
      tx_index: 1,
      block_height: block.block_height,
      amount: 1n,
      recipient: addr3,
      sender: 'none',
    };

    const stxEvent2: DbStxEvent = {
      canonical: true,
      event_type: DbEventTypeId.StxAsset,
      asset_event_type_id: DbAssetEventTypeId.Transfer,
      event_index: 0,
      tx_id: '0x1111000000000000000000000000000000000000000000000000000000000000',
      tx_index: 1,
      block_height: 1,
      amount: 1n,
      recipient: 'none',
      sender: addr4,
    };

    const ftEvent1: DbFtEvent = {
      canonical: true,
      event_type: DbEventTypeId.FungibleTokenAsset,
      asset_event_type_id: DbAssetEventTypeId.Transfer,
      event_index: 0,
      tx_id: '0x1111000000000000000000000000000000000000000000000000000000000000',
      tx_index: 1,
      block_height: block.block_height,
      asset_identifier: 'some-asset',
      amount: 1n,
      recipient: addr5,
      sender: 'none',
    };

    const ftEvent2: DbFtEvent = {
      canonical: true,
      event_type: DbEventTypeId.FungibleTokenAsset,
      asset_event_type_id: DbAssetEventTypeId.Transfer,
      event_index: 0,
      tx_id: '0x1111000000000000000000000000000000000000000000000000000000000000',
      tx_index: 1,
      block_height: block.block_height,
      asset_identifier: 'some-asset',
      amount: 1n,
      recipient: 'none',
      sender: addr6,
    };

    const nftEvent1: DbNftEvent = {
      canonical: true,
      event_type: DbEventTypeId.NonFungibleTokenAsset,
      asset_event_type_id: DbAssetEventTypeId.Transfer,
      event_index: 0,
      tx_id: '0x1111000000000000000000000000000000000000000000000000000000000000',
      tx_index: 1,
      block_height: block.block_height,
      asset_identifier: 'some-asset',
      value: '0x0000000000000000000000000000000000',
      recipient: addr7,
      sender: 'none',
    };

    const nftEvent2: DbNftEvent = {
      canonical: true,
      event_type: DbEventTypeId.NonFungibleTokenAsset,
      asset_event_type_id: DbAssetEventTypeId.Transfer,
      event_index: 0,
      tx_id: '0x1111000000000000000000000000000000000000000000000000000000000000',
      tx_index: 1,
      block_height: block.block_height,
      asset_identifier: 'some-asset',
      value: '0x0000000000000000000000000000000000',
      recipient: 'none',
      sender: addr8,
    };

    const smartContractTx: DbTxRaw = {
      type_id: DbTxTypeId.SmartContract,
      tx_id: '0x1111880000000000000000000000000000000000000000000000000000000000',
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '',
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
      parent_index_block_hash: '',
      parent_block_hash: '',
      smart_contract_contract_id: contractAddr1,
      smart_contract_source_code: '(some-src)',
      block_height: 1,
      tx_index: 0,
      index_block_hash: block.index_block_hash,
      block_hash: block.block_hash,
      burn_block_time: 2837565,
      parent_burn_block_time: 1626122935,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      post_conditions: '0x01f5',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'none',
      origin_hash_mode: 1,
      event_count: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };

    const smartContract: DbSmartContract = {
      tx_id: '0x421234',
      canonical: true,
      block_height: block.block_height,
      clarity_version: null,
      contract_id: contractAddr1,
      source_code: '(some-src)',
      abi: '{"some-abi":1}',
    };

    const dataStoreUpdate: DataStoreBlockUpdateData = {
      block: block,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: stxTx1,
          stxEvents: [stxEvent1, stxEvent2],
          stxLockEvents: [],
          ftEvents: [ftEvent1, ftEvent2],
          nftEvents: [nftEvent1, nftEvent2],
          contractLogEvents: [],
          smartContracts: [],
          names: [],
          namespaces: [],
          pox2Events: [],
          pox3Events: [],
          pox4Events: [],
        },
        {
          tx: stxTx2,
          stxEvents: [],
          stxLockEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          smartContracts: [],
          names: [],
          namespaces: [],
          pox2Events: [],
          pox3Events: [],
          pox4Events: [],
        },
        {
          tx: smartContractTx,
          stxEvents: [],
          stxLockEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          smartContracts: [smartContract],
          names: [],
          namespaces: [],
          pox2Events: [],
          pox3Events: [],
          pox4Events: [],
        },
      ],
    };
    await db.update(dataStoreUpdate);

    // test address as a tx sender
    const searchResult1 = await supertest(api.server).get(
      `/extended/v1/search/${addr1}?include_metadata`
    );
    expect(searchResult1.status).toBe(200);
    expect(searchResult1.type).toBe('application/json');
    const expectedResp1 = {
      found: true,
      result: {
        entity_type: 'standard_address',
        entity_id: addr1,
        metadata: {
          balance: '-1234',
          burnchain_lock_height: 0,
          burnchain_unlock_height: 0,
          lock_height: 0,
          lock_tx_id: '',
          locked: '0',
          total_fees_sent: '1234',
          total_miner_rewards_received: '0',
          total_received: '0',
          total_sent: '0',
        },
      },
    };
    expect(JSON.parse(searchResult1.text)).toEqual(expectedResp1);

    // test address as a stx tx recipient
    const searchResult2 = await supertest(api.server).get(
      `/extended/v1/search/${addr2}?include_metadata`
    );
    expect(searchResult2.status).toBe(200);
    expect(searchResult2.type).toBe('application/json');
    const expectedResp2 = {
      found: true,
      result: {
        entity_type: 'standard_address',
        entity_id: addr2,
        metadata: {
          balance: '0',
          burnchain_lock_height: 0,
          burnchain_unlock_height: 0,
          lock_height: 0,
          lock_tx_id: '',
          locked: '0',
          total_fees_sent: '0',
          total_miner_rewards_received: '0',
          total_received: '0',
          total_sent: '0',
        },
      },
    };
    expect(JSON.parse(searchResult2.text)).toEqual(expectedResp2);

    // test address as a stx event recipient
    const searchResult3 = await supertest(api.server).get(
      `/extended/v1/search/${addr3}?include_metadata`
    );
    expect(searchResult3.status).toBe(200);
    expect(searchResult3.type).toBe('application/json');
    const expectedResp3 = {
      found: true,
      result: {
        entity_type: 'standard_address',
        entity_id: addr3,
        metadata: {
          balance: '1',
          burnchain_lock_height: 0,
          burnchain_unlock_height: 0,
          lock_height: 0,
          lock_tx_id: '',
          locked: '0',
          total_fees_sent: '0',
          total_miner_rewards_received: '0',
          total_received: '1',
          total_sent: '0',
        },
      },
    };
    expect(JSON.parse(searchResult3.text)).toEqual(expectedResp3);

    // test address as a stx event sender
    const searchResult4 = await supertest(api.server).get(
      `/extended/v1/search/${addr4}?include_metadata=true`
    );
    expect(searchResult4.status).toBe(200);
    expect(searchResult4.type).toBe('application/json');
    const expectedResp4 = {
      found: true,
      result: {
        entity_type: 'standard_address',
        entity_id: addr4,
        metadata: {
          balance: '-1',
          burnchain_lock_height: 0,
          burnchain_unlock_height: 0,
          lock_height: 0,
          lock_tx_id: '',
          locked: '0',
          total_fees_sent: '0',
          total_miner_rewards_received: '0',
          total_received: '0',
          total_sent: '1',
        },
      },
    };
    expect(JSON.parse(searchResult4.text)).toEqual(expectedResp4);

    // test address as a ft event recipient
    const searchResult5 = await supertest(api.server).get(
      `/extended/v1/search/${addr5}?include_metadata`
    );
    expect(searchResult5.status).toBe(200);
    expect(searchResult5.type).toBe('application/json');
    const emptyStandardAddressMetadata = {
      balance: '0',
      burnchain_lock_height: 0,
      burnchain_unlock_height: 0,
      lock_height: 0,
      lock_tx_id: '',
      locked: '0',
      total_fees_sent: '0',
      total_miner_rewards_received: '0',
      total_received: '0',
      total_sent: '0',
    };
    const expectedResp5 = {
      found: true,
      result: {
        entity_type: 'standard_address',
        entity_id: addr5,
        metadata: emptyStandardAddressMetadata,
      },
    };
    expect(JSON.parse(searchResult5.text)).toEqual(expectedResp5);

    // test address as a ft event sender
    const searchResult6 = await supertest(api.server).get(
      `/extended/v1/search/${addr6}?include_metadata`
    );
    expect(searchResult6.status).toBe(200);
    expect(searchResult6.type).toBe('application/json');
    const expectedResp6 = {
      found: true,
      result: {
        entity_type: 'standard_address',
        entity_id: addr6,
        metadata: emptyStandardAddressMetadata,
      },
    };
    expect(JSON.parse(searchResult6.text)).toEqual(expectedResp6);

    // test address as a nft event recipient
    const searchResult7 = await supertest(api.server).get(
      `/extended/v1/search/${addr7}?include_metadata`
    );
    expect(searchResult7.status).toBe(200);
    expect(searchResult7.type).toBe('application/json');
    const expectedResp7 = {
      found: true,
      result: {
        entity_type: 'standard_address',
        entity_id: addr7,
        metadata: emptyStandardAddressMetadata,
      },
    };
    expect(JSON.parse(searchResult7.text)).toEqual(expectedResp7);

    // test address as a nft event sender
    const searchResult8 = await supertest(api.server).get(
      `/extended/v1/search/${addr8}?include_metadata`
    );
    expect(searchResult8.status).toBe(200);
    expect(searchResult8.type).toBe('application/json');
    const expectedResp8 = {
      found: true,
      result: {
        entity_type: 'standard_address',
        entity_id: addr8,
        metadata: emptyStandardAddressMetadata,
      },
    };
    expect(JSON.parse(searchResult8.text)).toEqual(expectedResp8);

    // test contract address
    const searchResult9 = await supertest(api.server).get(
      `/extended/v1/search/${contractAddr1}?include_metadata=true`
    );
    expect(searchResult9.status).toBe(200);
    expect(searchResult9.type).toBe('application/json');
    const expectedResp9 = {
      found: true,
      result: {
        entity_id: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
        entity_type: 'contract_address',
        tx_data: {
          canonical: true,
          block_hash: '0x1234',
          burn_block_time: 2837565,
          block_height: 1,
          tx_type: 'smart_contract',
          tx_id: '0x1111880000000000000000000000000000000000000000000000000000000000',
        },
        metadata: {
          anchor_mode: 'any',
          block_hash: '0x1234',
          block_height: 1,
          burn_block_time: 2837565,
          burn_block_time_iso: '1970-02-02T20:12:45.000Z',
          canonical: true,
          event_count: 0,
          events: [],
          execution_cost_read_count: 0,
          execution_cost_read_length: 0,
          execution_cost_runtime: 0,
          execution_cost_write_count: 0,
          execution_cost_write_length: 0,
          fee_rate: '1234',
          is_unanchored: false,
          microblock_canonical: true,
          microblock_hash: '0x',
          microblock_sequence: 2147483647,
          nonce: 0,
          parent_block_hash: '0x',
          parent_burn_block_time: 1626122935,
          parent_burn_block_time_iso: '2021-07-12T20:48:55.000Z',
          post_condition_mode: 'allow',
          post_conditions: [],
          sender_address: 'none',
          smart_contract: {
            clarity_version: null,
            contract_id: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
            source_code: '(some-src)',
          },
          sponsored: false,
          tx_id: '0x1111880000000000000000000000000000000000000000000000000000000000',
          tx_index: 0,
          tx_result: {
            hex: '0x0100000000000000000000000000000001',
            repr: 'u1',
          },
          tx_status: 'success',
          tx_type: 'smart_contract',
        },
      },
    };
    expect(JSON.parse(searchResult9.text)).toEqual(expectedResp9);

    const smartContractMempoolTx: DbMempoolTxRaw = {
      pruned: false,
      type_id: DbTxTypeId.SmartContract,
      tx_id: '0x1111882200000000000000000000000000000000000000000000000000000000',
      anchor_mode: 3,
      nonce: 0,
      raw_tx: bufferToHex(Buffer.from('test-raw-tx')),
      receipt_time: 123456,
      smart_contract_contract_id: contractAddr2,
      smart_contract_source_code: '(some-src)',
      status: 1,
      post_conditions: '0x01f5',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'none',
      origin_hash_mode: 1,
    };
    await db.updateMempoolTxs({ mempoolTxs: [smartContractMempoolTx] });

    // test contract address associated with mempool tx
    const searchResult10 = await supertest(api.server).get(
      `/extended/v1/search/${contractAddr2}?include_metadata`
    );
    expect(searchResult10.status).toBe(200);
    expect(searchResult10.type).toBe('application/json');
    const expectedResp10 = {
      found: true,
      result: {
        entity_id: 'STSPS4JYDEYCPPCSHE3MM2NCEGR07KPBETNEZCBQ.contract-name',
        entity_type: 'contract_address',
        tx_data: {
          tx_type: 'smart_contract',
          tx_id: '0x1111882200000000000000000000000000000000000000000000000000000000',
        },
        metadata: {
          anchor_mode: 'any',
          fee_rate: '1234',
          nonce: 0,
          post_condition_mode: 'allow',
          post_conditions: [],
          receipt_time: 123456,
          receipt_time_iso: '1970-01-02T10:17:36.000Z',
          sender_address: 'none',
          smart_contract: {
            clarity_version: null,
            contract_id: 'STSPS4JYDEYCPPCSHE3MM2NCEGR07KPBETNEZCBQ.contract-name',
            source_code: '(some-src)',
          },
          sponsored: false,
          tx_id: '0x1111882200000000000000000000000000000000000000000000000000000000',
          tx_status: 'success',
          tx_type: 'smart_contract',
        },
      },
    };
    expect(JSON.parse(searchResult10.text)).toEqual(expectedResp10);

    // test contract address not found
    const searchResult11 = await supertest(api.server).get(
      `/extended/v1/search/${contractAddr3}?include_metadata`
    );
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
    const searchResult12 = await supertest(api.server).get(
      `/extended/v1/search/${addr9}?include_metadata`
    );
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
    const searchResult13 = await supertest(api.server).get(
      `/extended/v1/search/${invalidTerm}?include_metadata`
    );
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
});
