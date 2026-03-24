import supertest from 'supertest';
import { ChainID } from '@stacks/transactions';
import { getBlockFromDataStore } from '../../../src/api/controllers/db-controller.ts';
import {
  DbBlock,
  DbMicroblockPartial,
  DbTxRaw,
  DbTxStatus,
  DbTxTypeId,
} from '../../../src/datastore/common.ts';
import { startApiServer, ApiServer } from '../../../src/api/init.ts';
import { I32_MAX } from '../../../src/helpers.ts';
import { TestBlockBuilder, testMempoolTx } from '../test-builders.ts';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { bufferToHex } from '@stacks/api-toolkit';
import { migrate } from '../../test-helpers.ts';
import { beforeEach, afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { assertMatchesObject } from '../test-helpers.ts';

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

    assertMatchesObject(blockQuery.result, expectedResp1);

    const fetchBlockByHash1 = await supertest(api.server).get(
      `/extended/v1/block/${block1.block_hash}`
    );
    assert.equal(fetchBlockByHash1.status, 200);
    assert.equal(fetchBlockByHash1.type, 'application/json');
    assertMatchesObject(JSON.parse(fetchBlockByHash1.text), expectedResp1);
    assert.equal(fetchBlockByHash1.headers['etag'], `"${block1.index_block_hash}"`);

    const fetchBlockByHashCached1 = await supertest(api.server)
      .get(`/extended/v1/block/${block1.block_hash}`)
      .set('If-None-Match', `"${block1.index_block_hash}"`);
    assert.equal(fetchBlockByHashCached1.status, 304);
    assert.equal(fetchBlockByHashCached1.text, '');

    const fetchBlockByHashCacheMiss = await supertest(api.server)
      .get(`/extended/v1/block/${block1.block_hash}`)
      .set('If-None-Match', '"0x12345678"');
    assert.equal(fetchBlockByHashCacheMiss.status, 200);
    assert.equal(fetchBlockByHashCacheMiss.type, 'application/json');
    assertMatchesObject(JSON.parse(fetchBlockByHashCacheMiss.text), expectedResp1);
    assert.equal(fetchBlockByHashCacheMiss.headers['etag'], `"${block1.index_block_hash}"`);

    const fetchBlockByHeight = await supertest(api.server).get(
      `/extended/v1/block/by_height/${block1.block_height}`
    );
    assert.equal(fetchBlockByHeight.status, 200);
    assert.equal(fetchBlockByHeight.type, 'application/json');
    assertMatchesObject(JSON.parse(fetchBlockByHeight.text), expectedResp1);
    assert.equal(fetchBlockByHeight.headers['etag'], `"${block1.index_block_hash}"`);

    const fetchBlockByHeightCached = await supertest(api.server)
      .get(`/extended/v1/block/by_height/${block1.block_height}`)
      .set('If-None-Match', `"${block1.index_block_hash}"`);
    assert.equal(fetchBlockByHeightCached.status, 304);
    assert.equal(fetchBlockByHeightCached.text, '');

    const fetchBlockByHeightCacheMiss = await supertest(api.server)
      .get(`/extended/v1/block/by_height/${block1.block_height}`)
      .set('If-None-Match', '"0x12345678"');
    assert.equal(fetchBlockByHashCacheMiss.status, 200);
    assert.equal(fetchBlockByHeightCacheMiss.type, 'application/json');
    assertMatchesObject(JSON.parse(fetchBlockByHeightCacheMiss.text), expectedResp1);
    assert.equal(fetchBlockByHeightCacheMiss.headers['etag'], `"${block1.index_block_hash}"`);

    const fetchStxSupplyResp1 = { total_stx: String };
    const fetchStxSupply = await supertest(api.server).get(`/extended/v1/stx_supply`);
    assert.equal(fetchStxSupply.type, 'application/json');
    assertMatchesObject(fetchStxSupply.body, fetchStxSupplyResp1);
    assert.equal(fetchStxSupply.headers['etag'], `"${block1.index_block_hash}"`);

    const fetchStxSupplyCached = await supertest(api.server)
      .get(`/extended/v1/stx_supply`)
      .set('If-None-Match', `"${block1.index_block_hash}"`);
    assert.equal(fetchStxSupplyCached.status, 304);
    assert.equal(fetchStxSupplyCached.text, '');

    const fetchStxSupplyCacheMiss = await supertest(api.server)
      .get(`/extended/v1/stx_supply`)
      .set('If-None-Match', '"0x12345678"');
    assert.equal(fetchStxSupplyCacheMiss.status, 200);
    assert.equal(fetchStxSupplyCacheMiss.type, 'application/json');
    assertMatchesObject(fetchStxSupplyCacheMiss.body, fetchStxSupplyResp1);
    assert.equal(fetchStxSupplyCacheMiss.headers['etag'], `"${block1.index_block_hash}"`);

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
    assert.equal(chainTip2.block_hash, block1.block_hash);
    assert.equal(chainTip2.block_height, block1.block_height);
    assert.equal(chainTip2.index_block_hash, block1.index_block_hash);
    assert.equal(chainTip2.microblock_hash, mb1.microblock_hash);
    assert.equal(chainTip2.microblock_sequence, mb1.microblock_sequence);

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
    assert.equal(fetchBlockByHash2.status, 200);
    assert.equal(fetchBlockByHash2.type, 'application/json');
    assertMatchesObject(JSON.parse(fetchBlockByHash2.text), expectedResp2);
    assert.equal(fetchBlockByHash2.headers['etag'], `"${mb1.microblock_hash}"`);

    const fetchBlockByHashCached2 = await supertest(api.server)
      .get(`/extended/v1/block/${block1.block_hash}`)
      .set('If-None-Match', `"${mb1.microblock_hash}"`);
    assert.equal(fetchBlockByHashCached2.status, 304);
    assert.equal(fetchBlockByHashCached2.text, '');
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
    assert.equal(request1.status, 200);
    assert.equal(request1.type, 'application/json');
    const etag0 = request1.headers['etag'];

    // Add mempool txs.
    const mempoolTx1 = testMempoolTx({ tx_id: '0x1101' });
    const mempoolTx2 = testMempoolTx({ tx_id: '0x1102' });
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx1, mempoolTx2] });

    // Valid ETag.
    const request2 = await supertest(api.server).get('/extended/v1/tx/mempool');
    assert.equal(request2.status, 200);
    assert.equal(request2.type, 'application/json');
    assert.ok(request2.headers['etag']);
    const etag1 = request2.headers['etag'];
    assert.notDeepEqual(etag1, etag0);

    // Cache works with valid ETag.
    const request3 = await supertest(api.server)
      .get('/extended/v1/tx/mempool')
      .set('If-None-Match', etag1);
    assert.equal(request3.status, 304);
    assert.equal(request3.text, '');

    // Drop one tx.
    await db.dropMempoolTxs({
      status: DbTxStatus.DroppedReplaceByFee,
      txIds: ['0x1101'],
      new_tx_id: '0x1109',
    });

    // Cache is now a miss.
    const request4 = await supertest(api.server)
      .get('/extended/v1/tx/mempool')
      .set('If-None-Match', etag1);
    assert.equal(request4.status, 200);
    assert.equal(request4.type, 'application/json');
    assert.deepEqual(request4.headers['etag'] !== etag1, true);
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
    assert.equal(request5.status, 200);
    assert.equal(request5.type, 'application/json');
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
    assert.equal(request6.status, 200);
    assert.equal(request6.type, 'application/json');
    assert.notDeepEqual(request6.headers['etag'], etag3);
    const etag4 = request6.headers['etag'];

    // Garbage collect all txs.
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
    assert.equal(request7.status, 200);
    assert.equal(request7.type, 'application/json');
    assert.notDeepEqual(request7.headers['etag'], etag4);
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
    assert.equal(request1.status, 404);
    assert.equal(request1.type, 'application/json');

    // Add mempool tx.
    const mempoolTx1 = testMempoolTx({ tx_id: txId1 });
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx1] });

    // Valid mempool ETag.
    const request2 = await supertest(api.server).get(`/extended/v1/tx/${txId1}`);
    assert.equal(request2.status, 200);
    assert.equal(request2.type, 'application/json');
    assert.ok(request2.headers['etag']);
    const etag1 = request2.headers['etag'];

    // Cache works with valid ETag.
    const request3 = await supertest(api.server)
      .get(`/extended/v1/tx/${txId1}`)
      .set('If-None-Match', etag1);
    assert.equal(request3.status, 304);
    assert.equal(request3.text, '');

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
    assert.equal(request4.status, 200);
    assert.ok(request4.headers['etag']);
    const etag2 = request4.headers['etag'];

    // Cache works with new ETag.
    const request5 = await supertest(api.server)
      .get(`/extended/v1/tx/${txId1}`)
      .set('If-None-Match', etag2);
    assert.equal(request5.status, 304);
    assert.equal(request5.text, '');

    // No tx #2 yet.
    const request6 = await supertest(api.server).get(`/extended/v1/tx/${txId2}`);
    assert.equal(request6.status, 404);
    assert.equal(request6.type, 'application/json');

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
    assert.equal(request7.status, 200);
    assert.equal(request7.type, 'application/json');
    assert.ok(request7.headers['etag']);
    const etag3 = request7.headers['etag'];

    // Cache works with valid ETag.
    const request8 = await supertest(api.server)
      .get(`/extended/v1/tx/${txId2}`)
      .set('If-None-Match', etag3);
    assert.equal(request8.status, 304);
    assert.equal(request8.text, '');

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
    assert.equal(request9.status, 200);
    assert.ok(request9.headers['etag']);
    const etag4 = request9.headers['etag'];

    // Cache works again with new ETag.
    const request10 = await supertest(api.server)
      .get(`/extended/v1/tx/${txId1}`)
      .set('If-None-Match', etag4);
    assert.equal(request10.status, 304);
    assert.equal(request10.text, '');

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
    assert.equal(request11.status, 200);
    assert.ok(request11.headers['etag']);
    const etag5 = request11.headers['etag'];
    assert.notEqual(etag2, etag5);
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
    assert.equal(request1.status, 200);
    assert.equal(request1.type, 'application/json');
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
    assert.equal(request2.status, 200);
    assert.equal(request2.type, 'application/json');
    assert.ok(request2.headers['etag']);
    const etag1 = request2.headers['etag'];
    assert.notDeepEqual(etag1, etag0);

    // Cache works with valid ETag.
    const request3 = await supertest(api.server).get(url).set('If-None-Match', etag1);
    assert.equal(request3.status, 304);
    assert.equal(request3.text, '');

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
    assert.equal(request4.status, 200);
    assert.equal(request4.type, 'application/json');
    assert.notDeepEqual(request4.headers['etag'], etag1);
    const etag2 = request4.headers['etag'];

    // Cache works with new ETag.
    const request5 = await supertest(api.server).get(url).set('If-None-Match', etag2);
    assert.equal(request5.status, 304);
    assert.equal(request5.text, '');

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
    assert.equal(request6.status, 200);
    assert.equal(request6.type, 'application/json');
    assert.notDeepEqual(request6.headers['etag'], etag2);
    const etag3 = request6.headers['etag'];

    // Cache works with new ETag.
    const request7 = await supertest(api.server).get(url).set('If-None-Match', etag3);
    assert.equal(request7.status, 304);
    assert.equal(request7.text, '');

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
    assert.equal(request8.status, 200);
    assert.equal(request8.type, 'application/json');
    assert.notDeepEqual(request8.headers['etag'], etag3);
    const etag4 = request8.headers['etag'];

    // Cache works with new ETag.
    const request9 = await supertest(api.server).get(url).set('If-None-Match', etag4);
    assert.equal(request9.status, 304);
    assert.equal(request9.text, '');

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
    assert.equal(request10.status, 304);
    assert.equal(request10.text, '');
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
    assert.equal(request1.status, 200);
    assert.equal(request1.type, 'application/json');
    const etag0 = request1.headers['etag'];

    // Add STX tx.
    await db.updateMempoolTxs({
      mempoolTxs: [
        testMempoolTx({ tx_id: '0x0001', receipt_time: 1000, sender_address, nonce: 0 }),
      ],
    });

    // Valid ETag.
    const request2 = await supertest(api.server).get(url);
    assert.equal(request2.status, 200);
    assert.equal(request2.type, 'application/json');
    assert.ok(request2.headers['etag']);
    const etag1 = request2.headers['etag'];
    assert.notDeepEqual(etag1, etag0);

    // Cache works with valid ETag.
    const request3 = await supertest(api.server).get(url).set('If-None-Match', etag1);
    assert.equal(request3.status, 304);
    assert.equal(request3.text, '');

    // Add sponsor tx.
    await db.updateMempoolTxs({
      mempoolTxs: [
        testMempoolTx({
          tx_id: '0x0002',
          receipt_time: 2000,
          sponsor_address: sender_address,
          nonce: 1,
        }),
      ],
    });

    // Cache is now a miss.
    const request4 = await supertest(api.server).get(url).set('If-None-Match', etag1);
    assert.equal(request4.status, 200);
    assert.equal(request4.type, 'application/json');
    assert.notDeepEqual(request4.headers['etag'], etag1);
    const etag2 = request4.headers['etag'];

    // Cache works with new ETag.
    const request5 = await supertest(api.server).get(url).set('If-None-Match', etag2);
    assert.equal(request5.status, 304);
    assert.equal(request5.text, '');

    // Add token recipient tx.
    await db.updateMempoolTxs({
      mempoolTxs: [
        testMempoolTx({
          tx_id: '0x0003',
          receipt_time: 3000,
          token_transfer_recipient_address: sender_address,
          nonce: 2,
        }),
      ],
    });

    // Cache is now a miss.
    const request6 = await supertest(api.server).get(url).set('If-None-Match', etag2);
    assert.equal(request6.status, 200);
    assert.equal(request6.type, 'application/json');
    assert.notDeepEqual(request6.headers['etag'], etag2);
    const etag3 = request6.headers['etag'];

    // Cache works with new ETag.
    const request7 = await supertest(api.server).get(url).set('If-None-Match', etag3);
    assert.equal(request7.status, 304);
    assert.equal(request7.text, '');

    // Change mempool with no changes to this address.
    await db.updateMempoolTxs({
      mempoolTxs: [testMempoolTx({ tx_id: '0x0004', receipt_time: 4000, nonce: 3 })],
    });

    // Cache still works.
    const request8 = await supertest(api.server).get(url).set('If-None-Match', etag3);
    assert.equal(request8.status, 304);
    assert.equal(request8.text, '');
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
    assert.equal(request1.status, 200);
    assert.equal(request1.type, 'application/json');
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
    assert.equal(request2.status, 200);
    assert.equal(request2.type, 'application/json');
    assert.ok(request2.headers['etag']);
    const json2 = JSON.parse(request2.text);
    assert.equal(json2.stx.balance, '0');
    assert.equal(json2.stx.estimated_balance, '2000');
    const etag1 = request2.headers['etag'];
    assert.notDeepEqual(etag1, etag0);

    // Cache works with valid ETag.
    const request3 = await supertest(api.server).get(url).set('If-None-Match', etag1);
    assert.equal(request3.status, 304);
    assert.equal(request3.text, '');

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
    assert.equal(request4.status, 200);
    assert.equal(request4.type, 'application/json');
    assert.notDeepEqual(request4.headers['etag'], etag1);
    const json4 = JSON.parse(request4.text);
    assert.equal(json4.stx.balance, '2000');
    assert.equal(json4.stx.estimated_balance, '2000');
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
    assert.equal(request1.status, 200);
    assert.equal(request1.type, 'application/json');
    const etag0 = request1.headers['etag'];

    // Same block hash Etag.
    const request2 = await supertest(api.server).get(
      `/extended/v2/blocks/0x8f652ee1f26bfbffe3cf111994ade25286687b76e6a2f64c33b4632a1f4545ac`
    );
    assert.equal(request2.status, 200);
    assert.equal(request2.type, 'application/json');
    assert.deepEqual(request2.headers['etag'], etag0);

    // Same block height Etag.
    const request3 = await supertest(api.server).get(`/extended/v2/blocks/2`);
    assert.equal(request3.status, 200);
    assert.equal(request3.type, 'application/json');
    assert.deepEqual(request3.headers['etag'], etag0);

    // Cache works with valid ETag.
    const request4 = await supertest(api.server)
      .get(`/extended/v2/blocks/2`)
      .set('If-None-Match', etag0);
    assert.equal(request4.status, 304);
    assert.equal(request4.text, '');

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
    assert.equal(request5.status, 304);
    assert.equal(request5.text, '');

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
    assert.equal(request6.status, 200);
    assert.equal(request6.type, 'application/json');
    assert.notDeepEqual(request6.headers['etag'], etag0);
    const etag1 = request6.headers['etag'];

    // Cache works with new ETag.
    const request7 = await supertest(api.server)
      .get(`/extended/v2/blocks/2`)
      .set('If-None-Match', etag1);
    assert.equal(request7.status, 304);
    assert.equal(request7.text, '');
  });
});
