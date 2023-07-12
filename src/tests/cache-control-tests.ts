import * as supertest from 'supertest';
import { ChainID } from '@stacks/transactions';
import { getBlockFromDataStore } from '../api/controllers/db-controller';
import { DbBlock, DbMicroblockPartial, DbTxRaw, DbTxStatus, DbTxTypeId } from '../datastore/common';
import { startApiServer, ApiServer } from '../api/init';
import { PoolClient } from 'pg';
import { bufferToHexPrefixString, I32_MAX } from '../helpers';
import { parseIfNoneMatchHeader } from '../api/controllers/cache-controller';
import { TestBlockBuilder, testMempoolTx } from '../test-utils/test-builders';
import { PgWriteStore } from '../datastore/pg-write-store';
import { cycleMigrations, runMigrations } from '../datastore/migrations';
import { PgSqlClient } from '../datastore/connection';

describe('cache-control tests', () => {
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
    api = await startApiServer({ datastore: db, chainId: ChainID.Testnet });
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
    const addr1 = 'ST28D4Q6RCQSJ6F7TEYWQDS4N1RXYEP9YBWMYSB97';
    const addr2 = 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6';

    const block1: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0xdeadbeef',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0xff0011',
      parent_microblock_hash: '0x00',
      parent_microblock_sequence: 0,
      block_height: 1,
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
    const tx: DbTxRaw = {
      tx_id: '0x1234',
      anchor_mode: 3,
      tx_index: 4,
      nonce: 0,
      raw_tx: '',
      index_block_hash: block1.index_block_hash,
      block_hash: block1.block_hash,
      block_height: 68456,
      burn_block_time: 1594647995,
      parent_burn_block_time: 1626122935,
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
      post_conditions: '',
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
    await db.update({
      block: block1,
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
          names: [],
          namespaces: [],
          smartContracts: [],
          pox2Events: [],
          pox3Events: [],
        },
      ],
    });

    const blockQuery = await getBlockFromDataStore({
      blockIdentifer: { hash: block1.block_hash },
      db,
    });
    if (!blockQuery.found) {
      throw new Error('block not found');
    }

    const expectedResp1 = {
      burn_block_time: 1594647996,
      burn_block_time_iso: '2020-07-13T13:46:36.000Z',
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      hash: '0x1234',
      index_block_hash: '0xdeadbeef',
      height: 1,
      parent_block_hash: '0xff0011',
      parent_microblock_hash: '0x00',
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

    expect(blockQuery.result).toEqual(expectedResp1);

    const fetchBlockByHash1 = await supertest(api.server).get(
      `/extended/v1/block/${block1.block_hash}`
    );
    expect(fetchBlockByHash1.status).toBe(200);
    expect(fetchBlockByHash1.type).toBe('application/json');
    expect(JSON.parse(fetchBlockByHash1.text)).toEqual(expectedResp1);
    expect(fetchBlockByHash1.headers['etag']).toBe(`"${block1.index_block_hash}"`);

    const fetchBlockByHashCached1 = await supertest(api.server)
      .get(`/extended/v1/block/${block1.block_hash}`)
      .set('If-None-Match', `"${block1.index_block_hash}"`);
    expect(fetchBlockByHashCached1.status).toBe(304);
    expect(fetchBlockByHashCached1.text).toBe('');

    const fetchBlockByHashCacheMiss = await supertest(api.server)
      .get(`/extended/v1/block/${block1.block_hash}`)
      .set('If-None-Match', '"0x12345678"');
    expect(fetchBlockByHashCacheMiss.status).toBe(200);
    expect(fetchBlockByHashCacheMiss.type).toBe('application/json');
    expect(JSON.parse(fetchBlockByHashCacheMiss.text)).toEqual(expectedResp1);
    expect(fetchBlockByHashCacheMiss.headers['etag']).toBe(`"${block1.index_block_hash}"`);

    const fetchBlockByHeight = await supertest(api.server).get(
      `/extended/v1/block/by_height/${block1.block_height}`
    );
    expect(fetchBlockByHeight.status).toBe(200);
    expect(fetchBlockByHeight.type).toBe('application/json');
    expect(JSON.parse(fetchBlockByHeight.text)).toEqual(expectedResp1);
    expect(fetchBlockByHeight.headers['etag']).toBe(`"${block1.index_block_hash}"`);

    const fetchBlockByHeightCached = await supertest(api.server)
      .get(`/extended/v1/block/by_height/${block1.block_height}`)
      .set('If-None-Match', `"${block1.index_block_hash}"`);
    expect(fetchBlockByHeightCached.status).toBe(304);
    expect(fetchBlockByHeightCached.text).toBe('');

    const fetchBlockByHeightCacheMiss = await supertest(api.server)
      .get(`/extended/v1/block/by_height/${block1.block_height}`)
      .set('If-None-Match', '"0x12345678"');
    expect(fetchBlockByHashCacheMiss.status).toBe(200);
    expect(fetchBlockByHeightCacheMiss.type).toBe('application/json');
    expect(JSON.parse(fetchBlockByHeightCacheMiss.text)).toEqual(expectedResp1);
    expect(fetchBlockByHeightCacheMiss.headers['etag']).toBe(`"${block1.index_block_hash}"`);

    const fetchStxSupplyResp1 = expect.objectContaining({ total_stx: expect.any(String) });
    const fetchStxSupply = await supertest(api.server).get(`/extended/v1/stx_supply`);
    expect(fetchStxSupply.type).toBe('application/json');
    expect(fetchStxSupply.body).toEqual(fetchStxSupplyResp1);
    expect(fetchStxSupply.headers['etag']).toBe(`"${block1.index_block_hash}"`);

    const fetchStxSupplyCached = await supertest(api.server)
      .get(`/extended/v1/stx_supply`)
      .set('If-None-Match', `"${block1.index_block_hash}"`);
    expect(fetchStxSupplyCached.status).toBe(304);
    expect(fetchStxSupplyCached.text).toBe('');

    const fetchStxSupplyCacheMiss = await supertest(api.server)
      .get(`/extended/v1/stx_supply`)
      .set('If-None-Match', '"0x12345678"');
    expect(fetchStxSupplyCacheMiss.status).toBe(200);
    expect(fetchStxSupplyCacheMiss.type).toBe('application/json');
    expect(fetchStxSupplyCacheMiss.body).toEqual(fetchStxSupplyResp1);
    expect(fetchStxSupplyCacheMiss.headers['etag']).toBe(`"${block1.index_block_hash}"`);

    const mb1: DbMicroblockPartial = {
      microblock_hash: '0xff01',
      microblock_sequence: 0,
      microblock_parent_hash: block1.block_hash,
      parent_index_block_hash: block1.index_block_hash,
      parent_burn_block_height: 123,
      parent_burn_block_hash: '0xaa',
      parent_burn_block_time: 1626122935,
    };
    const mbTx1: DbTxRaw = {
      tx_id: '0x02',
      tx_index: 0,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: '',
      type_id: DbTxTypeId.TokenTransfer,
      status: 1,
      raw_result: '0x0100000000000000000000000000000001', // u1
      canonical: true,
      post_conditions: '',
      fee_rate: 1234n,
      sponsored: false,
      sender_address: addr1,
      sponsor_address: undefined,
      origin_hash_mode: 1,
      token_transfer_amount: 50n,
      token_transfer_memo: bufferToHexPrefixString(Buffer.from('hi')),
      token_transfer_recipient_address: addr2,
      event_count: 1,
      parent_index_block_hash: block1.index_block_hash,
      parent_block_hash: block1.block_hash,
      microblock_canonical: true,
      microblock_sequence: mb1.microblock_sequence,
      microblock_hash: mb1.microblock_hash,
      parent_burn_block_time: mb1.parent_burn_block_time,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,

      // These properties aren't known until the next anchor block that accepts this microblock.
      index_block_hash: '',
      block_hash: '',
      burn_block_time: -1,

      // These properties can be determined with a db query, they are set while the db is inserting them.
      block_height: -1,
    };

    await db.updateMicroblocks({
      microblocks: [mb1],
      txs: [
        {
          tx: mbTx1,
          stxLockEvents: [],
          stxEvents: [],
          ftEvents: [],
          nftEvents: [],
          contractLogEvents: [],
          smartContracts: [],
          names: [],
          namespaces: [],
          pox2Events: [],
          pox3Events: [],
        },
      ],
    });

    const chainTip2 = await db.getUnanchoredChainTip();
    expect(chainTip2.found).toBeTruthy();
    expect(chainTip2.result?.blockHash).toBe(block1.block_hash);
    expect(chainTip2.result?.blockHeight).toBe(block1.block_height);
    expect(chainTip2.result?.indexBlockHash).toBe(block1.index_block_hash);
    expect(chainTip2.result?.microblockHash).toBe(mb1.microblock_hash);
    expect(chainTip2.result?.microblockSequence).toBe(mb1.microblock_sequence);

    const expectedResp2 = {
      burn_block_time: 1594647996,
      burn_block_time_iso: '2020-07-13T13:46:36.000Z',
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      hash: '0x1234',
      index_block_hash: '0xdeadbeef',
      height: 1,
      parent_block_hash: '0xff0011',
      parent_microblock_hash: '0x00',
      parent_microblock_sequence: 0,
      txs: ['0x1234'],
      microblocks_accepted: [],
      microblocks_streamed: ['0xff01'],
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      microblock_tx_count: {},
    };

    const fetchBlockByHash2 = await supertest(api.server).get(
      `/extended/v1/block/${block1.block_hash}`
    );
    expect(fetchBlockByHash2.status).toBe(200);
    expect(fetchBlockByHash2.type).toBe('application/json');
    expect(JSON.parse(fetchBlockByHash2.text)).toEqual(expectedResp2);
    expect(fetchBlockByHash2.headers['etag']).toBe(`"${mb1.microblock_hash}"`);

    const fetchBlockByHashCached2 = await supertest(api.server)
      .get(`/extended/v1/block/${block1.block_hash}`)
      .set('If-None-Match', `"${mb1.microblock_hash}"`);
    expect(fetchBlockByHashCached2.status).toBe(304);
    expect(fetchBlockByHashCached2.text).toBe('');
  });

  test('mempool digest cache control', async () => {
    const block1 = new TestBlockBuilder({
      block_height: 1,
      index_block_hash: '0x01',
    })
      .addTx({ tx_id: '0x0001' })
      .build();
    await db.update(block1);

    // ETag zero.
    const request1 = await supertest(api.server).get('/extended/v1/tx/mempool');
    expect(request1.status).toBe(200);
    expect(request1.type).toBe('application/json');
    expect(request1.headers['etag']).toEqual('"0"');

    // Add mempool txs.
    const mempoolTx1 = testMempoolTx({ tx_id: '0x1101' });
    const mempoolTx2 = testMempoolTx({ tx_id: '0x1102' });
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx1, mempoolTx2] });

    // Valid ETag.
    const request2 = await supertest(api.server).get('/extended/v1/tx/mempool');
    expect(request2.status).toBe(200);
    expect(request2.type).toBe('application/json');
    expect(request2.headers['etag']).toBeTruthy();
    const etag1 = request2.headers['etag'];

    // Cache works with valid ETag.
    const request3 = await supertest(api.server)
      .get('/extended/v1/tx/mempool')
      .set('If-None-Match', etag1);
    expect(request3.status).toBe(304);
    expect(request3.text).toBe('');

    // Drop one tx.
    await db.dropMempoolTxs({ status: DbTxStatus.DroppedReplaceByFee, txIds: ['0x1101'] });

    // Cache is now a miss.
    const request4 = await supertest(api.server)
      .get('/extended/v1/tx/mempool')
      .set('If-None-Match', etag1);
    expect(request4.status).toBe(200);
    expect(request4.type).toBe('application/json');
    expect(request4.headers['etag'] !== etag1).toEqual(true);
    const etag2 = request4.headers['etag'];

    // Prune the other tx from the mempool by confirming it into a block.
    const block2 = new TestBlockBuilder({
      block_height: 2,
      index_block_hash: '0x02',
      parent_index_block_hash: '0x01',
    })
      .addTx({ tx_id: '0x1102' })
      .build();
    await db.update(block2);

    // Cache is now a miss and ETag is zero because mempool is empty.
    const request5 = await supertest(api.server)
      .get('/extended/v1/tx/mempool')
      .set('If-None-Match', etag2);
    expect(request5.status).toBe(200);
    expect(request5.type).toBe('application/json');
    expect(request5.headers['etag']).toEqual('"0"');
    const etag3 = request5.headers['etag'];

    // Restore a tx back into the mempool by making its anchor block non-canonical.
    const block2b = new TestBlockBuilder({
      block_height: 2,
      index_block_hash: '0x02bb',
      parent_index_block_hash: '0x01',
    })
      .addTx({ tx_id: '0x0002' })
      .build();
    await db.update(block2b);
    const block3 = new TestBlockBuilder({
      block_height: 3,
      index_block_hash: '0x03',
      parent_index_block_hash: '0x02bb',
    })
      .addTx({ tx_id: '0x0003' })
      .build();
    await db.update(block3);

    // Cache is now a miss and ETag is non-zero because mempool is not empty.
    const request6 = await supertest(api.server)
      .get('/extended/v1/tx/mempool')
      .set('If-None-Match', etag3);
    expect(request6.status).toBe(200);
    expect(request6.type).toBe('application/json');
    expect(request6.headers['etag']).toEqual(etag2);
    const etag4 = request6.headers['etag'];

    // Garbage collect all txs.
    process.env.STACKS_MEMPOOL_TX_GARBAGE_COLLECTION_THRESHOLD = '0';
    const block4 = new TestBlockBuilder({
      block_height: 4,
      index_block_hash: '0x04',
      parent_index_block_hash: '0x03',
    })
      .addTx({ tx_id: '0x0004' })
      .build();
    await db.update(block4);

    // ETag zero once again.
    const request7 = await supertest(api.server)
      .get('/extended/v1/tx/mempool')
      .set('If-None-Match', etag4);
    expect(request7.status).toBe(200);
    expect(request7.type).toBe('application/json');
    expect(request7.headers['etag']).toEqual('"0"');

    // Simulate an incompatible pg version (without `bit_xor`).
    await client.begin(async sql => {
      await sql`DROP MATERIALIZED VIEW mempool_digest`;
      await sql`CREATE MATERIALIZED VIEW mempool_digest AS (SELECT NULL AS digest)`;
    });

    // ETag is undefined as if mempool cache did not exist.
    const request8 = await supertest(api.server).get('/extended/v1/tx/mempool');
    expect(request8.status).toBe(200);
    expect(request8.type).toBe('application/json');
    expect(request8.headers['etag']).toBeUndefined();
  });

  test('transaction cache control', async () => {
    const txId1 = '0x0153a41ed24a0e1d32f66ea98338df09f942571ca66359e28bdca79ccd0305cf';
    const txId2 = '0xfb4bfc274007825dfd2d8f6c3f429407016779e9954775f82129108282d4c4ce';

    const block1 = new TestBlockBuilder({
      block_height: 1,
      index_block_hash: '0x01',
    })
      .addTx()
      .build();
    await db.update(block1);

    // No tx yet.
    const request1 = await supertest(api.server).get(`/extended/v1/tx/${txId1}`);
    expect(request1.status).toBe(404);
    expect(request1.type).toBe('application/json');

    // Add mempool tx.
    const mempoolTx1 = testMempoolTx({ tx_id: txId1 });
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx1] });

    // Valid mempool ETag.
    const request2 = await supertest(api.server).get(`/extended/v1/tx/${txId1}`);
    expect(request2.status).toBe(200);
    expect(request2.type).toBe('application/json');
    expect(request2.headers['etag']).toBeTruthy();
    const etag1 = request2.headers['etag'];

    // Cache works with valid ETag.
    const request3 = await supertest(api.server)
      .get(`/extended/v1/tx/${txId1}`)
      .set('If-None-Match', etag1);
    expect(request3.status).toBe(304);
    expect(request3.text).toBe('');

    // Mine the same tx into a block
    const block2 = new TestBlockBuilder({
      block_height: 2,
      index_block_hash: '0x02',
      parent_index_block_hash: '0x01',
    })
      .addTx({ tx_id: txId1 })
      .build();
    await db.update(block2);

    // Cache no longer works with mempool ETag but we get updated ETag.
    const request4 = await supertest(api.server)
      .get(`/extended/v1/tx/${txId1}`)
      .set('If-None-Match', etag1);
    expect(request4.status).toBe(200);
    expect(request4.headers['etag']).toBeTruthy();
    const etag2 = request4.headers['etag'];

    // Cache works with new ETag.
    const request5 = await supertest(api.server)
      .get(`/extended/v1/tx/${txId1}`)
      .set('If-None-Match', etag2);
    expect(request5.status).toBe(304);
    expect(request5.text).toBe('');

    // No tx #2 yet.
    const request6 = await supertest(api.server).get(`/extended/v1/tx/${txId2}`);
    expect(request6.status).toBe(404);
    expect(request6.type).toBe('application/json');

    // Tx #2 directly into a block
    const block3 = new TestBlockBuilder({
      block_height: 3,
      index_block_hash: '0x03',
      parent_index_block_hash: '0x02',
    })
      .addTx({ tx_id: txId2 })
      .build();
    await db.update(block3);

    // Valid block ETag.
    const request7 = await supertest(api.server).get(`/extended/v1/tx/${txId2}`);
    expect(request7.status).toBe(200);
    expect(request7.type).toBe('application/json');
    expect(request7.headers['etag']).toBeTruthy();
    const etag3 = request7.headers['etag'];

    // Cache works with valid ETag.
    const request8 = await supertest(api.server)
      .get(`/extended/v1/tx/${txId2}`)
      .set('If-None-Match', etag3);
    expect(request8.status).toBe(304);
    expect(request8.text).toBe('');

    // Oops, new blocks came, all txs before are non-canonical
    const block2a = new TestBlockBuilder({
      block_height: 2,
      index_block_hash: '0x02ff',
      parent_index_block_hash: '0x01',
    })
      .addTx({ tx_id: '0x1111' })
      .build();
    await db.update(block2a);
    const block3a = new TestBlockBuilder({
      block_height: 3,
      index_block_hash: '0x03ff',
      parent_index_block_hash: '0x02ff',
    })
      .addTx({ tx_id: '0x1112' })
      .build();
    await db.update(block3a);
    const block4 = new TestBlockBuilder({
      block_height: 4,
      index_block_hash: '0x04',
      parent_index_block_hash: '0x03ff',
    })
      .addTx({ tx_id: '0x1113' })
      .build();
    await db.update(block4);

    // Cache no longer works for tx #1.
    const request9 = await supertest(api.server)
      .get(`/extended/v1/tx/${txId1}`)
      .set('If-None-Match', etag2);
    expect(request9.status).toBe(200);
    expect(request9.headers['etag']).toBeTruthy();
    const etag4 = request9.headers['etag'];

    // Cache works again with new ETag.
    const request10 = await supertest(api.server)
      .get(`/extended/v1/tx/${txId1}`)
      .set('If-None-Match', etag4);
    expect(request10.status).toBe(304);
    expect(request10.text).toBe('');

    // Mine tx in a new block
    const block5 = new TestBlockBuilder({
      block_height: 5,
      index_block_hash: '0x05',
      parent_index_block_hash: '0x04',
    })
      .addTx({ tx_id: txId1 })
      .build();
    await db.update(block5);

    // Make sure old cache for confirmed tx doesn't work, because the index_block_hash has changed.
    const request11 = await supertest(api.server)
      .get(`/extended/v1/tx/${txId1}`)
      .set('If-None-Match', etag2);
    expect(request11.status).toBe(200);
    expect(request11.headers['etag']).toBeTruthy();
    const etag5 = request11.headers['etag'];
    expect(etag2).not.toBe(etag5);
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
