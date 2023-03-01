import * as supertest from 'supertest';
import { ChainID } from '@stacks/transactions';
import { getBlockFromDataStore } from '../api/controllers/db-controller';
import {
  DbBlock,
  DbTxRaw,
  DbTxTypeId,
  DbTxStatus,
  DataStoreBlockUpdateData,
} from '../datastore/common';
import { startApiServer, ApiServer } from '../api/init';
import { bufferToHexPrefixString, I32_MAX } from '../helpers';
import { TestBlockBuilder, TestMicroblockStreamBuilder } from '../test-utils/test-builders';
import { PgWriteStore } from '../datastore/pg-write-store';
import { cycleMigrations, runMigrations } from '../datastore/migrations';
import { PgSqlClient } from '../datastore/connection';

describe('block tests', () => {
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

  test('info block time', async () => {
    const query1 = await supertest(api.server).get(`/extended/v1/info/network_block_times`);
    expect(query1.status).toBe(200);
    expect(query1.type).toBe('application/json');
    expect(JSON.parse(query1.text)).toEqual({
      testnet: { target_block_time: 120 },
      mainnet: { target_block_time: 600 },
    });

    const query2 = await supertest(api.server).get(`/extended/v1/info/network_block_time/mainnet`);
    expect(query2.status).toBe(200);
    expect(query2.type).toBe('application/json');
    expect(JSON.parse(query2.text)).toEqual({ target_block_time: 600 });

    const query3 = await supertest(api.server).get(`/extended/v1/info/network_block_time/testnet`);
    expect(query3.status).toBe(200);
    expect(query3.type).toBe('application/json');
    expect(JSON.parse(query3.text)).toEqual({ target_block_time: 120 });

    const query4 = await supertest(api.server).get(`/extended/v1/info/network_block_time/badnet`);
    expect(query4.status).toBe(400);
    expect(query4.type).toBe('application/json');
    expect(JSON.parse(query4.text)).toEqual({
      error: '`network` param must be `testnet` or `mainnet`',
    });
  });

  test('block store and process', async () => {
    const block: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0xdeadbeef',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0xff0011',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1235,
      burn_block_time: 1594647996,
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
    await db.updateBlock(client, block);
    const tx: DbTxRaw = {
      tx_id: '0x1234',
      anchor_mode: 3,
      tx_index: 4,
      nonce: 0,
      raw_tx: '',
      index_block_hash: block.index_block_hash,
      block_hash: block.block_hash,
      block_height: 68456,
      burn_block_time: 1594647995,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: bufferToHexPrefixString(Buffer.from('hi')),
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

    const blockQuery = await getBlockFromDataStore({
      blockIdentifer: { hash: block.block_hash },
      db,
    });
    if (!blockQuery.found) {
      throw new Error('block not found');
    }

    const expectedResp = {
      burn_block_time: 1594647996,
      burn_block_time_iso: '2020-07-13T13:46:36.000Z',
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      hash: '0x1234',
      height: 1235,
      index_block_hash: '0xdeadbeef',
      parent_block_hash: '0xff0011',
      parent_microblock_hash: '0x',
      parent_microblock_sequence: 0,
      txs: ['0x1234'],
      microblocks_accepted: [],
      microblocks_streamed: [],
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      microblock_tx_count: {},
    };

    expect(blockQuery.result).toEqual(expectedResp);

    const fetchBlockByHash = await supertest(api.server).get(
      `/extended/v1/block/${block.block_hash}`
    );
    expect(fetchBlockByHash.status).toBe(200);
    expect(fetchBlockByHash.type).toBe('application/json');
    expect(JSON.parse(fetchBlockByHash.text)).toEqual(expectedResp);

    const fetchBlockByHeight = await supertest(api.server).get(
      `/extended/v1/block/by_height/${block.block_height}`
    );
    expect(fetchBlockByHeight.status).toBe(200);
    expect(fetchBlockByHeight.type).toBe('application/json');
    expect(JSON.parse(fetchBlockByHeight.text)).toEqual(expectedResp);

    const fetchBlockByBurnBlockHeight = await supertest(api.server).get(
      `/extended/v1/block/by_burn_block_height/${block.burn_block_height}`
    );
    expect(fetchBlockByBurnBlockHeight.status).toBe(200);
    expect(fetchBlockByBurnBlockHeight.type).toBe('application/json');
    expect(JSON.parse(fetchBlockByBurnBlockHeight.text)).toEqual(expectedResp);

    const fetchBlockByInvalidBurnBlockHeight1 = await supertest(api.server).get(
      `/extended/v1/block/by_burn_block_height/999`
    );
    expect(fetchBlockByInvalidBurnBlockHeight1.status).toBe(404);
    expect(fetchBlockByInvalidBurnBlockHeight1.type).toBe('application/json');
    const expectedResp1 = {
      error: 'cannot find block by height 999',
    };
    expect(JSON.parse(fetchBlockByInvalidBurnBlockHeight1.text)).toEqual(expectedResp1);

    const fetchBlockByInvalidBurnBlockHeight2 = await supertest(api.server).get(
      `/extended/v1/block/by_burn_block_height/abc`
    );
    expect(fetchBlockByInvalidBurnBlockHeight2.status).toBe(400);
    expect(fetchBlockByInvalidBurnBlockHeight2.type).toBe('application/json');
    const expectedResp2 = {
      error: 'burnchain height is not a valid integer: abc',
    };
    expect(JSON.parse(fetchBlockByInvalidBurnBlockHeight2.text)).toEqual(expectedResp2);

    const fetchBlockByInvalidBurnBlockHeight3 = await supertest(api.server).get(
      `/extended/v1/block/by_burn_block_height/0`
    );
    expect(fetchBlockByInvalidBurnBlockHeight3.status).toBe(400);
    expect(fetchBlockByInvalidBurnBlockHeight3.type).toBe('application/json');
    const expectedResp3 = {
      error: 'burnchain height is not a positive integer: 0',
    };
    expect(JSON.parse(fetchBlockByInvalidBurnBlockHeight3.text)).toEqual(expectedResp3);

    const fetchBlockByBurnBlockHash = await supertest(api.server).get(
      `/extended/v1/block/by_burn_block_hash/${block.burn_block_hash}`
    );
    expect(fetchBlockByBurnBlockHash.status).toBe(200);
    expect(fetchBlockByBurnBlockHash.type).toBe('application/json');
    expect(JSON.parse(fetchBlockByBurnBlockHash.text)).toEqual(expectedResp);

    const fetchBlockByInvalidBurnBlockHash = await supertest(api.server).get(
      `/extended/v1/block/by_burn_block_hash/0x000000`
    );
    expect(fetchBlockByInvalidBurnBlockHash.status).toBe(404);
    expect(fetchBlockByInvalidBurnBlockHash.type).toBe('application/json');
    const expectedResp4 = {
      error: 'cannot find block by burn block hash 0x000000',
    };
    expect(JSON.parse(fetchBlockByInvalidBurnBlockHash.text)).toEqual(expectedResp4);
  });

  test('/block', async () => {
    const block_hash = '0x1234',
      index_block_hash = '0xabcd',
      tx_id = '0x12ff';

    const block1 = new TestBlockBuilder({
      block_hash,
      index_block_hash,
      // parent_index_block_hash: genesis_index_block_hash,
      block_height: 1,
    })
      .addTx({ block_hash, tx_id, index_block_hash })
      .build();
    const microblock = new TestMicroblockStreamBuilder()
      .addMicroblock({ parent_index_block_hash: index_block_hash })
      .build();
    await db.update(block1);
    await db.updateMicroblocks(microblock);
    const expectedResp = {
      limit: 20,
      offset: 0,
      total: 1,
      results: [
        {
          canonical: true,
          height: 1,
          hash: block_hash,
          parent_block_hash: '0x',
          burn_block_time: 94869286,
          burn_block_time_iso: '1973-01-03T00:34:46.000Z',
          burn_block_hash: '0xf44f44',
          burn_block_height: 713000,
          miner_txid: '0x4321',
          parent_microblock_hash: '0x00',
          index_block_hash: '0xabcd',
          parent_microblock_sequence: 0,
          txs: [tx_id],
          microblocks_accepted: [],
          microblocks_streamed: [microblock.microblocks[0].microblock_hash],
          execution_cost_read_count: 0,
          execution_cost_read_length: 0,
          execution_cost_runtime: 0,
          execution_cost_write_count: 0,
          execution_cost_write_length: 0,
          microblock_tx_count: {},
        },
      ],
    };
    const result = await supertest(api.server).get(`/extended/v1/block/`);
    expect(result.body).toEqual(expectedResp);
  });

  test('block tx list excludes non-canonical', async () => {
    const block1 = new TestBlockBuilder({ block_hash: '0x0001', index_block_hash: '0x0001' })
      .addTx({ tx_id: '0x0001' })
      .build();
    await db.update(block1);
    const microblock1 = new TestMicroblockStreamBuilder()
      .addMicroblock({
        microblock_sequence: 0,
        microblock_hash: '0xff01',
        microblock_parent_hash: '0x1212',
        parent_index_block_hash: block1.block.index_block_hash,
      })
      .addTx({ tx_id: '0x1001', index_block_hash: '0x0002' })
      .build();
    await db.updateMicroblocks(microblock1);
    const microblock2 = new TestMicroblockStreamBuilder()
      .addMicroblock({
        microblock_sequence: 1,
        microblock_hash: '0xff02',
        microblock_parent_hash: microblock1.microblocks[0].microblock_hash,
        parent_index_block_hash: block1.block.index_block_hash,
      })
      .addTx({ tx_id: '0x1002', index_block_hash: '0x0002' })
      .build();
    await db.updateMicroblocks(microblock2);
    const expectedResp1 = {
      burn_block_hash: '0xf44f44',
      burn_block_height: expect.any(Number),
      burn_block_time: expect.any(Number),
      burn_block_time_iso: expect.any(String),
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      index_block_hash: '0x0001',
      hash: '0x0001',
      height: 1,
      microblocks_accepted: [],
      microblocks_streamed: [
        microblock2.microblocks[0].microblock_hash,
        microblock1.microblocks[0].microblock_hash,
      ],
      miner_txid: '0x4321',
      parent_block_hash: '0x',
      parent_microblock_hash: '0x00',
      parent_microblock_sequence: 0,
      txs: ['0x0001'],
      microblock_tx_count: {},
    };
    const fetch1 = await supertest(api.server).get(
      `/extended/v1/block/by_height/${block1.block.block_height}`
    );
    expect(fetch1.status).toBe(200);
    expect(fetch1.type).toBe('application/json');
    expect(JSON.parse(fetch1.text)).toEqual(expectedResp1);

    // Confirm the first microblock, but orphan the second
    const block2 = new TestBlockBuilder({
      block_height: block1.block.block_height + 1,
      block_hash: '0x0002',
      index_block_hash: '0x0002',
      parent_block_hash: block1.block.block_hash,
      parent_index_block_hash: block1.block.index_block_hash,
      parent_microblock_hash: microblock1.microblocks[0].microblock_hash,
      parent_microblock_sequence: microblock1.microblocks[0].microblock_sequence,
    })
      .addTx({ tx_id: microblock1.txs[0].tx.tx_id })
      .addTx({ tx_id: '0x0002' })
      .build();
    await db.update(block2);
    const fetch2 = await supertest(api.server).get(
      `/extended/v1/block/by_height/${block2.block.block_height}`
    );
    const expectedResp2 = {
      burn_block_hash: '0xf44f44',
      burn_block_height: expect.any(Number),
      burn_block_time: expect.any(Number),
      burn_block_time_iso: expect.any(String),
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      index_block_hash: '0x0002',
      hash: '0x0002',
      height: 2,
      microblocks_accepted: [microblock1.microblocks[0].microblock_hash],
      microblocks_streamed: [],
      miner_txid: '0x4321',
      parent_block_hash: '0x0001',
      parent_microblock_hash: microblock1.microblocks[0].microblock_hash,
      parent_microblock_sequence: microblock1.microblocks[0].microblock_sequence,
      // Ensure micro-orphaned tx `0x1002` is not included
      txs: ['0x0002', '0x1001'],
      microblock_tx_count: {
        '0xff01': microblock1.txs.length,
      },
    };

    expect(fetch2.status).toBe(200);
    expect(fetch2.type).toBe('application/json');
    expect(JSON.parse(fetch2.text)).toEqual(expectedResp2);
  });

  test('Block execution cost', async () => {
    const dbBlock: DbBlock = {
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
      canonical: false,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    const dbTx1: DbTxRaw = {
      ...dbBlock,
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
      anchor_mode: 3,
      nonce: 0,
      raw_tx: bufferToHexPrefixString(Buffer.from('test-raw-tx')),
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: bufferToHexPrefixString(Buffer.from('coinbase hi')),
      post_conditions: '0x01f5',
      fee_rate: 1234n,
      sponsored: true,
      sender_address: 'sender-addr',
      sponsor_address: 'sponsor-addr',
      origin_hash_mode: 1,
      parent_burn_block_time: 1626122935,
      tx_index: 4,
      status: DbTxStatus.Success,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
      parent_index_block_hash: '',
      event_count: 0,
      execution_cost_read_count: 1,
      execution_cost_read_length: 2,
      execution_cost_runtime: 2,
      execution_cost_write_count: 1,
      execution_cost_write_length: 1,
    };
    const dbTx2: DbTxRaw = {
      ...dbBlock,
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000001',
      anchor_mode: 3,
      nonce: 0,
      raw_tx: bufferToHexPrefixString(Buffer.from('test-raw-tx')),
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: bufferToHexPrefixString(Buffer.from('coinbase hi')),
      post_conditions: '0x01f5',
      fee_rate: 1234n,
      sponsored: true,
      sender_address: 'sender-addr',
      sponsor_address: 'sponsor-addr',
      origin_hash_mode: 1,
      parent_burn_block_time: 1626122935,
      tx_index: 4,
      status: DbTxStatus.Success,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
      parent_index_block_hash: '',
      event_count: 0,
      execution_cost_read_count: 2,
      execution_cost_read_length: 2,
      execution_cost_runtime: 2,
      execution_cost_write_count: 2,
      execution_cost_write_length: 2,
    };
    const dataStoreUpdate: DataStoreBlockUpdateData = {
      block: dbBlock,
      microblocks: [],
      minerRewards: [],
      txs: [
        {
          tx: dbTx1,
          stxEvents: [],
          stxLockEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          smartContracts: [],
          names: [],
          namespaces: [],
          pox2Events: [],
        },
        {
          tx: dbTx2,
          stxEvents: [],
          stxLockEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          smartContracts: [],
          names: [],
          namespaces: [],
          pox2Events: [],
        },
      ],
    };
    await db.update(dataStoreUpdate);

    const blockQuery = await supertest(api.server).get(`/extended/v1/block/${dbBlock.block_hash}`);
    expect(blockQuery.body.execution_cost_read_count).toBe(3);
    expect(blockQuery.body.execution_cost_read_length).toBe(4);
    expect(blockQuery.body.execution_cost_runtime).toBe(4);
    expect(blockQuery.body.execution_cost_write_count).toBe(3);
    expect(blockQuery.body.execution_cost_write_length).toBe(3);
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
