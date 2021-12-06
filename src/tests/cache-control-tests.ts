import * as supertest from 'supertest';
import { ChainID } from '@stacks/transactions';
import { getBlockFromDataStore } from '../api/controllers/db-controller';
import { DbBlock, DbTx, DbTxTypeId } from '../datastore/common';
import { startApiServer, ApiServer } from '../api/init';
import { PgDataStore, cycleMigrations, runMigrations } from '../datastore/postgres-store';
import { PoolClient } from 'pg';
import { I32_MAX } from '../helpers';
import { parseIfNoneMatchHeader } from '../api/controllers/cache-controller';

describe('cache-control tests', () => {
  let db: PgDataStore;
  let client: PoolClient;
  let api: ApiServer;

  beforeEach(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgDataStore.connect();
    client = await db.pool.connect();
    api = await startApiServer({ datastore: db, chainId: ChainID.Testnet, httpLogLevel: 'silly' });
  });

  test('parse if-none-match header', () => {
    // Test various combinations of etags with and without weak-validation prefix, with and without
    // wrapping quotes, without and without spaces after commas.
    const vectors: {
      input: string | undefined;
      output: string[] | undefined;
    }[] = [
      { input: '""', output: undefined },
      { input: '', output: undefined },
      { input: undefined, output: undefined },
      {
        input: '"bfc13a64729c4290ef5b2c2730249c88ca92d82d"',
        output: ['bfc13a64729c4290ef5b2c2730249c88ca92d82d'],
      },
      { input: 'W/"67ab43", "54ed21", "7892dd"', output: ['67ab43', '54ed21', '7892dd'] },
      { input: '"fail space" ', output: ['fail space'] },
      { input: 'W/"5e15153d-120f"', output: ['5e15153d-120f'] },
      {
        input: '"<etag_value>", "<etag_value>" , "asdf"',
        output: ['<etag_value>', '<etag_value>', 'asdf'],
      },
      {
        input: '"<etag_value>","<etag_value>","asdf"',
        output: ['<etag_value>', '<etag_value>', 'asdf'],
      },
      {
        input: 'W/"<etag_value>","<etag_value>","asdf"',
        output: ['<etag_value>', '<etag_value>', 'asdf'],
      },
      {
        input: '"<etag_value>",W/"<etag_value>", W/"asdf", "abcd","123"',
        output: ['<etag_value>', '<etag_value>', 'asdf', 'abcd', '123'],
      },
    ];
    expect(vectors).toBeTruthy();
    for (const entry of vectors) {
      const result = parseIfNoneMatchHeader(entry.input);
      expect(result).toEqual(entry.output);
    }
  });

  test('block chaintip cache control', async () => {
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
    const tx: DbTx = {
      tx_id: '0x1234',
      anchor_mode: 3,
      tx_index: 4,
      nonce: 0,
      raw_tx: Buffer.alloc(0),
      index_block_hash: block.index_block_hash,
      block_hash: block.block_hash,
      block_height: 68456,
      burn_block_time: 1594647995,
      parent_burn_block_time: 1626122935,
      type_id: DbTxTypeId.Coinbase,
      coinbase_payload: Buffer.from('coinbase hi'),
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      microblock_canonical: true,
      microblock_sequence: I32_MAX,
      microblock_hash: '',
      parent_index_block_hash: '',
      parent_block_hash: '',
      post_conditions: Buffer.from([0x01, 0xf5]),
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
      parent_block_hash: '0xff0011',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      txs: ['0x1234'],
      microblocks_accepted: [],
      microblocks_streamed: [],
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };

    expect(blockQuery.result).toEqual(expectedResp);

    const fetchBlockByHash = await supertest(api.server).get(
      `/extended/v1/block/${block.block_hash}`
    );
    expect(fetchBlockByHash.status).toBe(200);
    expect(fetchBlockByHash.type).toBe('application/json');
    expect(JSON.parse(fetchBlockByHash.text)).toEqual(expectedResp);
    expect(fetchBlockByHash.headers['etag']).toBe('"0xdeadbeef"');

    const fetchBlockByHashCached = await supertest(api.server)
      .get(`/extended/v1/block/${block.block_hash}`)
      .set('If-None-Match', '"0xdeadbeef"');
    expect(fetchBlockByHashCached.status).toBe(304);
    expect(fetchBlockByHashCached.text).toBe('');

    const fetchBlockByHashCacheMiss = await supertest(api.server)
      .get(`/extended/v1/block/${block.block_hash}`)
      .set('If-None-Match', '"0x12345678"');
    expect(fetchBlockByHashCacheMiss.type).toBe('application/json');
    expect(JSON.parse(fetchBlockByHashCacheMiss.text)).toEqual(expectedResp);
    expect(fetchBlockByHashCacheMiss.headers['etag']).toBe('"0xdeadbeef"');

    const fetchBlockByHeight = await supertest(api.server).get(
      `/extended/v1/block/by_height/${block.block_height}`
    );
    expect(fetchBlockByHeight.status).toBe(200);
    expect(fetchBlockByHeight.type).toBe('application/json');
    expect(JSON.parse(fetchBlockByHeight.text)).toEqual(expectedResp);
    expect(fetchBlockByHeight.headers['etag']).toBe('"0xdeadbeef"');

    const fetchBlockByHeightCached = await supertest(api.server)
      .get(`/extended/v1/block/by_height/${block.block_height}`)
      .set('If-None-Match', '"0xdeadbeef"');
    expect(fetchBlockByHeightCached.status).toBe(304);
    expect(fetchBlockByHeightCached.text).toBe('');

    const fetchBlockByHeightCacheMiss = await supertest(api.server)
      .get(`/extended/v1/block/by_height/${block.block_height}`)
      .set('If-None-Match', '"0x12345678"');
    expect(fetchBlockByHeightCacheMiss.type).toBe('application/json');
    expect(JSON.parse(fetchBlockByHeightCacheMiss.text)).toEqual(expectedResp);
    expect(fetchBlockByHeightCacheMiss.headers['etag']).toBe('"0xdeadbeef"');
  });

  afterEach(async () => {
    await api.terminate();
    client.release();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
