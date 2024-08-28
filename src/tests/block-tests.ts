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
import { I32_MAX, unixEpochToIso } from '../helpers';
import { TestBlockBuilder, TestMicroblockStreamBuilder } from '../test-utils/test-builders';
import { PgWriteStore } from '../datastore/pg-write-store';
import { PgSqlClient, bufferToHex } from '@hirosystems/api-toolkit';
import { migrate } from '../test-utils/test-helpers';
import { BlockListV2Response } from 'src/api/schemas/responses/responses';

describe('block tests', () => {
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
      block_time: 1594647996,
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
      tx_count: 1,
      signer_bitvec: null,
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
      block_time: 1594647995,
      burn_block_height: 68456,
      burn_block_time: 1594647995,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: bufferToHex(Buffer.from('hi')),
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
      block_time: 1594647996,
      block_time_iso: '2020-07-13T13:46:36.000Z',
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
    const expectedResp1 = expect.objectContaining({
      message: 'cannot find block by height',
    });
    expect(JSON.parse(fetchBlockByInvalidBurnBlockHeight1.text)).toEqual(expectedResp1);

    const fetchBlockByInvalidBurnBlockHeight2 = await supertest(api.server).get(
      `/extended/v1/block/by_burn_block_height/abc`
    );
    expect(fetchBlockByInvalidBurnBlockHeight2.status).toBe(400);
    expect(fetchBlockByInvalidBurnBlockHeight2.type).toBe('application/json');
    const expectedResp2 = expect.objectContaining({
      message: 'params/burn_block_height must be integer',
    });
    expect(JSON.parse(fetchBlockByInvalidBurnBlockHeight2.text)).toEqual(expectedResp2);

    const fetchBlockByInvalidBurnBlockHeight3 = await supertest(api.server).get(
      `/extended/v1/block/by_burn_block_height/0`
    );
    expect(fetchBlockByInvalidBurnBlockHeight3.status).not.toBe(200);
    expect(fetchBlockByInvalidBurnBlockHeight3.type).toBe('application/json');

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
    const expectedResp4 = expect.objectContaining({
      message: 'cannot find block by burn block hash',
    });
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
          block_time: 94869287,
          block_time_iso: '1973-01-03T00:34:47.000Z',
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

  test('/burn_block', async () => {
    const burnBlock1 = {
      burn_block_hash: '0x5678111111111111111111111111111111111111111111111111111111111111',
      burn_block_height: 5,
      burn_block_time: 1702386592,
    };
    const burnBlock2 = {
      burn_block_hash: '0x5678211111111111111111111111111111111111111111111111111111111111',
      burn_block_height: 7,
      burn_block_time: 1702386678,
    };

    const tenMinutes = 10 * 60;
    let blockStartTime = 1714139800;
    const stacksBlock1 = {
      block_height: 1,
      block_time: (blockStartTime += tenMinutes),
      block_hash: '0x1234111111111111111111111111111111111111111111111111111111111111',
      index_block_hash: '0xabcd111111111111111111111111111111111111111111111111111111111111',
      parent_index_block_hash: '0x0000000000000000000000000000000000000000000000000000000000000000',
      burn_block_hash: burnBlock1.burn_block_hash,
      burn_block_height: burnBlock1.burn_block_height,
      burn_block_time: burnBlock1.burn_block_time,
    };
    const stacksBlock2 = {
      block_height: 2,
      block_time: (blockStartTime += tenMinutes),
      block_hash: '0x1234211111111111111111111111111111111111111111111111111111111111',
      index_block_hash: '0xabcd211111111111111111111111111111111111111111111111111111111111',
      parent_index_block_hash: stacksBlock1.index_block_hash,
      burn_block_hash: burnBlock2.burn_block_hash,
      burn_block_height: burnBlock2.burn_block_height,
      burn_block_time: burnBlock2.burn_block_time,
    };
    const stacksBlock3 = {
      block_height: 3,
      block_time: (blockStartTime += tenMinutes),
      block_hash: '0x1234311111111111111111111111111111111111111111111111111111111111',
      index_block_hash: '0xabcd311111111111111111111111111111111111111111111111111111111111',
      parent_index_block_hash: stacksBlock2.index_block_hash,
      burn_block_hash: burnBlock2.burn_block_hash,
      burn_block_height: burnBlock2.burn_block_height,
      burn_block_time: burnBlock2.burn_block_time,
    };
    const stacksBlock4 = {
      block_height: 4,
      block_time: (blockStartTime += tenMinutes),
      block_hash: '0x1234411111111111111111111111111111111111111111111111111111111111',
      index_block_hash: '0xabcd411111111111111111111111111111111111111111111111111111111111',
      parent_index_block_hash: stacksBlock3.index_block_hash,
      burn_block_hash: burnBlock2.burn_block_hash,
      burn_block_height: burnBlock2.burn_block_height,
      burn_block_time: burnBlock2.burn_block_time,
    };

    const stacksBlocks = [stacksBlock1, stacksBlock2, stacksBlock3, stacksBlock4];

    for (let i = 0; i < stacksBlocks.length; i++) {
      const block = stacksBlocks[i];
      const dbBlock = new TestBlockBuilder({
        block_hash: block.block_hash,
        block_time: block.block_time,
        index_block_hash: block.index_block_hash,
        parent_index_block_hash: block.parent_index_block_hash,
        block_height: block.block_height,
        burn_block_hash: block.burn_block_hash,
        burn_block_height: block.burn_block_height,
        burn_block_time: block.burn_block_time,
      })
        .addTx({ tx_id: `0x${i.toString().padStart(64, '0')}` })
        .build();
      await db.update(dbBlock);
    }

    const result = await supertest(api.server).get(`/extended/v2/burn-blocks`);
    expect(result.body.results).toEqual([
      {
        avg_block_time: tenMinutes,
        burn_block_hash: burnBlock2.burn_block_hash,
        burn_block_height: burnBlock2.burn_block_height,
        burn_block_time: burnBlock2.burn_block_time,
        burn_block_time_iso: unixEpochToIso(burnBlock2.burn_block_time),
        stacks_blocks: [stacksBlock4.block_hash, stacksBlock3.block_hash, stacksBlock2.block_hash],
        total_tx_count: 3,
      },
      {
        avg_block_time: 0,
        burn_block_hash: burnBlock1.burn_block_hash,
        burn_block_height: burnBlock1.burn_block_height,
        burn_block_time: burnBlock1.burn_block_time,
        burn_block_time_iso: unixEpochToIso(burnBlock1.burn_block_time),
        stacks_blocks: [stacksBlock1.block_hash],
        total_tx_count: 1,
      },
    ]);

    // test 'latest' filter
    const result2 = await supertest(api.server).get(`/extended/v2/burn-blocks/latest`);
    expect(result2.body).toEqual({
      avg_block_time: tenMinutes,
      burn_block_hash: stacksBlocks.at(-1)?.burn_block_hash,
      burn_block_height: stacksBlocks.at(-1)?.burn_block_height,
      burn_block_time: stacksBlocks.at(-1)?.burn_block_time,
      burn_block_time_iso: unixEpochToIso(stacksBlocks.at(-1)?.burn_block_time ?? 0),
      stacks_blocks: [stacksBlock4.block_hash, stacksBlock3.block_hash, stacksBlock2.block_hash],
      total_tx_count: 3,
    });

    // test hash filter
    const result3 = await supertest(api.server).get(
      `/extended/v2/burn-blocks/${stacksBlock1.burn_block_hash}`
    );
    expect(result3.body).toEqual({
      avg_block_time: 0,
      burn_block_hash: stacksBlock1.burn_block_hash,
      burn_block_height: stacksBlock1.burn_block_height,
      burn_block_time: stacksBlock1.burn_block_time,
      burn_block_time_iso: unixEpochToIso(stacksBlock1.burn_block_time),
      stacks_blocks: [stacksBlock1.block_hash],
      total_tx_count: 1,
    });

    // test height filter
    const result4 = await supertest(api.server).get(
      `/extended/v2/burn-blocks/${stacksBlock1.burn_block_height}`
    );
    expect(result4.body).toEqual({
      avg_block_time: 0,
      burn_block_hash: stacksBlock1.burn_block_hash,
      burn_block_height: stacksBlock1.burn_block_height,
      burn_block_time: stacksBlock1.burn_block_time,
      burn_block_time_iso: unixEpochToIso(stacksBlock1.burn_block_time),
      stacks_blocks: [stacksBlock1.block_hash],
      total_tx_count: 1,
    });
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
      block_time: 94869287,
      block_time_iso: '1973-01-03T00:34:47.000Z',
      microblocks_accepted: [],
      microblocks_streamed: [
        microblock1.microblocks[0].microblock_hash,
        microblock2.microblocks[0].microblock_hash,
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
      block_time: 94869287,
      block_time_iso: '1973-01-03T00:34:47.000Z',
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
      block_time: 39486,
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
      tx_count: 1,
      signer_bitvec: null,
    };
    const dbTx1: DbTxRaw = {
      ...dbBlock,
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
      anchor_mode: 3,
      nonce: 0,
      raw_tx: bufferToHex(Buffer.from('test-raw-tx')),
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: bufferToHex(Buffer.from('coinbase hi')),
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
      raw_tx: bufferToHex(Buffer.from('test-raw-tx')),
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: bufferToHex(Buffer.from('coinbase hi')),
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
          pox3Events: [],
          pox4Events: [],
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
          pox3Events: [],
          pox4Events: [],
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

  test('blocks v2 filtered by burn block', async () => {
    for (let i = 1; i < 6; i++) {
      const block = new TestBlockBuilder({
        block_height: i,
        block_hash: `0x000${i}`,
        index_block_hash: `0x000${i}`,
        parent_index_block_hash: `0x000${i - 1}`,
        parent_block_hash: `0x000${i - 1}`,
        burn_block_height: 700000,
        burn_block_hash: '0x00000000000000000001e2ee7f0c6bd5361b5e7afd76156ca7d6f524ee5ca3d8',
      })
        .addTx({ tx_id: `0x000${i}` })
        .build();
      await db.update(block);
    }
    for (let i = 6; i < 9; i++) {
      const block = new TestBlockBuilder({
        block_height: i,
        block_hash: `0x000${i}`,
        index_block_hash: `0x000${i}`,
        parent_index_block_hash: `0x000${i - 1}`,
        parent_block_hash: `0x000${i - 1}`,
        burn_block_height: 700001,
        burn_block_hash: '0x000000000000000000028eacd4e6e58405d5a37d06b5d7b93776f1eab68d2494',
      })
        .addTx({ tx_id: `0x001${i}` })
        .build();
      await db.update(block);
    }

    // Filter by burn hash
    const block5 = {
      block_time: 94869287,
      block_time_iso: '1973-01-03T00:34:47.000Z',
      burn_block_hash: '0x00000000000000000001e2ee7f0c6bd5361b5e7afd76156ca7d6f524ee5ca3d8',
      burn_block_height: 700000,
      burn_block_time: 94869286,
      burn_block_time_iso: '1973-01-03T00:34:46.000Z',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      hash: '0x0005',
      height: 5,
      index_block_hash: '0x0005',
      miner_txid: '0x4321',
      parent_block_hash: '0x0004',
      parent_index_block_hash: '0x0004',
      tx_count: 1,
    };
    let fetch = await supertest(api.server).get(
      `/extended/v2/burn-blocks/00000000000000000001e2ee7f0c6bd5361b5e7afd76156ca7d6f524ee5ca3d8/blocks`
    );
    let json = JSON.parse(fetch.text);
    expect(fetch.status).toBe(200);
    expect(json.total).toEqual(5);
    expect(json.results[0]).toStrictEqual(block5);

    // Filter by burn height
    fetch = await supertest(api.server).get(`/extended/v2/burn-blocks/700000/blocks`);
    json = JSON.parse(fetch.text);
    expect(fetch.status).toBe(200);
    expect(json.total).toEqual(5);
    expect(json.results[0]).toStrictEqual(block5);

    // Get latest block
    const block8 = {
      block_time: 94869287,
      block_time_iso: '1973-01-03T00:34:47.000Z',
      burn_block_hash: '0x000000000000000000028eacd4e6e58405d5a37d06b5d7b93776f1eab68d2494',
      burn_block_height: 700001,
      burn_block_time: 94869286,
      burn_block_time_iso: '1973-01-03T00:34:46.000Z',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      hash: '0x0008',
      height: 8,
      index_block_hash: '0x0008',
      miner_txid: '0x4321',
      parent_block_hash: '0x0007',
      parent_index_block_hash: '0x0007',
      tx_count: 1,
    };
    fetch = await supertest(api.server).get(`/extended/v2/burn-blocks/latest/blocks`);
    json = JSON.parse(fetch.text);
    expect(fetch.status).toBe(200);
    expect(json.total).toEqual(3);
    expect(json.results[0]).toStrictEqual(block8);

    // Block hashes are validated
    fetch = await supertest(api.server).get(`/extended/v2/burn-blocks/testvalue/blocks`);
    expect(fetch.status).not.toBe(200);
  });

  test('blocks v2 cursor pagination', async () => {
    for (let i = 1; i <= 14; i++) {
      const block = new TestBlockBuilder({
        block_height: i,
        block_hash: `0x11${i.toString().padStart(62, '0')}`,
        index_block_hash: `0x${i.toString().padStart(64, '0')}`,
        parent_index_block_hash: `0x${(i - 1).toString().padStart(64, '0')}`,
        parent_block_hash: `0x${(i - 1).toString().padStart(64, '0')}`,
        burn_block_height: 700000,
        burn_block_hash: '0x00000000000000000001e2ee7f0c6bd5361b5e7afd76156ca7d6f524ee5ca3d8',
      })
        .addTx({ tx_id: `0x${i.toString().padStart(64, '0')}` })
        .build();
      await db.update(block);
    }

    let body: BlockListV2Response;

    // Fetch latest page
    ({ body } = await supertest(api.server).get(`/extended/v2/blocks?limit=3`));
    expect(body).toEqual(
      expect.objectContaining({
        limit: 3,
        offset: 0,
        total: 14,
        cursor: '0x0000000000000000000000000000000000000000000000000000000000000014',
        next_cursor: null,
        prev_cursor: '0x0000000000000000000000000000000000000000000000000000000000000011',
        results: [
          expect.objectContaining({ height: 14 }),
          expect.objectContaining({ height: 13 }),
          expect.objectContaining({ height: 12 }),
        ],
      })
    );
    const latestPageCursor = body.cursor;
    const latestBlock = body.results[0];

    // Can fetch same page using cursor
    ({ body } = await supertest(api.server).get(
      `/extended/v2/blocks?limit=3&cursor=${body.cursor}`
    ));
    expect(body).toEqual(
      expect.objectContaining({
        limit: 3,
        offset: 0,
        total: 14,
        cursor: '0x0000000000000000000000000000000000000000000000000000000000000014',
        next_cursor: null,
        prev_cursor: '0x0000000000000000000000000000000000000000000000000000000000000011',
        results: [
          expect.objectContaining({ height: 14 }),
          expect.objectContaining({ height: 13 }),
          expect.objectContaining({ height: 12 }),
        ],
      })
    );

    // Fetch previous page
    ({ body } = await supertest(api.server).get(
      `/extended/v2/blocks?limit=3&cursor=${body.prev_cursor}`
    ));
    expect(body).toEqual(
      expect.objectContaining({
        limit: 3,
        offset: 0,
        total: 14,
        cursor: '0x0000000000000000000000000000000000000000000000000000000000000011',
        next_cursor: '0x0000000000000000000000000000000000000000000000000000000000000014',
        prev_cursor: '0x0000000000000000000000000000000000000000000000000000000000000008',
        results: [
          expect.objectContaining({ height: 11 }),
          expect.objectContaining({ height: 10 }),
          expect.objectContaining({ height: 9 }),
        ],
      })
    );

    // Oldest page has no prev_cursor
    ({ body } = await supertest(api.server).get(
      `/extended/v2/blocks?limit=3&cursor=0x0000000000000000000000000000000000000000000000000000000000000002`
    ));
    expect(body).toEqual(
      expect.objectContaining({
        limit: 3,
        offset: 0,
        total: 14,
        cursor: '0x0000000000000000000000000000000000000000000000000000000000000002',
        next_cursor: '0x0000000000000000000000000000000000000000000000000000000000000005',
        prev_cursor: null,
        results: [expect.objectContaining({ height: 2 }), expect.objectContaining({ height: 1 })],
      })
    );

    // Offset + cursor works
    ({ body } = await supertest(api.server).get(
      `/extended/v2/blocks?limit=3&cursor=0x0000000000000000000000000000000000000000000000000000000000000011&offset=2`
    ));
    expect(body).toEqual(
      expect.objectContaining({
        limit: 3,
        offset: 2,
        total: 14,
        cursor: '0x0000000000000000000000000000000000000000000000000000000000000009',
        next_cursor: '0x0000000000000000000000000000000000000000000000000000000000000012',
        prev_cursor: '0x0000000000000000000000000000000000000000000000000000000000000006',
        results: [
          expect.objectContaining({ height: 9 }),
          expect.objectContaining({ height: 8 }),
          expect.objectContaining({ height: 7 }),
        ],
      })
    );

    // Negative offset + cursor
    ({ body } = await supertest(api.server).get(
      `/extended/v2/blocks?limit=3&cursor=0x0000000000000000000000000000000000000000000000000000000000000008&offset=-2`
    ));
    expect(body).toEqual(
      expect.objectContaining({
        limit: 3,
        offset: -2,
        total: 14,
        cursor: '0x0000000000000000000000000000000000000000000000000000000000000010',
        next_cursor: '0x0000000000000000000000000000000000000000000000000000000000000013',
        prev_cursor: '0x0000000000000000000000000000000000000000000000000000000000000007',
        results: [
          expect.objectContaining({ height: 10 }),
          expect.objectContaining({ height: 9 }),
          expect.objectContaining({ height: 8 }),
        ],
      })
    );

    // Offset (no cursor) works, has original behavior
    ({ body } = await supertest(api.server).get(`/extended/v2/blocks?limit=3&offset=5`));
    expect(body).toEqual(
      expect.objectContaining({
        limit: 3,
        offset: 5,
        total: 14,
        cursor: '0x0000000000000000000000000000000000000000000000000000000000000009',
        next_cursor: '0x0000000000000000000000000000000000000000000000000000000000000012',
        prev_cursor: '0x0000000000000000000000000000000000000000000000000000000000000006',
        results: [
          expect.objectContaining({ height: 9 }),
          expect.objectContaining({ height: 8 }),
          expect.objectContaining({ height: 7 }),
        ],
      })
    );

    // Re-org the the cursor for the latest block, should get a 404 on use
    const blockB1 = new TestBlockBuilder({
      block_height: latestBlock.height,
      block_hash: `0x22${latestBlock.height.toString().padStart(62, '0')}`,
      index_block_hash: `0xbb${latestBlock.height.toString().padStart(62, '0')}`,
      parent_index_block_hash: `0x${(latestBlock.height - 1).toString().padStart(64, '0')}`,
      parent_block_hash: `0x${(latestBlock.height - 1).toString().padStart(64, '0')}`,
      burn_block_height: 700000,
      burn_block_hash: '0x00000000000000000001e2ee7f0c6bd5361b5e7afd76156ca7d6f524ee5ca3d8',
    })
      .addTx({ tx_id: `0x${latestBlock.height.toString().padStart(64, '0')}` })
      .build();
    await db.update(blockB1);
    const blockB2 = new TestBlockBuilder({
      block_height: latestBlock.height + 1,
      block_hash: `0x22${(latestBlock.height + 1).toString().padStart(62, '0')}`,
      index_block_hash: `0xbb${(latestBlock.height + 1).toString().padStart(62, '0')}`,
      parent_index_block_hash: `0xbb${latestBlock.height.toString().padStart(62, '0')}`,
      parent_block_hash: `0x${latestBlock.height.toString().padStart(64, '0')}`,
      burn_block_height: 700000,
      burn_block_hash: '0x00000000000000000001e2ee7f0c6bd5361b5e7afd76156ca7d6f524ee5ca3d8',
    })
      .addTx({ tx_id: `0x${(latestBlock.height + 1).toString().padStart(64, '0')}` })
      .build();
    await db.update(blockB2);

    // Should get a 404 when using cursor for re-orged block
    const req = await supertest(api.server).get(
      `/extended/v2/blocks?limit=3&cursor=${latestPageCursor}`
    );
    expect(req.statusCode).toBe(404);

    // Latest page should have the re-org blocks
    ({ body } = await supertest(api.server).get(`/extended/v2/blocks?limit=3`));
    expect(body).toEqual(
      expect.objectContaining({
        limit: 3,
        offset: 0,
        total: 15,
        cursor: '0xbb00000000000000000000000000000000000000000000000000000000000015',
        next_cursor: null,
        prev_cursor: '0x0000000000000000000000000000000000000000000000000000000000000012',
        results: [
          expect.objectContaining({ height: 15 }),
          expect.objectContaining({ height: 14 }),
          expect.objectContaining({ height: 13 }),
        ],
      })
    );
  });

  test('blocks v2 retrieved by hash or height', async () => {
    for (let i = 1; i < 6; i++) {
      const block = new TestBlockBuilder({
        block_height: i,
        block_hash: `0x000000000000000000000000000000000000000000000000000000000000000${i}`,
        index_block_hash: `0x000000000000000000000000000000000000000000000000000000000000011${i}`,
        parent_index_block_hash: `0x000000000000000000000000000000000000000000000000000000000000011${
          i - 1
        }`,
        parent_block_hash: `0x000000000000000000000000000000000000000000000000000000000000000${
          i - 1
        }`,
        burn_block_height: 700000,
        burn_block_hash: '0x00000000000000000001e2ee7f0c6bd5361b5e7afd76156ca7d6f524ee5ca3d8',
      })
        .addTx({ tx_id: `0x000${i}` })
        .build();
      await db.update(block);
    }

    // Get latest
    const block5 = {
      block_time: 94869287,
      block_time_iso: '1973-01-03T00:34:47.000Z',
      burn_block_hash: '0x00000000000000000001e2ee7f0c6bd5361b5e7afd76156ca7d6f524ee5ca3d8',
      burn_block_height: 700000,
      burn_block_time: 94869286,
      burn_block_time_iso: '1973-01-03T00:34:46.000Z',
      canonical: true,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      hash: '0x0000000000000000000000000000000000000000000000000000000000000005',
      height: 5,
      index_block_hash: '0x0000000000000000000000000000000000000000000000000000000000000115',
      miner_txid: '0x4321',
      parent_block_hash: '0x0000000000000000000000000000000000000000000000000000000000000004',
      parent_index_block_hash: '0x0000000000000000000000000000000000000000000000000000000000000114',
      tx_count: 1,
    };
    let fetch = await supertest(api.server).get(`/extended/v2/blocks/latest`);
    let json = JSON.parse(fetch.text);
    expect(fetch.status).toBe(200);
    expect(json).toStrictEqual(block5);

    // Get by height
    fetch = await supertest(api.server).get(`/extended/v2/blocks/5`);
    json = JSON.parse(fetch.text);
    expect(fetch.status).toBe(200);
    expect(json).toStrictEqual(block5);

    // Get by hash
    fetch = await supertest(api.server).get(
      `/extended/v2/blocks/0x0000000000000000000000000000000000000000000000000000000000000005`
    );
    json = JSON.parse(fetch.text);
    expect(fetch.status).toBe(200);
    expect(json).toStrictEqual(block5);

    // Get by index block hash
    fetch = await supertest(api.server).get(
      `/extended/v2/blocks/0x0000000000000000000000000000000000000000000000000000000000000115`
    );
    json = JSON.parse(fetch.text);
    expect(fetch.status).toBe(200);
    expect(json).toStrictEqual(block5);
  });

  test('blocks v2 retrieved by digit-only hash', async () => {
    const block = new TestBlockBuilder({
      block_height: 1,
      block_hash: `0x1111111111111111111111111111111111111111111111111111111111111111`,
      index_block_hash: `0x1111111111111111111111111111111111111111111111111111111111111111`,
      parent_index_block_hash: `0x0000000000000000000000000000000000000000000000000000000000000000`,
      parent_block_hash: `0x0000000000000000000000000000000000000000000000000000000000000000`,
      burn_block_height: 700000,
      burn_block_hash: '0x00000000000000000001e2ee7f0c6bd5361b5e7afd76156ca7d6f524ee5ca3d8',
    }).build();
    await db.update(block);

    // Get by hash
    const fetch = await supertest(api.server).get(
      `/extended/v2/blocks/1111111111111111111111111111111111111111111111111111111111111111`
    );
    const json = JSON.parse(fetch.text);
    expect(fetch.status).toBe(200);
    expect(json.height).toStrictEqual(block.block.block_height);
  });

  test('blocks average time', async () => {
    const blockCount = 50;
    const now = Math.round(Date.now() / 1000);
    const thirtyMinutes = 30 * 60;
    // Return timestamp in seconds for block, latest block will be now(), and previous blocks will be 30 minutes apart
    const timeForBlock = (blockHeight: number) => {
      const blockDistance = blockCount - blockHeight;
      return now - thirtyMinutes * blockDistance;
    };
    for (let i = 1; i <= blockCount; i++) {
      const block = new TestBlockBuilder({
        block_height: i,
        block_time: timeForBlock(i),
        block_hash: `0x${i.toString().padStart(64, '0')}`,
        index_block_hash: `0x11${i.toString().padStart(62, '0')}`,
        parent_index_block_hash: `0x11${(i - 1).toString().padStart(62, '0')}`,
        parent_block_hash: `0x${(i - 1).toString().padStart(64, '0')}`,
        burn_block_height: 700000,
        burn_block_hash: '0x00000000000000000001e2ee7f0c6bd5361b5e7afd76156ca7d6f524ee5ca3d8',
      })
        .addTx({ tx_id: `0x${i.toString().padStart(64, '0')}` })
        .build();
      await db.update(block);
    }

    const fetch = await supertest(api.server).get(`/extended/v2/blocks/average-times`);
    const response = fetch.body;
    expect(fetch.status).toBe(200);

    // All block time averages should be about 30 minutes
    const getRatio = (time: number) =>
      Math.min(thirtyMinutes, time) / Math.max(thirtyMinutes, time);
    expect(getRatio(response.last_1h)).toBeGreaterThanOrEqual(0.9);
    expect(getRatio(response.last_24h)).toBeGreaterThanOrEqual(0.9);
    expect(getRatio(response.last_7d)).toBeGreaterThanOrEqual(0.9);
    expect(getRatio(response.last_30d)).toBeGreaterThanOrEqual(0.9);
  });
});
