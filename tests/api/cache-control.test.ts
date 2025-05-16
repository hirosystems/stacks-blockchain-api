import * as supertest from 'supertest';
import { ChainID } from '@stacks/transactions';
import { getBlockFromDataStore } from '../../src/api/controllers/db-controller';
import {
  DbBlock,
  DbMicroblockPartial,
  DbTxRaw,
  DbTxStatus,
  DbTxTypeId,
} from '../../src/datastore/common';
import { startApiServer, ApiServer } from '../../src/api/init';
import { I32_MAX } from '../../src/helpers';
import { TestBlockBuilder, testMempoolTx } from '../utils/test-builders';
import { PgWriteStore } from '../../src/datastore/pg-write-store';
import { bufferToHex } from '@hirosystems/api-toolkit';
import { migrate } from '../utils/test-helpers';

describe('cache-control tests', () => {
  let db: PgWriteStore;
  let api: ApiServer;

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    api = await startApiServer({ datastore: db, chainId: ChainID.Testnet });
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await migrate('down');
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
      tenure_height: 1,
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
      tx_total_size: 1,
      signer_bitvec: null,
      signer_signatures: null,
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
      block_time: 1594647995,
      burn_block_height: 68456,
      burn_block_time: 1594647995,
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
      vm_error: null,
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
          pox4Events: [],
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
      block_time: 1594647996,
      block_time_iso: '2020-07-13T13:46:36.000Z',
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

    expect(blockQuery.result).toMatchObject(expectedResp1);

    const fetchBlockByHash1 = await supertest(api.server).get(
      `/extended/v1/block/${block1.block_hash}`
    );
    expect(fetchBlockByHash1.status).toBe(200);
    expect(fetchBlockByHash1.type).toBe('application/json');
    expect(JSON.parse(fetchBlockByHash1.text)).toMatchObject(expectedResp1);
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
    expect(JSON.parse(fetchBlockByHashCacheMiss.text)).toMatchObject(expectedResp1);
    expect(fetchBlockByHashCacheMiss.headers['etag']).toBe(`"${block1.index_block_hash}"`);

    const fetchBlockByHeight = await supertest(api.server).get(
      `/extended/v1/block/by_height/${block1.block_height}`
    );
    expect(fetchBlockByHeight.status).toBe(200);
    expect(fetchBlockByHeight.type).toBe('application/json');
    expect(JSON.parse(fetchBlockByHeight.text)).toMatchObject(expectedResp1);
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
    expect(JSON.parse(fetchBlockByHeightCacheMiss.text)).toMatchObject(expectedResp1);
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
      token_transfer_memo: bufferToHex(Buffer.from('hi')),
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
      burn_block_height: -1,
      block_time: -1,

      // These properties can be determined with a db query, they are set while the db is inserting them.
      block_height: -1,
      vm_error: null,
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
          pox4Events: [],
        },
      ],
    });

    const chainTip2 = await db.getChainTip(db.sql);
    expect(chainTip2.block_hash).toBe(block1.block_hash);
    expect(chainTip2.block_height).toBe(block1.block_height);
    expect(chainTip2.index_block_hash).toBe(block1.index_block_hash);
    expect(chainTip2.microblock_hash).toBe(mb1.microblock_hash);
    expect(chainTip2.microblock_sequence).toBe(mb1.microblock_sequence);

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
      block_time: 1594647996,
      block_time_iso: '2020-07-13T13:46:36.000Z',
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
    expect(JSON.parse(fetchBlockByHash2.text)).toMatchObject(expectedResp2);
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
    const etag0 = request1.headers['etag'];

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
    expect(etag1).not.toEqual(etag0);

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

    // Cache is now a miss.
    const request5 = await supertest(api.server)
      .get('/extended/v1/tx/mempool')
      .set('If-None-Match', etag2);
    expect(request5.status).toBe(200);
    expect(request5.type).toBe('application/json');
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
    expect(request6.headers['etag']).not.toEqual(etag3);
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

    // ETag changes once again.
    const request7 = await supertest(api.server)
      .get('/extended/v1/tx/mempool')
      .set('If-None-Match', etag4);
    expect(request7.status).toBe(200);
    expect(request7.type).toBe('application/json');
    expect(request7.headers['etag']).not.toEqual(etag4);
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

  test('principal cache control', async () => {
    const sender_address = 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6';
    const url = `/extended/v2/addresses/${sender_address}/transactions`;
    await db.update(
      new TestBlockBuilder({
        block_height: 1,
        index_block_hash: '0x01',
        parent_index_block_hash: '0x00',
      }).build()
    );

    // ETag zero.
    const request1 = await supertest(api.server).get(url);
    expect(request1.status).toBe(200);
    expect(request1.type).toBe('application/json');
    const etag0 = request1.headers['etag'];

    // Add STX txs.
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        index_block_hash: '0x02',
        parent_index_block_hash: '0x01',
      })
        .addTx({ tx_id: '0x0001', sender_address, token_transfer_amount: 200n })
        .addTxStxEvent({ sender: sender_address, amount: 200n })
        .build()
    );

    // Valid ETag.
    const request2 = await supertest(api.server).get(url);
    expect(request2.status).toBe(200);
    expect(request2.type).toBe('application/json');
    expect(request2.headers['etag']).toBeTruthy();
    const etag1 = request2.headers['etag'];
    expect(etag1).not.toEqual(etag0);

    // Cache works with valid ETag.
    const request3 = await supertest(api.server).get(url).set('If-None-Match', etag1);
    expect(request3.status).toBe(304);
    expect(request3.text).toBe('');

    // Add FT tx.
    await db.update(
      new TestBlockBuilder({
        block_height: 3,
        index_block_hash: '0x03',
        parent_index_block_hash: '0x02',
      })
        .addTx({ tx_id: '0x0002' })
        .addTxFtEvent({ recipient: sender_address })
        .build()
    );

    // Cache is now a miss.
    const request4 = await supertest(api.server).get(url).set('If-None-Match', etag1);
    expect(request4.status).toBe(200);
    expect(request4.type).toBe('application/json');
    expect(request4.headers['etag']).not.toEqual(etag1);
    const etag2 = request4.headers['etag'];

    // Cache works with new ETag.
    const request5 = await supertest(api.server).get(url).set('If-None-Match', etag2);
    expect(request5.status).toBe(304);
    expect(request5.text).toBe('');

    // Add NFT tx.
    await db.update(
      new TestBlockBuilder({
        block_height: 4,
        index_block_hash: '0x04',
        parent_index_block_hash: '0x03',
      })
        .addTx({ tx_id: '0x0003' })
        .addTxNftEvent({ recipient: sender_address })
        .build()
    );

    // Cache is now a miss.
    const request6 = await supertest(api.server).get(url).set('If-None-Match', etag2);
    expect(request6.status).toBe(200);
    expect(request6.type).toBe('application/json');
    expect(request6.headers['etag']).not.toEqual(etag2);
    const etag3 = request6.headers['etag'];

    // Cache works with new ETag.
    const request7 = await supertest(api.server).get(url).set('If-None-Match', etag3);
    expect(request7.status).toBe(304);
    expect(request7.text).toBe('');

    // Add sponsored tx.
    await db.update(
      new TestBlockBuilder({
        block_height: 5,
        index_block_hash: '0x05',
        parent_index_block_hash: '0x04',
      })
        .addTx({ tx_id: '0x0004', sponsor_address: sender_address })
        .build()
    );

    // Cache is now a miss.
    const request8 = await supertest(api.server).get(url).set('If-None-Match', etag2);
    expect(request8.status).toBe(200);
    expect(request8.type).toBe('application/json');
    expect(request8.headers['etag']).not.toEqual(etag3);
    const etag4 = request8.headers['etag'];

    // Cache works with new ETag.
    const request9 = await supertest(api.server).get(url).set('If-None-Match', etag4);
    expect(request9.status).toBe(304);
    expect(request9.text).toBe('');

    // Advance chain with no changes to this address.
    await db.update(
      new TestBlockBuilder({
        block_height: 6,
        index_block_hash: '0x06',
        parent_index_block_hash: '0x05',
      }).build()
    );

    // Cache still works.
    const request10 = await supertest(api.server).get(url).set('If-None-Match', etag4);
    expect(request10.status).toBe(304);
    expect(request10.text).toBe('');
  });

  test('principal mempool cache control', async () => {
    const sender_address = 'SP3FXEKSA6D4BW3TFP2BWTSREV6FY863Y90YY7D8G';
    const url = `/extended/v1/address/${sender_address}/mempool`;
    await db.update(
      new TestBlockBuilder({
        block_height: 1,
        index_block_hash: '0x01',
        parent_index_block_hash: '0x00',
      }).build()
    );

    // ETag zero.
    const request1 = await supertest(api.server).get(url);
    expect(request1.status).toBe(200);
    expect(request1.type).toBe('application/json');
    const etag0 = request1.headers['etag'];

    // Add STX tx.
    await db.updateMempoolTxs({
      mempoolTxs: [testMempoolTx({ tx_id: '0x0001', receipt_time: 1000, sender_address })],
    });

    // Valid ETag.
    const request2 = await supertest(api.server).get(url);
    expect(request2.status).toBe(200);
    expect(request2.type).toBe('application/json');
    expect(request2.headers['etag']).toBeTruthy();
    const etag1 = request2.headers['etag'];
    expect(etag1).not.toEqual(etag0);

    // Cache works with valid ETag.
    const request3 = await supertest(api.server).get(url).set('If-None-Match', etag1);
    expect(request3.status).toBe(304);
    expect(request3.text).toBe('');

    // Add sponsor tx.
    await db.updateMempoolTxs({
      mempoolTxs: [
        testMempoolTx({ tx_id: '0x0002', receipt_time: 2000, sponsor_address: sender_address }),
      ],
    });

    // Cache is now a miss.
    const request4 = await supertest(api.server).get(url).set('If-None-Match', etag1);
    expect(request4.status).toBe(200);
    expect(request4.type).toBe('application/json');
    expect(request4.headers['etag']).not.toEqual(etag1);
    const etag2 = request4.headers['etag'];

    // Cache works with new ETag.
    const request5 = await supertest(api.server).get(url).set('If-None-Match', etag2);
    expect(request5.status).toBe(304);
    expect(request5.text).toBe('');

    // Add token recipient tx.
    await db.updateMempoolTxs({
      mempoolTxs: [
        testMempoolTx({
          tx_id: '0x0003',
          receipt_time: 3000,
          token_transfer_recipient_address: sender_address,
        }),
      ],
    });

    // Cache is now a miss.
    const request6 = await supertest(api.server).get(url).set('If-None-Match', etag2);
    expect(request6.status).toBe(200);
    expect(request6.type).toBe('application/json');
    expect(request6.headers['etag']).not.toEqual(etag2);
    const etag3 = request6.headers['etag'];

    // Cache works with new ETag.
    const request7 = await supertest(api.server).get(url).set('If-None-Match', etag3);
    expect(request7.status).toBe(304);
    expect(request7.text).toBe('');

    // Change mempool with no changes to this address.
    await db.updateMempoolTxs({
      mempoolTxs: [testMempoolTx({ tx_id: '0x0004', receipt_time: 4000 })],
    });

    // Cache still works.
    const request8 = await supertest(api.server).get(url).set('If-None-Match', etag3);
    expect(request8.status).toBe(304);
    expect(request8.text).toBe('');
  });

  test('principal mempool cache on received tx balance confirmation', async () => {
    const address = 'SP3FXEKSA6D4BW3TFP2BWTSREV6FY863Y90YY7D8G';
    const url = `/extended/v1/address/${address}/balances`;
    await db.update(
      new TestBlockBuilder({
        block_height: 1,
        index_block_hash: '0x01',
        parent_index_block_hash: '0x00',
      }).build()
    );

    // ETag zero.
    const request1 = await supertest(api.server).get(url);
    expect(request1.status).toBe(200);
    expect(request1.type).toBe('application/json');
    const etag0 = request1.headers['etag'];

    // Add receiving STX tx.
    await db.updateMempoolTxs({
      mempoolTxs: [
        testMempoolTx({
          tx_id: '0x0001',
          token_transfer_amount: 2000n,
          token_transfer_recipient_address: address,
        }),
      ],
    });

    // Valid ETag.
    const request2 = await supertest(api.server).get(url);
    expect(request2.status).toBe(200);
    expect(request2.type).toBe('application/json');
    expect(request2.headers['etag']).toBeTruthy();
    const json2 = JSON.parse(request2.text);
    expect(json2.stx.balance).toBe('0');
    expect(json2.stx.estimated_balance).toBe('2000');
    const etag1 = request2.headers['etag'];
    expect(etag1).not.toEqual(etag0);

    // Cache works with valid ETag.
    const request3 = await supertest(api.server).get(url).set('If-None-Match', etag1);
    expect(request3.status).toBe(304);
    expect(request3.text).toBe('');

    // Confirm mempool tx.
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        index_block_hash: '0x02',
        parent_index_block_hash: '0x01',
      })
        .addTx({
          tx_id: '0x0001',
          token_transfer_amount: 2000n,
          token_transfer_recipient_address: address,
        })
        .addTxStxEvent({ amount: 2000n, recipient: address })
        .build()
    );

    // Cache is now a miss.
    const request4 = await supertest(api.server).get(url).set('If-None-Match', etag1);
    expect(request4.status).toBe(200);
    expect(request4.type).toBe('application/json');
    expect(request4.headers['etag']).not.toEqual(etag1);
    const json4 = JSON.parse(request4.text);
    expect(json4.stx.balance).toBe('2000');
    expect(json4.stx.estimated_balance).toBe('2000');
  });

  test('block cache control', async () => {
    await db.update(
      new TestBlockBuilder({
        block_height: 1,
        index_block_hash: '0x01',
        parent_index_block_hash: '0x00',
      }).build()
    );
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        index_block_hash: '0x8f652ee1f26bfbffe3cf111994ade25286687b76e6a2f64c33b4632a1f4545ac',
        parent_index_block_hash: '0x01',
      }).build()
    );

    // Valid latest Etag.
    const request1 = await supertest(api.server).get(`/extended/v2/blocks/latest`);
    expect(request1.status).toBe(200);
    expect(request1.type).toBe('application/json');
    const etag0 = request1.headers['etag'];

    // Same block hash Etag.
    const request2 = await supertest(api.server).get(
      `/extended/v2/blocks/0x8f652ee1f26bfbffe3cf111994ade25286687b76e6a2f64c33b4632a1f4545ac`
    );
    expect(request2.status).toBe(200);
    expect(request2.type).toBe('application/json');
    expect(request2.headers['etag']).toEqual(etag0);

    // Same block height Etag.
    const request3 = await supertest(api.server).get(`/extended/v2/blocks/2`);
    expect(request3.status).toBe(200);
    expect(request3.type).toBe('application/json');
    expect(request3.headers['etag']).toEqual(etag0);

    // Cache works with valid ETag.
    const request4 = await supertest(api.server)
      .get(`/extended/v2/blocks/2`)
      .set('If-None-Match', etag0);
    expect(request4.status).toBe(304);
    expect(request4.text).toBe('');

    // Add new block.
    await db.update(
      new TestBlockBuilder({
        block_height: 3,
        index_block_hash: '0x03',
        parent_index_block_hash:
          '0x8f652ee1f26bfbffe3cf111994ade25286687b76e6a2f64c33b4632a1f4545ac',
      }).build()
    );

    // Cache still works with same ETag.
    const request5 = await supertest(api.server)
      .get(`/extended/v2/blocks/2`)
      .set('If-None-Match', etag0);
    expect(request5.status).toBe(304);
    expect(request5.text).toBe('');

    // Re-org block 2
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        index_block_hash: '0x02bb',
        parent_index_block_hash: '0x01',
      }).build()
    );
    await db.update(
      new TestBlockBuilder({
        block_height: 3,
        index_block_hash: '0x03bb',
        parent_index_block_hash: '0x02bb',
      }).build()
    );
    await db.update(
      new TestBlockBuilder({
        block_height: 4,
        index_block_hash: '0x04bb',
        parent_index_block_hash: '0x03bb',
      }).build()
    );

    // Cache is now a miss.
    const request6 = await supertest(api.server)
      .get(`/extended/v2/blocks/2`)
      .set('If-None-Match', etag0);
    expect(request6.status).toBe(200);
    expect(request6.type).toBe('application/json');
    expect(request6.headers['etag']).not.toEqual(etag0);
    const etag1 = request6.headers['etag'];

    // Cache works with new ETag.
    const request7 = await supertest(api.server)
      .get(`/extended/v2/blocks/2`)
      .set('If-None-Match', etag1);
    expect(request7.status).toBe(304);
    expect(request7.text).toBe('');
  });
});
