import * as supertest from 'supertest';
import { ChainID } from '@stacks/transactions';
import { startApiServer, ApiServer } from '../../src/api/init';
import { PgWriteStore } from '../../src/datastore/pg-write-store';
import {
  DbBlock,
  DbTxRaw,
  DbTxTypeId,
  DbMempoolTxRaw,
  DbTxStatus,
  DataStoreBlockUpdateData,
} from '../../src/datastore/common';
import { I32_MAX } from '../../src/helpers';
import {
  TestBlockBuilder,
  testMempoolTx,
  TestMicroblockStreamBuilder,
} from '../utils/test-builders';
import { getPagingQueryLimit, ResourceType } from '../../src/api/pagination';
import { PgSqlClient, bufferToHex } from '@hirosystems/api-toolkit';
import { migrate } from '../utils/test-helpers';

describe('mempool tests', () => {
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

  test('garbage collection pre 3.0', async () => {
    const hexFromHeight = (height: number) => {
      const hex = height.toString(16);
      return hex.length % 2 == 1 ? `0${hex}` : hex;
    };
    // Insert more than 256 blocks with 1 mempool tx each.
    for (let block_height = 1; block_height <= 259; block_height++) {
      const block = new TestBlockBuilder({
        block_height: block_height,
        index_block_hash: `0x${hexFromHeight(block_height)}`,
        parent_index_block_hash: `0x${hexFromHeight(block_height - 1)}`,
      })
        .addTx({ tx_id: `0x11${hexFromHeight(block_height)}`, nonce: block_height })
        .build();
      await db.update(block);
      const mempoolTx = testMempoolTx({
        tx_id: `0x${hexFromHeight(block_height)}`,
        nonce: block_height,
        sender_address: 'SP3SBQ9PZEMBNBAWTR7FRPE3XK0EFW9JWVX4G80S2',
      });
      await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });
    }
    await db.update(
      new TestBlockBuilder({
        block_height: 260,
        index_block_hash: `0xff`,
        parent_index_block_hash: `0x0103`,
      }).build()
    );

    // Make sure we only have mempool txs for block_height >= 3
    const mempoolTxResult = await db.getMempoolTxList({
      limit: 10,
      offset: 0,
      includeUnanchored: false,
    });
    expect(mempoolTxResult.total).toEqual(257);
  });

  test('garbage collection post 3.0', async () => {
    // Insert 3 txs spaced out so garbage collection kicks in.
    for (let block_height = 1; block_height <= 3; block_height++) {
      const block = new TestBlockBuilder({
        block_height: block_height,
        index_block_hash: `0x0${block_height}`,
        parent_index_block_hash: `0x0${block_height - 1}`,
        signer_bitvec: '1111',
      })
        .addTx({ tx_id: `0x111${block_height}`, nonce: block_height })
        .build();
      await db.update(block);
      const mempoolTx = testMempoolTx({ tx_id: `0x0${block_height}`, receipt_time: 1 });
      await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });
    }

    const mempoolTx = testMempoolTx({ tx_id: `0x0fff` });
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });
    await db.update(
      new TestBlockBuilder({
        block_height: 4,
        index_block_hash: `0xff`,
        parent_index_block_hash: `0x03`,
      }).build()
    );

    // Make sure we only have the latest mempool tx
    const mempoolTxResult = await db.getMempoolTxList({
      limit: 10,
      offset: 0,
      includeUnanchored: false,
    });
    expect(mempoolTxResult.total).toEqual(1);
  });

  test('mempool stats', async () => {
    // Insert 5 blocks with 1 mempool tx each.
    for (let block_height = 1; block_height <= 5; block_height++) {
      const block = new TestBlockBuilder({
        block_height: block_height,
        index_block_hash: `0x0${block_height}`,
        parent_index_block_hash: `0x0${block_height - 1}`,
      })
        .addTx({ tx_id: `0x111${block_height}`, nonce: block_height })
        .build();
      await db.update(block);
      const mempoolTx1 = testMempoolTx({
        tx_id: `0x0${block_height}`,
        type_id: DbTxTypeId.TokenTransfer,
        fee_rate: BigInt(100 * block_height),
        raw_tx: '0x' + 'ff'.repeat(block_height),
        nonce: block_height,
        sender_address: 'SP3SBQ9PZEMBNBAWTR7FRPE3XK0EFW9JWVX4G80S2',
      });
      const mempoolTx2 = testMempoolTx({
        tx_id: `0x1${block_height}`,
        type_id: DbTxTypeId.ContractCall,
        fee_rate: BigInt(200 * block_height),
        raw_tx: '0x' + 'ff'.repeat(block_height + 10),
        nonce: block_height,
        sender_address: 'SP3XXK8BG5X7CRH7W07RRJK3JZJXJ799WX3Y0SMCR',
      });
      const mempoolTx3 = testMempoolTx({
        tx_id: `0x2${block_height}`,
        type_id: DbTxTypeId.SmartContract,
        fee_rate: BigInt(300 * block_height),
        raw_tx: '0x' + 'ff'.repeat(block_height + 20),
        nonce: block_height,
        sender_address: 'SPM0SBD3R79CDZ3AWBD3BRQS13JZA47PK0207K94',
      });
      await db.updateMempoolTxs({ mempoolTxs: [mempoolTx1, mempoolTx2, mempoolTx3] });
    }

    const result = await supertest(api.server).get(`/extended/v1/tx/mempool/stats`);
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
    const expectedResp1 = {
      tx_type_counts: {
        token_transfer: 5,
        smart_contract: 5,
        contract_call: 5,
        poison_microblock: 0,
      },
      tx_simple_fee_averages: {
        token_transfer: { p25: 200, p50: 300, p75: 400, p95: 480 },
        smart_contract: { p25: 600, p50: 900, p75: 1200, p95: 1440 },
        contract_call: { p25: 400, p50: 600, p75: 800, p95: 960 },
        poison_microblock: { p25: null, p50: null, p75: null, p95: null },
      },
      tx_ages: {
        token_transfer: { p25: 2, p50: 3, p75: 4, p95: 4.8 },
        smart_contract: { p25: 2, p50: 3, p75: 4, p95: 4.8 },
        contract_call: { p25: 2, p50: 3, p75: 4, p95: 4.8 },
        poison_microblock: { p25: null, p50: null, p75: null, p95: null },
      },
      tx_byte_sizes: {
        token_transfer: { p25: 2, p50: 3, p75: 4, p95: 4.8 },
        smart_contract: { p25: 22, p50: 23, p75: 24, p95: 24.8 },
        contract_call: { p25: 12, p50: 13, p75: 14, p95: 14.8 },
        poison_microblock: { p25: null, p50: null, p75: null, p95: null },
      },
    };
    expect(JSON.parse(result.text)).toEqual(expectedResp1);
  });

  test('fetch mempool-tx', async () => {
    const block = new TestBlockBuilder().addTx().build();
    await db.update(block);
    const mempoolTx: DbMempoolTxRaw = {
      pruned: false,
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
      anchor_mode: 3,
      nonce: 0,
      raw_tx: bufferToHex(Buffer.from('test-raw-tx')),
      type_id: DbTxTypeId.Coinbase,
      status: DbTxStatus.Pending,
      replaced_by_tx_id: undefined,
      receipt_time: 1594307695,
      coinbase_payload: bufferToHex(Buffer.from('coinbase hi')),
      post_conditions: '0x01f5',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
    };
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });

    const searchResult1 = await supertest(api.server).get(`/extended/v1/tx/${mempoolTx.tx_id}`);
    expect(searchResult1.status).toBe(200);
    expect(searchResult1.type).toBe('application/json');
    const expectedResp1 = {
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
      tx_status: 'pending',
      replaced_by_tx_id: null,
      tx_type: 'coinbase',
      fee_rate: '1234',
      nonce: 0,
      anchor_mode: 'any',
      sender_address: 'sender-addr',
      sponsored: false,
      post_condition_mode: 'allow',
      post_conditions: [],
      receipt_time: 1594307695,
      receipt_time_iso: '2020-07-09T15:14:55.000Z',
      coinbase_payload: { data: '0x636f696e62617365206869', alt_recipient: null },
    };

    expect(JSON.parse(searchResult1.text)).toEqual(expectedResp1);
  });

  test('fetch mempool-tx - versioned smart contract', async () => {
    const block = new TestBlockBuilder().addTx().build();
    await db.update(block);
    const mempoolTx: DbMempoolTxRaw = {
      pruned: false,
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
      anchor_mode: 3,
      nonce: 0,
      raw_tx: bufferToHex(Buffer.from('test-raw-tx')),
      type_id: DbTxTypeId.VersionedSmartContract,
      status: DbTxStatus.Pending,
      replaced_by_tx_id: undefined,
      receipt_time: 1594307695,
      smart_contract_clarity_version: 2,
      smart_contract_contract_id: 'some-versioned-smart-contract',
      smart_contract_source_code: '(some-versioned-contract-src)',
      coinbase_payload: bufferToHex(Buffer.from('coinbase hi')),
      post_conditions: '0x01f5',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: 'sender-addr',
      origin_hash_mode: 1,
    };
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });

    const searchResult1 = await supertest(api.server).get(`/extended/v1/tx/${mempoolTx.tx_id}`);
    expect(searchResult1.status).toBe(200);
    expect(searchResult1.type).toBe('application/json');
    const expectedResp1 = {
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
      tx_status: 'pending',
      replaced_by_tx_id: null,
      tx_type: 'smart_contract',
      fee_rate: '1234',
      nonce: 0,
      anchor_mode: 'any',
      sender_address: 'sender-addr',
      sponsored: false,
      post_condition_mode: 'allow',
      post_conditions: [],
      receipt_time: 1594307695,
      receipt_time_iso: '2020-07-09T15:14:55.000Z',
      smart_contract: {
        clarity_version: 2,
        contract_id: 'some-versioned-smart-contract',
        source_code: '(some-versioned-contract-src)',
      },
    };

    expect(JSON.parse(searchResult1.text)).toEqual(expectedResp1);
  });

  test('fetch mempool-tx - sponsored', async () => {
    const block = new TestBlockBuilder().addTx().build();
    await db.update(block);
    const mempoolTx: DbMempoolTxRaw = {
      pruned: false,
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
      anchor_mode: 3,
      nonce: 0,
      raw_tx: bufferToHex(Buffer.from('test-raw-tx')),
      type_id: DbTxTypeId.Coinbase,
      status: DbTxStatus.Pending,
      replaced_by_tx_id: undefined,
      receipt_time: 1594307695,
      coinbase_payload: bufferToHex(Buffer.from('coinbase hi')),
      post_conditions: '0x01f5',
      fee_rate: 1234n,
      sponsored: true,
      sender_address: 'sender-addr',
      sponsor_address: 'sponsor-addr',
      origin_hash_mode: 1,
    };
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });

    const searchResult1 = await supertest(api.server).get(`/extended/v1/tx/${mempoolTx.tx_id}`);
    expect(searchResult1.status).toBe(200);
    expect(searchResult1.type).toBe('application/json');
    const expectedResp1 = {
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
      tx_status: 'pending',
      replaced_by_tx_id: null,
      tx_type: 'coinbase',
      fee_rate: '1234',
      nonce: 0,
      anchor_mode: 'any',
      sender_address: 'sender-addr',
      sponsor_address: 'sponsor-addr',
      sponsored: true,
      post_condition_mode: 'allow',
      post_conditions: [],
      receipt_time: 1594307695,
      receipt_time_iso: '2020-07-09T15:14:55.000Z',
      coinbase_payload: { data: '0x636f696e62617365206869', alt_recipient: null },
    };

    expect(JSON.parse(searchResult1.text)).toEqual(expectedResp1);
  });

  test('fetch mempool-tx - dropped', async () => {
    const block = new TestBlockBuilder({ index_block_hash: '0x5678' }).addTx().build();
    await db.update(block);
    const mempoolTx1: DbMempoolTxRaw = {
      pruned: false,
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
      anchor_mode: 3,
      nonce: 0,
      raw_tx: bufferToHex(Buffer.from('test-raw-tx')),
      type_id: DbTxTypeId.Coinbase,
      status: DbTxStatus.Pending,
      replaced_by_tx_id: undefined,
      receipt_time: 1594307695,
      coinbase_payload: bufferToHex(Buffer.from('coinbase hi')),
      post_conditions: '0x01f5',
      fee_rate: 1234n,
      sponsored: true,
      sender_address: 'sender-addr',
      sponsor_address: 'sponsor-addr',
      origin_hash_mode: 1,
    };
    const mempoolTx2: DbMempoolTxRaw = {
      ...mempoolTx1,
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000001',
      receipt_time: 1594307702,
      nonce: 1,
    };
    const mempoolTx3: DbMempoolTxRaw = {
      ...mempoolTx1,
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000003',
      receipt_time: 1594307703,
      nonce: 2,
    };
    const mempoolTx4: DbMempoolTxRaw = {
      ...mempoolTx1,
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000004',
      receipt_time: 1594307704,
      nonce: 3,
    };
    const mempoolTx5: DbMempoolTxRaw = {
      ...mempoolTx1,
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000005',
      receipt_time: 1594307705,
      nonce: 4,
    };
    const mempoolTx6: DbMempoolTxRaw = {
      ...mempoolTx1,
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000006',
      receipt_time: 1594307706,
      nonce: 5,
    };

    const new_txid1: string = '0x8912000000000000000000000000000000000000000000000000000000000099';

    const new_txid2: string = '0x8912000000000000000000000000000000000000000000000000000000000100';

    await db.updateMempoolTxs({
      mempoolTxs: [mempoolTx1, mempoolTx2, mempoolTx3, mempoolTx4, mempoolTx5, mempoolTx6],
    });
    await db.dropMempoolTxs({
      status: DbTxStatus.DroppedReplaceAcrossFork,
      txIds: [mempoolTx1.tx_id, mempoolTx2.tx_id],
      new_tx_id: new_txid1,
    });

    const searchResult1 = await supertest(api.server).get(`/extended/v1/tx/${mempoolTx1.tx_id}`);
    expect(searchResult1.status).toBe(200);
    expect(searchResult1.type).toBe('application/json');
    const expectedResp1 = {
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
      tx_status: 'dropped_replace_across_fork',
      replaced_by_tx_id: '0x8912000000000000000000000000000000000000000000000000000000000099',
      tx_type: 'coinbase',
      fee_rate: '1234',
      nonce: 0,
      anchor_mode: 'any',
      sender_address: 'sender-addr',
      sponsor_address: 'sponsor-addr',
      sponsored: true,
      post_condition_mode: 'allow',
      post_conditions: [],
      receipt_time: 1594307695,
      receipt_time_iso: '2020-07-09T15:14:55.000Z',
      coinbase_payload: { data: '0x636f696e62617365206869', alt_recipient: null },
    };
    expect(JSON.parse(searchResult1.text)).toEqual(expectedResp1);

    const searchResult2 = await supertest(api.server).get(`/extended/v1/tx/${mempoolTx2.tx_id}`);
    expect(searchResult2.status).toBe(200);
    expect(searchResult2.type).toBe('application/json');
    const expectedResp2 = {
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000001',
      tx_status: 'dropped_replace_across_fork',
      replaced_by_tx_id: '0x8912000000000000000000000000000000000000000000000000000000000099',
      tx_type: 'coinbase',
      fee_rate: '1234',
      nonce: 1,
      anchor_mode: 'any',
      sender_address: 'sender-addr',
      sponsor_address: 'sponsor-addr',
      sponsored: true,
      post_condition_mode: 'allow',
      post_conditions: [],
      receipt_time: 1594307702,
      receipt_time_iso: '2020-07-09T15:15:02.000Z',
      coinbase_payload: { data: '0x636f696e62617365206869', alt_recipient: null },
    };

    expect(JSON.parse(searchResult2.text)).toEqual(expectedResp2);

    await db.dropMempoolTxs({
      status: DbTxStatus.DroppedReplaceByFee,
      txIds: [mempoolTx3.tx_id],
      new_tx_id: new_txid2,
    });
    const searchResult3 = await supertest(api.server).get(`/extended/v1/tx/${mempoolTx3.tx_id}`);
    expect(searchResult3.status).toBe(200);
    expect(searchResult3.type).toBe('application/json');
    const expectedResp3 = {
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000003',
      tx_status: 'dropped_replace_by_fee',
      replaced_by_tx_id: '0x8912000000000000000000000000000000000000000000000000000000000100',
      tx_type: 'coinbase',
      fee_rate: '1234',
      nonce: 2,
      anchor_mode: 'any',
      sender_address: 'sender-addr',
      sponsor_address: 'sponsor-addr',
      sponsored: true,
      post_condition_mode: 'allow',
      post_conditions: [],
      receipt_time: 1594307703,
      receipt_time_iso: '2020-07-09T15:15:03.000Z',
      coinbase_payload: { data: '0x636f696e62617365206869', alt_recipient: null },
    };
    expect(JSON.parse(searchResult3.text)).toEqual(expectedResp3);

    await db.dropMempoolTxs({
      status: DbTxStatus.DroppedTooExpensive,
      txIds: [mempoolTx4.tx_id],
      new_tx_id: null,
    });
    const searchResult4 = await supertest(api.server).get(`/extended/v1/tx/${mempoolTx4.tx_id}`);
    expect(searchResult4.status).toBe(200);
    expect(searchResult4.type).toBe('application/json');
    const expectedResp4 = {
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000004',
      tx_status: 'dropped_too_expensive',
      replaced_by_tx_id: null,
      tx_type: 'coinbase',
      fee_rate: '1234',
      nonce: 3,
      anchor_mode: 'any',
      sender_address: 'sender-addr',
      sponsor_address: 'sponsor-addr',
      sponsored: true,
      post_condition_mode: 'allow',
      post_conditions: [],
      receipt_time: 1594307704,
      receipt_time_iso: '2020-07-09T15:15:04.000Z',
      coinbase_payload: { data: '0x636f696e62617365206869', alt_recipient: null },
    };
    expect(JSON.parse(searchResult4.text)).toEqual(expectedResp4);

    await db.dropMempoolTxs({
      status: DbTxStatus.DroppedStaleGarbageCollect,
      txIds: [mempoolTx5.tx_id],
      new_tx_id: null,
    });
    const searchResult5 = await supertest(api.server).get(`/extended/v1/tx/${mempoolTx5.tx_id}`);
    expect(searchResult5.status).toBe(200);
    expect(searchResult5.type).toBe('application/json');
    const expectedResp5 = {
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000005',
      tx_status: 'dropped_stale_garbage_collect',
      replaced_by_tx_id: null,
      tx_type: 'coinbase',
      fee_rate: '1234',
      nonce: 4,
      anchor_mode: 'any',
      sender_address: 'sender-addr',
      sponsor_address: 'sponsor-addr',
      sponsored: true,
      post_condition_mode: 'allow',
      post_conditions: [],
      receipt_time: 1594307705,
      receipt_time_iso: '2020-07-09T15:15:05.000Z',
      coinbase_payload: { data: '0x636f696e62617365206869', alt_recipient: null },
    };
    expect(JSON.parse(searchResult5.text)).toEqual(expectedResp5);

    await db.dropMempoolTxs({
      status: DbTxStatus.DroppedProblematic,
      txIds: [mempoolTx6.tx_id],
      new_tx_id: null,
    });
    const searchResult6 = await supertest(api.server).get(`/extended/v1/tx/${mempoolTx6.tx_id}`);
    expect(searchResult6.status).toBe(200);
    expect(searchResult6.type).toBe('application/json');
    const expectedResp6 = {
      tx_id: '0x8912000000000000000000000000000000000000000000000000000000000006',
      tx_status: 'dropped_problematic',
      replaced_by_tx_id: null,
      tx_type: 'coinbase',
      fee_rate: '1234',
      nonce: 5,
      anchor_mode: 'any',
      sender_address: 'sender-addr',
      sponsor_address: 'sponsor-addr',
      sponsored: true,
      post_condition_mode: 'allow',
      post_conditions: [],
      receipt_time: 1594307706,
      receipt_time_iso: '2020-07-09T15:15:06.000Z',
      coinbase_payload: { data: '0x636f696e62617365206869', alt_recipient: null },
    };
    expect(JSON.parse(searchResult6.text)).toEqual(expectedResp6);

    const mempoolDroppedResult1 = await supertest(api.server).get(
      '/extended/v1/tx/mempool/dropped'
    );
    expect(mempoolDroppedResult1.status).toBe(200);
    expect(mempoolDroppedResult1.type).toBe('application/json');
    expect(mempoolDroppedResult1.body).toEqual(
      expect.objectContaining({
        results: expect.arrayContaining([
          expect.objectContaining({
            tx_id: '0x8912000000000000000000000000000000000000000000000000000000000006',
            tx_status: 'dropped_problematic',
            replaced_by_tx_id: null,
          }),
          expect.objectContaining({
            tx_id: '0x8912000000000000000000000000000000000000000000000000000000000005',
            tx_status: 'dropped_stale_garbage_collect',
            replaced_by_tx_id: null,
          }),
          expect.objectContaining({
            tx_id: '0x8912000000000000000000000000000000000000000000000000000000000004',
            tx_status: 'dropped_too_expensive',
            replaced_by_tx_id: null,
          }),
          expect.objectContaining({
            tx_id: '0x8912000000000000000000000000000000000000000000000000000000000003',
            tx_status: 'dropped_replace_by_fee',
            replaced_by_tx_id: '0x8912000000000000000000000000000000000000000000000000000000000100',
          }),
          expect.objectContaining({
            tx_id: '0x8912000000000000000000000000000000000000000000000000000000000001',
            tx_status: 'dropped_replace_across_fork',
            replaced_by_tx_id: '0x8912000000000000000000000000000000000000000000000000000000000099',
          }),
          expect.objectContaining({
            tx_id: '0x8912000000000000000000000000000000000000000000000000000000000000',
            tx_status: 'dropped_replace_across_fork',
            replaced_by_tx_id: '0x8912000000000000000000000000000000000000000000000000000000000099',
          }),
        ]),
      })
    );

    const dbBlock1: DbBlock = {
      block_hash: '0x0123',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 2,
      tenure_height: 2,
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
      tx_total_size: 1,
      signer_bitvec: null,
      signer_signatures: null,
    };
    const dbTx1: DbTxRaw = {
      ...mempoolTx1,
      ...dbBlock1,
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
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      vm_error: null,
    };
    const dataStoreUpdate1: DataStoreBlockUpdateData = {
      block: dbBlock1,
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
      ],
    };
    await db.update(dataStoreUpdate1);

    const mempoolDroppedResult2 = await supertest(api.server).get(
      '/extended/v1/tx/mempool/dropped'
    );
    expect(mempoolDroppedResult2.status).toBe(200);
    expect(mempoolDroppedResult2.type).toBe('application/json');
    expect(mempoolDroppedResult2.body.results).toHaveLength(5);
    expect(mempoolDroppedResult2.body).toEqual(
      expect.objectContaining({
        results: expect.arrayContaining([
          expect.objectContaining({
            tx_id: '0x8912000000000000000000000000000000000000000000000000000000000006',
            tx_status: 'dropped_problematic',
            replaced_by_tx_id: null,
          }),
          expect.objectContaining({
            tx_id: '0x8912000000000000000000000000000000000000000000000000000000000005',
            tx_status: 'dropped_stale_garbage_collect',
            replaced_by_tx_id: null,
          }),
          expect.objectContaining({
            tx_id: '0x8912000000000000000000000000000000000000000000000000000000000004',
            tx_status: 'dropped_too_expensive',
            replaced_by_tx_id: null,
          }),
          expect.objectContaining({
            tx_id: '0x8912000000000000000000000000000000000000000000000000000000000003',
            tx_status: 'dropped_replace_by_fee',
            replaced_by_tx_id: '0x8912000000000000000000000000000000000000000000000000000000000100',
          }),
          expect.objectContaining({
            tx_id: '0x8912000000000000000000000000000000000000000000000000000000000001',
            tx_status: 'dropped_replace_across_fork',
            replaced_by_tx_id: '0x8912000000000000000000000000000000000000000000000000000000000099',
          }),
        ]),
      })
    );
  });

  test('fetch mempool-tx list', async () => {
    const block = new TestBlockBuilder().addTx().build();
    await db.update(block);
    for (let i = 0; i < 10; i++) {
      const mempoolTx: DbMempoolTxRaw = {
        pruned: false,
        tx_id: `0x891200000000000000000000000000000000000000000000000000000000000${i}`,
        anchor_mode: 3,
        nonce: i,
        raw_tx: bufferToHex(Buffer.from('test-raw-tx')),
        type_id: DbTxTypeId.Coinbase,
        receipt_time: (new Date(`2020-07-09T15:14:0${i}Z`).getTime() / 1000) | 0,
        coinbase_payload: bufferToHex(Buffer.from('coinbase hi')),
        status: 1,
        replaced_by_tx_id: undefined,
        post_conditions: '0x01f5',
        fee_rate: 1234n,
        sponsored: false,
        sponsor_address: undefined,
        sender_address: 'sender-addr',
        origin_hash_mode: 1,
      };
      await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });
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
          tx_status: 'pending',
          replaced_by_tx_id: null,
          tx_type: 'coinbase',
          receipt_time: 1594307647,
          receipt_time_iso: '2020-07-09T15:14:07.000Z',
          fee_rate: '1234',
          nonce: 7,
          anchor_mode: 'any',
          sender_address: 'sender-addr',
          sponsored: false,
          post_condition_mode: 'allow',
          post_conditions: [],
          coinbase_payload: { data: '0x636f696e62617365206869', alt_recipient: null },
        },
        {
          tx_id: '0x8912000000000000000000000000000000000000000000000000000000000006',
          tx_status: 'pending',
          replaced_by_tx_id: null,
          tx_type: 'coinbase',
          receipt_time: 1594307646,
          receipt_time_iso: '2020-07-09T15:14:06.000Z',
          fee_rate: '1234',
          nonce: 6,
          anchor_mode: 'any',
          sender_address: 'sender-addr',
          sponsored: false,
          post_condition_mode: 'allow',
          post_conditions: [],
          coinbase_payload: { data: '0x636f696e62617365206869', alt_recipient: null },
        },
        {
          tx_id: '0x8912000000000000000000000000000000000000000000000000000000000005',
          tx_status: 'pending',
          replaced_by_tx_id: null,
          tx_type: 'coinbase',
          receipt_time: 1594307645,
          receipt_time_iso: '2020-07-09T15:14:05.000Z',
          fee_rate: '1234',
          nonce: 5,
          anchor_mode: 'any',
          sender_address: 'sender-addr',
          sponsored: false,
          post_condition_mode: 'allow',
          post_conditions: [],
          coinbase_payload: { data: '0x636f696e62617365206869', alt_recipient: null },
        },
      ],
    };
    expect(JSON.parse(searchResult1.text)).toEqual(expectedResp1);
  });

  test('fetch mempool-tx list filtered', async () => {
    const sendAddr = 'SP25YGP221F01S9SSCGN114MKDAK9VRK8P3KXGEMB';
    const recvAddr = 'SP10EZK56MB87JYF5A704K7N18YAT6G6M09HY22GC';
    const contractAddr = 'SP466FNC0P7JWTNM2R9T199QRZN1MYEDTAR0KP27';
    const contractCallId = 'SP32AEEF6WW5Y0NMJ1S8SBSZDAY8R5J32NBZFPKKZ.free-punks-v0';

    const block = new TestBlockBuilder().addTx().build();
    await db.update(block);
    const stxTransfers: {
      sender: string;
      receiver: string;
      smart_contract_id?: string;
      smart_contract_source?: string;
      contract_call_id?: string;
      contract_call_function_name?: string;
      type_id: DbTxTypeId;
    }[] = new Array(5).fill({
      sender: 'sender-addr',
      receiver: 'receiver-addr',
      type_id: DbTxTypeId.TokenTransfer,
    });
    stxTransfers.push(
      {
        sender: sendAddr,
        receiver: recvAddr,
        type_id: DbTxTypeId.TokenTransfer,
      },
      {
        sender: sendAddr,
        receiver: 'testRecv1',
        type_id: DbTxTypeId.TokenTransfer,
      },
      {
        sender: 'testSend1',
        receiver: recvAddr,
        type_id: DbTxTypeId.TokenTransfer,
      },
      {
        sender: 'testSend1',
        receiver: 'testRecv1',
        contract_call_id: contractCallId,
        contract_call_function_name: 'mint',
        type_id: DbTxTypeId.ContractCall,
      },
      {
        sender: 'testSend1',
        receiver: 'testRecv1',
        smart_contract_id: contractAddr,
        smart_contract_source: '(define-public (say-hi) (ok "hello world"))',
        type_id: DbTxTypeId.SmartContract,
      },
      {
        sender: 'testSend1',
        receiver: contractCallId,
        type_id: DbTxTypeId.TokenTransfer,
      }
    );
    let index = 0;
    for (const xfer of stxTransfers) {
      const paddedIndex = ('00' + index).slice(-2);
      const mempoolTx: DbMempoolTxRaw = {
        pruned: false,
        tx_id: `0x89120000000000000000000000000000000000000000000000000000000000${paddedIndex}`,
        anchor_mode: 3,
        nonce: index,
        raw_tx: bufferToHex(Buffer.from('test-raw-tx')),
        type_id: xfer.type_id,
        receipt_time: (new Date(`2020-07-09T15:14:${paddedIndex}Z`).getTime() / 1000) | 0,
        status: 1,
        replaced_by_tx_id: undefined,
        post_conditions: '0x01f5',
        fee_rate: 1234n,
        sponsored: false,
        sponsor_address: undefined,
        origin_hash_mode: 1,
        sender_address: xfer.sender,
        token_transfer_recipient_address: xfer.receiver,
        token_transfer_amount: 1234n,
        token_transfer_memo: '',
        contract_call_contract_id: xfer.contract_call_id,
        contract_call_function_name: xfer.contract_call_function_name,
        smart_contract_contract_id: xfer.smart_contract_id,
        smart_contract_source_code: xfer.smart_contract_source,
      };
      await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });
      index++;
    }
    const searchResult1 = await supertest(api.server).get(
      `/extended/v1/tx/mempool?sender_address=${sendAddr}`
    );
    expect(searchResult1.status).toBe(200);
    expect(searchResult1.type).toBe('application/json');
    const expectedResp1 = {
      limit: getPagingQueryLimit(ResourceType.Tx),
      offset: 0,
      total: 2,
      results: [
        {
          fee_rate: '1234',
          nonce: 6,
          anchor_mode: 'any',
          post_condition_mode: 'allow',
          post_conditions: [],
          receipt_time: 1594307646,
          receipt_time_iso: '2020-07-09T15:14:06.000Z',
          sender_address: 'SP25YGP221F01S9SSCGN114MKDAK9VRK8P3KXGEMB',
          sponsored: false,
          token_transfer: {
            amount: '1234',
            memo: '0x',
            recipient_address: 'testRecv1',
          },
          tx_id: '0x8912000000000000000000000000000000000000000000000000000000000006',
          tx_status: 'pending',
          replaced_by_tx_id: null,
          tx_type: 'token_transfer',
        },
        {
          fee_rate: '1234',
          nonce: 5,
          anchor_mode: 'any',
          post_condition_mode: 'allow',
          post_conditions: [],
          receipt_time: 1594307645,
          receipt_time_iso: '2020-07-09T15:14:05.000Z',
          sender_address: 'SP25YGP221F01S9SSCGN114MKDAK9VRK8P3KXGEMB',
          sponsored: false,
          token_transfer: {
            amount: '1234',
            memo: '0x',
            recipient_address: 'SP10EZK56MB87JYF5A704K7N18YAT6G6M09HY22GC',
          },
          tx_id: '0x8912000000000000000000000000000000000000000000000000000000000005',
          tx_status: 'pending',
          replaced_by_tx_id: null,
          tx_type: 'token_transfer',
        },
      ],
    };
    expect(JSON.parse(searchResult1.text)).toEqual(expectedResp1);

    const searchResult2 = await supertest(api.server).get(
      `/extended/v1/tx/mempool?recipient_address=${recvAddr}`
    );
    expect(searchResult2.status).toBe(200);
    expect(searchResult2.type).toBe('application/json');
    const expectedResp2 = {
      limit: getPagingQueryLimit(ResourceType.Tx),
      offset: 0,
      total: 2,
      results: [
        {
          fee_rate: '1234',
          nonce: 7,
          anchor_mode: 'any',
          post_condition_mode: 'allow',
          post_conditions: [],
          receipt_time: 1594307647,
          receipt_time_iso: '2020-07-09T15:14:07.000Z',
          sender_address: 'testSend1',
          sponsored: false,
          token_transfer: {
            amount: '1234',
            memo: '0x',
            recipient_address: 'SP10EZK56MB87JYF5A704K7N18YAT6G6M09HY22GC',
          },
          tx_id: '0x8912000000000000000000000000000000000000000000000000000000000007',
          tx_status: 'pending',
          replaced_by_tx_id: null,
          tx_type: 'token_transfer',
        },
        {
          fee_rate: '1234',
          nonce: 5,
          anchor_mode: 'any',
          post_condition_mode: 'allow',
          post_conditions: [],
          receipt_time: 1594307645,
          receipt_time_iso: '2020-07-09T15:14:05.000Z',
          sender_address: 'SP25YGP221F01S9SSCGN114MKDAK9VRK8P3KXGEMB',
          sponsored: false,
          token_transfer: {
            amount: '1234',
            memo: '0x',
            recipient_address: 'SP10EZK56MB87JYF5A704K7N18YAT6G6M09HY22GC',
          },
          tx_id: '0x8912000000000000000000000000000000000000000000000000000000000005',
          tx_status: 'pending',
          replaced_by_tx_id: null,
          tx_type: 'token_transfer',
        },
      ],
    };
    expect(JSON.parse(searchResult2.text)).toEqual(expectedResp2);

    const searchResult3 = await supertest(api.server).get(
      `/extended/v1/tx/mempool?sender_address=${sendAddr}&recipient_address=${recvAddr}&`
    );
    expect(searchResult3.status).toBe(200);
    expect(searchResult3.type).toBe('application/json');
    const expectedResp3 = {
      limit: getPagingQueryLimit(ResourceType.Tx),
      offset: 0,
      total: 1,
      results: [
        {
          fee_rate: '1234',
          nonce: 5,
          anchor_mode: 'any',
          post_condition_mode: 'allow',
          post_conditions: [],
          receipt_time: 1594307645,
          receipt_time_iso: '2020-07-09T15:14:05.000Z',
          sender_address: 'SP25YGP221F01S9SSCGN114MKDAK9VRK8P3KXGEMB',
          sponsored: false,
          token_transfer: {
            amount: '1234',
            memo: '0x',
            recipient_address: 'SP10EZK56MB87JYF5A704K7N18YAT6G6M09HY22GC',
          },
          tx_id: '0x8912000000000000000000000000000000000000000000000000000000000005',
          tx_status: 'pending',
          replaced_by_tx_id: null,
          tx_type: 'token_transfer',
        },
      ],
    };
    expect(JSON.parse(searchResult3.text)).toEqual(expectedResp3);

    const searchResult4 = await supertest(api.server).get(
      `/extended/v1/tx/mempool?address=${sendAddr}`
    );
    expect(searchResult4.status).toBe(200);
    expect(searchResult4.type).toBe('application/json');
    const expectedResp4 = {
      limit: getPagingQueryLimit(ResourceType.Tx),
      offset: 0,
      total: 2,
      results: [
        {
          fee_rate: '1234',
          nonce: 6,
          anchor_mode: 'any',
          post_condition_mode: 'allow',
          post_conditions: [],
          receipt_time: 1594307646,
          receipt_time_iso: '2020-07-09T15:14:06.000Z',
          sender_address: 'SP25YGP221F01S9SSCGN114MKDAK9VRK8P3KXGEMB',
          sponsored: false,
          token_transfer: {
            amount: '1234',
            memo: '0x',
            recipient_address: 'testRecv1',
          },
          tx_id: '0x8912000000000000000000000000000000000000000000000000000000000006',
          tx_status: 'pending',
          replaced_by_tx_id: null,
          tx_type: 'token_transfer',
        },
        {
          fee_rate: '1234',
          nonce: 5,
          anchor_mode: 'any',
          post_condition_mode: 'allow',
          post_conditions: [],
          receipt_time: 1594307645,
          receipt_time_iso: '2020-07-09T15:14:05.000Z',
          sender_address: 'SP25YGP221F01S9SSCGN114MKDAK9VRK8P3KXGEMB',
          sponsored: false,
          token_transfer: {
            amount: '1234',
            memo: '0x',
            recipient_address: 'SP10EZK56MB87JYF5A704K7N18YAT6G6M09HY22GC',
          },
          tx_id: '0x8912000000000000000000000000000000000000000000000000000000000005',
          tx_status: 'pending',
          replaced_by_tx_id: null,
          tx_type: 'token_transfer',
        },
      ],
    };
    expect(JSON.parse(searchResult4.text)).toEqual(expectedResp4);

    const searchResult5 = await supertest(api.server).get(
      `/extended/v1/tx/mempool?address=${contractCallId}`
    );
    expect(searchResult5.status).toBe(200);
    expect(searchResult5.type).toBe('application/json');
    const expectedResp5 = {
      limit: getPagingQueryLimit(ResourceType.Tx),
      offset: 0,
      total: 2,
      results: [
        {
          fee_rate: '1234',
          nonce: 10,
          anchor_mode: 'any',
          post_condition_mode: 'allow',
          post_conditions: [],
          receipt_time: 1594307650,
          receipt_time_iso: '2020-07-09T15:14:10.000Z',
          sender_address: 'testSend1',
          sponsored: false,
          token_transfer: {
            amount: '1234',
            memo: '0x',
            recipient_address: 'SP32AEEF6WW5Y0NMJ1S8SBSZDAY8R5J32NBZFPKKZ.free-punks-v0',
          },
          tx_id: '0x8912000000000000000000000000000000000000000000000000000000000010',
          tx_status: 'pending',
          replaced_by_tx_id: null,
          tx_type: 'token_transfer',
        },
        {
          fee_rate: '1234',
          nonce: 8,
          anchor_mode: 'any',
          post_condition_mode: 'allow',
          post_conditions: [],
          receipt_time: 1594307648,
          receipt_time_iso: '2020-07-09T15:14:08.000Z',
          sender_address: 'testSend1',
          sponsored: false,
          tx_id: '0x8912000000000000000000000000000000000000000000000000000000000008',
          tx_status: 'pending',
          replaced_by_tx_id: null,
          tx_type: 'contract_call',
          contract_call: {
            contract_id: 'SP32AEEF6WW5Y0NMJ1S8SBSZDAY8R5J32NBZFPKKZ.free-punks-v0',
            function_name: 'mint',
            function_signature: '',
          },
        },
      ],
    };
    expect(JSON.parse(searchResult5.text)).toEqual(expectedResp5);

    const searchResult5Address = await supertest(api.server).get(
      `/extended/v1/address/${contractCallId}/mempool`
    );
    expect(searchResult5Address.status).toBe(200);
    expect(searchResult5Address.type).toBe('application/json');
    const expectedResp5Address = {
      limit: getPagingQueryLimit(ResourceType.Tx),
      offset: 0,
      total: 2,
      results: [
        {
          fee_rate: '1234',
          nonce: 10,
          anchor_mode: 'any',
          post_condition_mode: 'allow',
          post_conditions: [],
          receipt_time: 1594307650,
          receipt_time_iso: '2020-07-09T15:14:10.000Z',
          sender_address: 'testSend1',
          sponsored: false,
          token_transfer: {
            amount: '1234',
            memo: '0x',
            recipient_address: 'SP32AEEF6WW5Y0NMJ1S8SBSZDAY8R5J32NBZFPKKZ.free-punks-v0',
          },
          tx_id: '0x8912000000000000000000000000000000000000000000000000000000000010',
          tx_status: 'pending',
          replaced_by_tx_id: null,
          tx_type: 'token_transfer',
        },
        {
          fee_rate: '1234',
          nonce: 8,
          anchor_mode: 'any',
          post_condition_mode: 'allow',
          post_conditions: [],
          receipt_time: 1594307648,
          receipt_time_iso: '2020-07-09T15:14:08.000Z',
          sender_address: 'testSend1',
          sponsored: false,
          tx_id: '0x8912000000000000000000000000000000000000000000000000000000000008',
          tx_status: 'pending',
          replaced_by_tx_id: null,
          tx_type: 'contract_call',
          contract_call: {
            contract_id: 'SP32AEEF6WW5Y0NMJ1S8SBSZDAY8R5J32NBZFPKKZ.free-punks-v0',
            function_name: 'mint',
            function_signature: '',
          },
        },
      ],
    };
    expect(JSON.parse(searchResult5Address.text)).toEqual(expectedResp5Address);

    const searchResult6 = await supertest(api.server).get(
      `/extended/v1/tx/mempool?address=${contractAddr}`
    );
    expect(searchResult6.status).toBe(200);
    expect(searchResult6.type).toBe('application/json');
    const expectedResp6 = {
      limit: getPagingQueryLimit(ResourceType.Tx),
      offset: 0,
      total: 1,
      results: [
        {
          fee_rate: '1234',
          nonce: 9,
          anchor_mode: 'any',
          post_condition_mode: 'allow',
          post_conditions: [],
          receipt_time: 1594307649,
          receipt_time_iso: '2020-07-09T15:14:09.000Z',
          sender_address: 'testSend1',
          sponsored: false,
          tx_id: '0x8912000000000000000000000000000000000000000000000000000000000009',
          tx_status: 'pending',
          replaced_by_tx_id: null,
          tx_type: 'smart_contract',
          smart_contract: {
            clarity_version: null,
            contract_id: 'SP466FNC0P7JWTNM2R9T199QRZN1MYEDTAR0KP27',
            source_code: '(define-public (say-hi) (ok "hello world"))',
          },
        },
      ],
    };
    expect(JSON.parse(searchResult6.text)).toEqual(expectedResp6);

    const searchResult7 = await supertest(api.server).get(
      `/extended/v1/tx/mempool?recipient_address=${contractCallId}`
    );
    expect(searchResult7.status).toBe(200);
    expect(searchResult7.type).toBe('application/json');
    const expectedResp7 = {
      limit: getPagingQueryLimit(ResourceType.Tx),
      offset: 0,
      total: 1,
      results: [
        {
          fee_rate: '1234',
          nonce: 10,
          anchor_mode: 'any',
          post_condition_mode: 'allow',
          post_conditions: [],
          receipt_time: 1594307650,
          receipt_time_iso: '2020-07-09T15:14:10.000Z',
          sender_address: 'testSend1',
          sponsored: false,
          token_transfer: {
            amount: '1234',
            memo: '0x',
            recipient_address: 'SP32AEEF6WW5Y0NMJ1S8SBSZDAY8R5J32NBZFPKKZ.free-punks-v0',
          },
          tx_id: '0x8912000000000000000000000000000000000000000000000000000000000010',
          tx_status: 'pending',
          replaced_by_tx_id: null,
          tx_type: 'token_transfer',
        },
      ],
    };
    expect(JSON.parse(searchResult7.text)).toEqual(expectedResp7);
  });

  test('fetch mempool-tx list sorted', async () => {
    const sendAddr = 'SP25YGP221F01S9SSCGN114MKDAK9VRK8P3KXGEMB';
    const recvAddr = 'SP10EZK56MB87JYF5A704K7N18YAT6G6M09HY22GC';

    const block = new TestBlockBuilder().addTx().build();
    await db.update(block);
    const txs: DbMempoolTxRaw[] = [];
    for (let index = 0; index < 5; index++) {
      const paddedIndex = ('00' + index).slice(-2);
      const mempoolTx: DbMempoolTxRaw = {
        pruned: false,
        tx_id: `0x89120000000000000000000000000000000000000000000000000000000000${paddedIndex}`,
        anchor_mode: 3,
        nonce: index,
        raw_tx: bufferToHex(Buffer.from('x'.repeat(index + 1))),
        type_id: DbTxTypeId.TokenTransfer,
        receipt_time: (new Date(`2020-07-09T15:14:${paddedIndex}Z`).getTime() / 1000) | 0,
        status: 1,
        replaced_by_tx_id: undefined,
        post_conditions: '0x01f5',
        fee_rate: 100n * BigInt(index + 1),
        sponsored: false,
        sponsor_address: undefined,
        origin_hash_mode: 1,
        sender_address: sendAddr,
        token_transfer_recipient_address: recvAddr,
        token_transfer_amount: 1234n,
        token_transfer_memo: '',
      };
      txs.push(mempoolTx);
    }
    await db.updateMempoolTxs({ mempoolTxs: txs });

    let result = await supertest(api.server).get(`/extended/v1/tx/mempool?order_by=fee&order=desc`);
    let json = JSON.parse(result.text);
    expect(json.results[0].fee_rate).toBe('500');
    expect(json.results[1].fee_rate).toBe('400');
    expect(json.results[2].fee_rate).toBe('300');
    expect(json.results[3].fee_rate).toBe('200');
    expect(json.results[4].fee_rate).toBe('100');

    result = await supertest(api.server).get(`/extended/v1/tx/mempool?order_by=fee&order=asc`);
    json = JSON.parse(result.text);
    expect(json.results[0].fee_rate).toBe('100');
    expect(json.results[1].fee_rate).toBe('200');
    expect(json.results[2].fee_rate).toBe('300');
    expect(json.results[3].fee_rate).toBe('400');
    expect(json.results[4].fee_rate).toBe('500');

    // Larger transactions were set with higher fees.
    result = await supertest(api.server).get(`/extended/v1/tx/mempool?order_by=size&order=desc`);
    json = JSON.parse(result.text);
    expect(json.results[0].fee_rate).toBe('500');
    expect(json.results[1].fee_rate).toBe('400');
    expect(json.results[2].fee_rate).toBe('300');
    expect(json.results[3].fee_rate).toBe('200');
    expect(json.results[4].fee_rate).toBe('100');

    result = await supertest(api.server).get(`/extended/v1/tx/mempool?order_by=size&order=asc`);
    json = JSON.parse(result.text);
    expect(json.results[0].fee_rate).toBe('100');
    expect(json.results[1].fee_rate).toBe('200');
    expect(json.results[2].fee_rate).toBe('300');
    expect(json.results[3].fee_rate).toBe('400');
    expect(json.results[4].fee_rate).toBe('500');

    // Newer transactions were set with higher fees.
    result = await supertest(api.server).get(`/extended/v1/tx/mempool?order_by=age&order=desc`);
    json = JSON.parse(result.text);
    expect(json.results[0].fee_rate).toBe('500');
    expect(json.results[1].fee_rate).toBe('400');
    expect(json.results[2].fee_rate).toBe('300');
    expect(json.results[3].fee_rate).toBe('200');
    expect(json.results[4].fee_rate).toBe('100');

    result = await supertest(api.server).get(`/extended/v1/tx/mempool?order_by=age&order=asc`);
    json = JSON.parse(result.text);
    expect(json.results[0].fee_rate).toBe('100');
    expect(json.results[1].fee_rate).toBe('200');
    expect(json.results[2].fee_rate).toBe('300');
    expect(json.results[3].fee_rate).toBe('400');
    expect(json.results[4].fee_rate).toBe('500');
  });

  test('mempool - contract_call tx abi details are retrieved', async () => {
    const block1 = new TestBlockBuilder()
      .addTx({ nonce: 0 })
      .addTxSmartContract()
      .addTxContractLogEvent()
      .build();
    await db.update(block1);

    const mempoolTx1 = testMempoolTx({
      type_id: DbTxTypeId.ContractCall,
      tx_id: '0x1232000000000000000000000000000000000000000000000000000000000000',
      nonce: 1,
    });
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx1] });

    const expectedContractDetails = {
      contract_id: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
      function_args: [
        {
          hex: '0x010000000000000000000000000001e240',
          name: 'amount',
          repr: 'u123456',
          type: 'uint',
        },
      ],
      function_name: 'test-contract-fn',
      function_signature: '(define-public (test-contract-fn (amount uint)))',
    };

    // Mempool txs
    const mempoolResults = await supertest(api.server).get(`/extended/v1/tx/mempool`);
    expect(mempoolResults.status).toBe(200);
    expect(mempoolResults.type).toBe('application/json');
    expect(JSON.parse(mempoolResults.text).results[0].contract_call).toEqual(
      expectedContractDetails
    );

    // Search mempool tx metadata
    const searchResults = await supertest(api.server).get(
      `/extended/v1/search/${mempoolTx1.tx_id}?include_metadata=true`
    );
    expect(searchResults.status).toBe(200);
    expect(searchResults.type).toBe('application/json');
    expect(JSON.parse(searchResults.text).result.metadata.contract_call).toEqual(
      expectedContractDetails
    );

    // Search principal metadata
    const searchPrincipalResults = await supertest(api.server).get(
      `/extended/v1/search/${expectedContractDetails.contract_id}?include_metadata=true`
    );
    expect(searchPrincipalResults.status).toBe(200);
    expect(searchPrincipalResults.type).toBe('application/json');
    expect(JSON.parse(searchPrincipalResults.text).result.metadata.contract_call).toEqual(
      expectedContractDetails
    );

    const new_txid: string = '0x1232000000000000000000000000000000000000000000000000000000000001';

    // Dropped mempool tx
    await db.dropMempoolTxs({
      status: DbTxStatus.DroppedReplaceAcrossFork,
      txIds: [mempoolTx1.tx_id],
      new_tx_id: new_txid,
    });
    const mempoolDropResults = await supertest(api.server).get(`/extended/v1/tx/mempool/dropped`);
    expect(mempoolDropResults.status).toBe(200);
    expect(mempoolDropResults.type).toBe('application/json');
    expect(JSON.parse(mempoolDropResults.text).results[0].contract_call).toEqual(
      expectedContractDetails
    );
  });

  test('get mempool transactions from address', async () => {
    const dbBlock: DbBlock = {
      block_hash: '0xff',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      tenure_height: 1,
      block_time: 1594647995,
      burn_block_time: 1594647995,
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
    await db.updateBlock(client, dbBlock);
    const senderAddress = 'SP25YGP221F01S9SSCGN114MKDAK9VRK8P3KXGEMB';
    const mempoolTx: DbMempoolTxRaw = {
      tx_id: '0x521234',
      anchor_mode: 3,
      nonce: 0,
      raw_tx: bufferToHex(Buffer.from('test-raw-mempool-tx')),
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      replaced_by_tx_id: undefined,
      post_conditions: '0x01f5',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: senderAddress,
      origin_hash_mode: 1,
      coinbase_payload: bufferToHex(Buffer.from('hi')),
      pruned: false,
      receipt_time: 1616063078,
    };
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });
    const result = await supertest(api.server).get(
      `/extended/v1/address/${mempoolTx.sender_address}/mempool`
    );
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
  });

  test('get mempool transactions: address not valid', async () => {
    const senderAddress = 'test-sender-address';
    const mempoolTx: DbMempoolTxRaw = {
      tx_id: '0x521234',
      anchor_mode: 3,
      nonce: 0,
      raw_tx: bufferToHex(Buffer.from('test-raw-mempool-tx')),
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      replaced_by_tx_id: undefined,
      post_conditions: '0x01f5',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: senderAddress,
      origin_hash_mode: 1,
      coinbase_payload: bufferToHex(Buffer.from('hi')),
      pruned: false,
      receipt_time: 1616063078,
    };
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });
    const result = await supertest(api.server).get(`/extended/v1/address/${senderAddress}/mempool`);
    expect(result.status).toBe(400);
    expect(result.type).toBe('application/json');
  });

  test('get mempool transactions from address with offset and limit', async () => {
    const dbBlock: DbBlock = {
      block_hash: '0xff',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      tenure_height: 1,
      block_time: 1594647995,
      burn_block_time: 1594647995,
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
    await db.updateBlock(client, dbBlock);
    const senderAddress = 'SP25YGP221F01S9SSCGN114MKDAK9VRK8P3KXGEMB';
    const mempoolTx: DbMempoolTxRaw = {
      tx_id: '0x521234',
      anchor_mode: 3,
      nonce: 0,
      raw_tx: bufferToHex(Buffer.from('test-raw-mempool-tx')),
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      replaced_by_tx_id: undefined,
      post_conditions: '0x01f5',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: senderAddress,
      origin_hash_mode: 1,
      coinbase_payload: bufferToHex(Buffer.from('hi')),
      pruned: false,
      receipt_time: 1616063078,
    };
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });
    const result = await supertest(api.server).get(
      `/extended/v1/address/${mempoolTx.sender_address}/mempool?limit=20&offset=0`
    );
    const expectedResponse = {
      limit: 20,
      offset: 0,
      total: 1,
      results: [
        {
          tx_id: '0x521234',
          tx_status: 'pending',
          replaced_by_tx_id: null,
          tx_type: 'coinbase',
          receipt_time: 1616063078,
          receipt_time_iso: '2021-03-18T10:24:38.000Z',
          anchor_mode: 'any',
          nonce: 0,
          fee_rate: '1234',
          sender_address: 'SP25YGP221F01S9SSCGN114MKDAK9VRK8P3KXGEMB',
          sponsored: false,
          post_condition_mode: 'allow',
          post_conditions: [],
          coinbase_payload: {
            data: '0x6869',
            alt_recipient: null,
          },
        },
      ],
    };
    expect(result.status).toBe(200);
    expect(result.type).toBe('application/json');
    expect(result.body.results.length).toBe(1);
    expect(result.body.total).toBe(1);
    expect(result.body.limit).toBe(20);
    expect(result.body.offset).toBe(0);
    expect(JSON.parse(result.text)).toEqual(expectedResponse);
  });

  test('/microblock/:hash duplicate txs', async () => {
    const microblock_hash = '0x0fff',
      tx_id = '0x1234';
    const block = new TestBlockBuilder({ block_hash: '0x1234', block_height: 1 }).build();
    await db.update(block);

    const microblock = new TestMicroblockStreamBuilder()
      .addMicroblock({ microblock_hash, parent_index_block_hash: block.block.index_block_hash })
      .addTx({
        tx_id,
        microblock_canonical: true,
        canonical: true,
        index_block_hash: '0x1234',
      })
      .addTx({
        tx_id,
        microblock_canonical: false,
        canonical: false,
        index_block_hash: '0x123456',
      })
      .build();
    await db.updateMicroblocks(microblock);

    const result = await supertest(api.server).get(`/extended/v1/microblock/${microblock_hash}`);
    expect(result.body.txs).toHaveLength(1);
    expect(result.body.txs[0]).toEqual(tx_id);
  });

  test('/microblock', async () => {
    const microblock_hash = '0x0fff';
    const block = new TestBlockBuilder({ block_hash: '0x1234', block_height: 1 }).build();
    await db.update(block);

    const microblock = new TestMicroblockStreamBuilder()
      .addMicroblock({ microblock_hash, parent_index_block_hash: block.block.index_block_hash })
      .addTx({
        tx_id: '0xffff',
      })
      .addTx({
        tx_id: '0x1234',
        canonical: false,
        microblock_canonical: false,
      })
      .build();
    await db.updateMicroblocks(microblock);
    const microblockResult = await supertest(api.server).get(`/extended/v1/microblock/`);
    const response = microblockResult.body;
    const expectedTxs = ['0xffff'];

    expect(response.total).toEqual(1);
    expect(response.results).toHaveLength(1);
    expect(response.results[0].microblock_hash).toEqual(microblock_hash);
    expect(response.results[0].txs).toHaveLength(1);
    expect(response.results[0].txs).toEqual(expectedTxs);
  });

  test("Re-org'ed txs that weren't previously in the mempool get INSERTED into the mempool AND the other mempool txs get UPDATED", async () => {
    let chainA_BlockHeight = 1;
    const chainA_Suffix = 'aa';
    let txId = 1;

    for (; chainA_BlockHeight <= 3; chainA_BlockHeight++) {
      const block = new TestBlockBuilder({
        block_height: chainA_BlockHeight,
        index_block_hash: `0x${chainA_BlockHeight.toString().repeat(2)}${chainA_Suffix}`,
        parent_index_block_hash: `0x${(chainA_BlockHeight - 1)
          .toString()
          .repeat(2)}${chainA_Suffix}`,
      })
        .addTx({
          tx_id: `0x0${txId++}${chainA_Suffix}`,
          sender_address: `STACKS${chainA_BlockHeight}`,
        })
        .build();
      await db.update(block);
    }

    // Tx 3 will be reorged when the chain is forked to B. Tx 3 will be in the mempool, so it should get updated
    const mempoolTx3BeforeReorg = testMempoolTx({
      tx_id: `0x0${3}${chainA_Suffix}`,
      pruned: true,
    });
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx3BeforeReorg] });

    // fork the chain to B
    let chainB_BlockHeight = 3;
    const chainB_Suffix = 'bb';
    for (; chainB_BlockHeight <= 4; chainB_BlockHeight++) {
      let parentChainSuffix = chainB_Suffix;
      if (chainB_BlockHeight === 3) {
        parentChainSuffix = chainA_Suffix;
      }
      const block = new TestBlockBuilder({
        block_height: chainB_BlockHeight,
        index_block_hash: `0x${chainB_BlockHeight.toString().repeat(2)}${chainB_Suffix}`,
        parent_index_block_hash: `0x${(chainB_BlockHeight - 1)
          .toString()
          .repeat(2)}${parentChainSuffix}`,
      })
        .addTx({
          tx_id: `0x0${txId++}${chainB_Suffix}`,
          sender_address: `STACKS${chainB_BlockHeight + 1}`,
        }) // Txs that don't exist in the mempool and will be reorged
        .build();
      await db.update(block);
    }

    // Tx 3 got reorged and should be updated
    let mempoolTxResult = await db.getMempoolTxList({
      limit: 10,
      offset: 0,
      includeUnanchored: false,
    });
    const mempoolTxs = mempoolTxResult.results;
    expect(mempoolTxs.length).toEqual(1);
    const mempoolTxIds = mempoolTxs.map(e => e.tx_id).sort();
    expect(mempoolTxIds).toEqual(['0x03aa']);
    const mempoolTx3AfterReorg = mempoolTxs[0];
    expect(mempoolTx3AfterReorg.pruned).toBe(false);

    // reorg the chain back to A, reorg txs 4 and 5
    expect(chainA_BlockHeight).toBe(4);
    for (; chainA_BlockHeight <= 5; chainA_BlockHeight++) {
      const block = new TestBlockBuilder({
        block_height: chainA_BlockHeight,
        index_block_hash: `0x${chainA_BlockHeight.toString().repeat(2)}${chainA_Suffix}`,
        parent_index_block_hash: `0x${(chainA_BlockHeight - 1)
          .toString()
          .repeat(2)}${chainA_Suffix}`,
      }).build();
      await db.update(block);
    }

    mempoolTxResult = await db.getMempoolTxList({
      limit: 10,
      offset: 0,
      includeUnanchored: false,
    });
    const mempoolTxsAfterReOrg = mempoolTxResult.results;
    expect(mempoolTxsAfterReOrg.length).toEqual(2);
    const mempoolTxIdsAfterReOrg = mempoolTxsAfterReOrg.map(e => e.tx_id).sort();
    // txs 4 and 5 should be reorged from txs to mempool txs
    expect(mempoolTxIdsAfterReOrg).toEqual(['0x04bb', '0x05bb']);
  });

  test('Reconcile mempool pruned status', async () => {
    const senderAddress = 'SP25YGP221F01S9SSCGN114MKDAK9VRK8P3KXGEMB';
    const txId = '0x521234';
    const dbBlock1: DbBlock = {
      block_hash: '0x0123',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 1,
      tenure_height: 2,
      block_time: 39486,
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
      tx_count: 1,
      tx_total_size: 1,
      signer_bitvec: null,
      signer_signatures: null,
    };
    const dbBlock2: DbBlock = {
      block_hash: '0x2123',
      index_block_hash: '0x2234',
      parent_index_block_hash: dbBlock1.index_block_hash,
      parent_block_hash: dbBlock1.block_hash,
      parent_microblock_hash: '',
      parent_microblock_sequence: 0,
      block_height: 2,
      tenure_height: 2,
      block_time: 39486,
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
      tx_count: 1,
      tx_total_size: 1,
      signer_bitvec: null,
      signer_signatures: null,
    };
    const mempoolTx: DbMempoolTxRaw = {
      tx_id: txId,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: bufferToHex(Buffer.from('test-raw-mempool-tx')),
      type_id: DbTxTypeId.Coinbase,
      status: DbTxStatus.Pending,
      replaced_by_tx_id: undefined,
      post_conditions: '0x01f5',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: senderAddress,
      origin_hash_mode: 1,
      coinbase_payload: bufferToHex(Buffer.from('hi')),
      pruned: false,
      receipt_time: 1616063078,
    };
    const dbTx1: DbTxRaw = {
      ...mempoolTx,
      ...dbBlock1,
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
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      vm_error: null,
    };

    // Simulate the bug with a txs being in the mempool at confirmed at the same time by
    // directly inserting the mempool-tx and mined-tx, bypassing the normal update functions.
    await db.updateBlock(db.sql, dbBlock1);
    const chainTip = await db.getChainTip(db.sql);
    await db.insertDbMempoolTxs([mempoolTx], chainTip, db.sql);
    await db.updateTx(db.sql, dbTx1);

    // Verify tx shows up in mempool (non-pruned)
    const mempoolResult1 = await supertest(api.server).get(
      `/extended/v1/address/${mempoolTx.sender_address}/mempool`
    );
    expect(mempoolResult1.body.results[0].tx_id).toBe(txId);
    const mempoolCount1 = await supertest(api.server).get(`/extended/v1/tx/mempool`);
    expect(mempoolCount1.body.total).toBe(1);
    const mempoolResult2 = await supertest(api.server).get(
      `/extended/v1/tx/mempool?sender_address=${senderAddress}`
    );
    expect(mempoolResult2.body.results[0].tx_id).toBe(txId);

    // Verify tx also shows up as confirmed
    const txResult1 = await supertest(api.server).get(`/extended/v1/tx/${txId}`);
    expect(txResult1.body.tx_status).toBe('pending');

    // Insert next block using regular update function to trigger the mempool reconcile function
    await db.update({
      block: dbBlock2,
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
      ],
    });

    // Verify tx pruned from mempool
    const mempoolResult3 = await supertest(api.server).get(
      `/extended/v1/address/${mempoolTx.sender_address}/mempool`
    );
    expect(mempoolResult3.body.results).toHaveLength(0);
    const mempoolCount2 = await supertest(api.server).get(`/extended/v1/tx/mempool`);
    expect(mempoolCount2.body.total).toBe(0);
    const mempoolResult4 = await supertest(api.server).get(
      `/extended/v1/tx/mempool?sender_address=${senderAddress}`
    );
    expect(mempoolResult4.body.results).toHaveLength(0);

    // Verify tx still shows up as confirmed
    const txResult2 = await supertest(api.server).get(`/extended/v1/tx/${txId}`);
    expect(txResult2.body.tx_status).toBe('success');
  });

  test('Revive dropped and rebroadcasted mempool tx', async () => {
    const senderAddress = 'SP25YGP221F01S9SSCGN114MKDAK9VRK8P3KXGEMB';
    const txId = '0x521234';
    const dbBlock1: DbBlock = {
      block_hash: '0x0123',
      index_block_hash: '0x1234',
      parent_index_block_hash: '0x5678',
      parent_block_hash: '0x5678',
      parent_microblock_hash: '0x00',
      parent_microblock_sequence: 0,
      block_height: 1,
      tenure_height: 1,
      block_time: 39486,
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
      tx_count: 1,
      tx_total_size: 1,
      signer_bitvec: null,
      signer_signatures: null,
    };
    const dbBlock1b: DbBlock = {
      block_hash: '0x0123bb',
      index_block_hash: '0x1234bb',
      parent_index_block_hash: '0x5678bb',
      parent_block_hash: '0x5678bb',
      parent_microblock_hash: '0x00',
      parent_microblock_sequence: 0,
      block_height: 1,
      tenure_height: 1,
      block_time: 39486,
      burn_block_time: 39486,
      burn_block_hash: '0x1234bb',
      burn_block_height: 123,
      miner_txid: '0x4321bb',
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
    const dbBlock2b: DbBlock = {
      block_hash: '0x2123',
      index_block_hash: '0x2234',
      parent_index_block_hash: dbBlock1b.index_block_hash,
      parent_block_hash: dbBlock1b.block_hash,
      parent_microblock_hash: '0x00',
      parent_microblock_sequence: 0,
      block_height: 2,
      tenure_height: 2,
      block_time: 39486,
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
      tx_count: 1,
      tx_total_size: 1,
      signer_bitvec: null,
      signer_signatures: null,
    };
    const mempoolTx: DbMempoolTxRaw = {
      tx_id: txId,
      anchor_mode: 3,
      nonce: 0,
      raw_tx: bufferToHex(Buffer.from('test-raw-mempool-tx')),
      type_id: DbTxTypeId.Coinbase,
      status: 1,
      replaced_by_tx_id: undefined,
      post_conditions: '0x01f5',
      fee_rate: 1234n,
      sponsored: false,
      sponsor_address: undefined,
      sender_address: senderAddress,
      origin_hash_mode: 1,
      coinbase_payload: bufferToHex(Buffer.from('hi')),
      pruned: false,
      receipt_time: 1616063078,
    };
    const dbTx1: DbTxRaw = {
      ...mempoolTx,
      ...dbBlock1,
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
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
      vm_error: null,
    };

    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });

    let chainTip = await db.getChainTip(db.sql);
    expect(chainTip.mempool_tx_count).toBe(1);

    // Verify tx shows up in mempool (non-pruned)
    const mempoolResult1 = await supertest(api.server).get(
      `/extended/v1/address/${mempoolTx.sender_address}/mempool`
    );
    expect(mempoolResult1.body.results[0].tx_id).toBe(txId);
    const mempoolCount1 = await supertest(api.server).get(`/extended/v1/tx/mempool`);
    expect(mempoolCount1.body.total).toBe(1);

    // Drop mempool tx
    await db.dropMempoolTxs({
      status: DbTxStatus.DroppedStaleGarbageCollect,
      txIds: [mempoolTx.tx_id],
      new_tx_id: '',
    });

    // Verify tx is pruned from mempool
    const mempoolResult2 = await supertest(api.server).get(
      `/extended/v1/address/${mempoolTx.sender_address}/mempool`
    );
    expect(mempoolResult2.body.results).toHaveLength(0);
    const mempoolCount2 = await supertest(api.server).get(`/extended/v1/tx/mempool`);
    expect(mempoolCount2.body.total).toBe(0);
    chainTip = await db.getChainTip(db.sql);
    expect(chainTip.mempool_tx_count).toBe(0);

    // Re-broadcast mempool tx
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });

    // Verify tx shows up in mempool again (revived)
    const mempoolResult3 = await supertest(api.server).get(
      `/extended/v1/address/${mempoolTx.sender_address}/mempool`
    );
    expect(mempoolResult3.body.results[0].tx_id).toBe(txId);
    const mempoolCount3 = await supertest(api.server).get(`/extended/v1/tx/mempool`);
    expect(mempoolCount3.body.total).toBe(1);
    chainTip = await db.getChainTip(db.sql);
    expect(chainTip.mempool_tx_count).toBe(1);

    // Mine tx in block to prune from mempool
    await db.update({
      block: dbBlock1,
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
      ],
    });

    // Verify tx is pruned from mempool
    const mempoolResult4 = await supertest(api.server).get(
      `/extended/v1/address/${mempoolTx.sender_address}/mempool`
    );
    expect(mempoolResult4.body.results).toHaveLength(0);
    const mempoolCount4 = await supertest(api.server).get(`/extended/v1/tx/mempool`);
    expect(mempoolCount4.body.total).toBe(0);
    chainTip = await db.getChainTip(db.sql);
    expect(chainTip.mempool_tx_count).toBe(0);

    // Verify tx is mined
    const txResult1 = await supertest(api.server).get(`/extended/v1/tx/${txId}`);
    expect(txResult1.body.tx_status).toBe('success');
    expect(txResult1.body.canonical).toBe(true);

    // Orphan the block to get the tx orphaned and placed back in the pool
    await db.update({
      block: dbBlock1b,
      microblocks: [],
      minerRewards: [],
      txs: [],
    });
    await db.update({
      block: dbBlock2b,
      microblocks: [],
      minerRewards: [],
      txs: [],
    });

    // Verify tx is orphaned and back in mempool
    const txResult2 = await supertest(api.server).get(`/extended/v1/tx/${txId}`);
    expect(txResult2.body.canonical).toBeFalsy();

    // Verify tx has been revived and is back in the mempool
    const mempoolResult5 = await supertest(api.server).get(
      `/extended/v1/address/${mempoolTx.sender_address}/mempool`
    );
    expect(mempoolResult5.body.results[0].tx_id).toBe(txId);
    const mempoolCount5 = await supertest(api.server).get(`/extended/v1/tx/mempool`);
    expect(mempoolCount5.body.total).toBe(1);
    chainTip = await db.getChainTip(db.sql);
    expect(chainTip.mempool_tx_count).toBe(1);

    // Re-broadcast mempool tx
    await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });

    // Verify tx has been revived and is back in the mempool
    const mempoolResult6 = await supertest(api.server).get(
      `/extended/v1/address/${mempoolTx.sender_address}/mempool`
    );
    expect(mempoolResult6.body.results[0].tx_id).toBe(txId);
    const mempoolCount6 = await supertest(api.server).get(`/extended/v1/tx/mempool`);
    expect(mempoolCount6.body.total).toBe(1);
  });

  test('returns fee priorities for mempool transactions', async () => {
    const mempoolTxs: DbMempoolTxRaw[] = [];
    for (let i = 0; i < 10; i++) {
      const sender_address = 'SP25YGP221F01S9SSCGN114MKDAK9VRK8P3KXGEMB';
      const tx_id = `0x00000${i}`;
      const fee_rate = BigInt(100000 * i);
      const nonce = i;
      if (i < 3) {
        mempoolTxs.push({
          tx_id,
          nonce,
          fee_rate,
          type_id: DbTxTypeId.ContractCall,
          anchor_mode: 3,
          raw_tx: bufferToHex(Buffer.from('test-raw-mempool-tx')),
          status: 1,
          replaced_by_tx_id: undefined,
          post_conditions: '0x01f5',
          sponsored: false,
          sponsor_address: undefined,
          contract_call_contract_id: 'SP32AEEF6WW5Y0NMJ1S8SBSZDAY8R5J32NBZFPKKZ.free-punks-v0',
          contract_call_function_name: 'test-func',
          contract_call_function_args: '0x00',
          sender_address,
          origin_hash_mode: 1,
          pruned: false,
          receipt_time: 1616063078,
        });
      } else if (i < 6) {
        mempoolTxs.push({
          tx_id,
          nonce,
          type_id: DbTxTypeId.SmartContract,
          fee_rate,
          anchor_mode: 3,
          raw_tx: bufferToHex(Buffer.from('test-raw-mempool-tx')),
          status: 1,
          replaced_by_tx_id: undefined,
          post_conditions: '0x01f5',
          sponsored: false,
          sponsor_address: undefined,
          sender_address,
          origin_hash_mode: 1,
          pruned: false,
          smart_contract_contract_id: 'some-versioned-smart-contract',
          smart_contract_source_code: '(some-versioned-contract-src)',
          receipt_time: 1616063078,
        });
      } else {
        mempoolTxs.push({
          tx_id,
          nonce,
          type_id: DbTxTypeId.TokenTransfer,
          fee_rate,
          anchor_mode: 3,
          raw_tx: bufferToHex(Buffer.from('test-raw-mempool-tx')),
          status: 1,
          replaced_by_tx_id: undefined,
          post_conditions: '0x01f5',
          sponsored: false,
          sponsor_address: undefined,
          sender_address,
          token_transfer_amount: 100n,
          token_transfer_memo: '0x010101',
          token_transfer_recipient_address: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
          origin_hash_mode: 1,
          pruned: false,
          receipt_time: 1616063078,
        });
      }
    }
    await db.updateMempoolTxs({ mempoolTxs });
    const result = await supertest(api.server).get(`/extended/v2/mempool/fees`);
    expect(result.body).toStrictEqual({
      all: {
        high_priority: 855000,
        low_priority: 450000,
        medium_priority: 675000,
        no_priority: 225000,
      },
      contract_call: {
        high_priority: 190000,
        low_priority: 100000,
        medium_priority: 150000,
        no_priority: 50000,
      },
      smart_contract: {
        high_priority: 490000,
        low_priority: 400000,
        medium_priority: 450000,
        no_priority: 350000,
      },
      token_transfer: {
        high_priority: 885000,
        low_priority: 750000,
        medium_priority: 825000,
        no_priority: 675000,
      },
    });
  });

  test('prunes and restores replaced-by-fee transactions', async () => {
    const sender_address = 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6';
    await db.update(
      new TestBlockBuilder({
        block_height: 1,
        index_block_hash: `0x0001`,
        parent_index_block_hash: `0x0000`,
      }).build()
    );

    // Add tx with nonce = 1 to the mempool
    await db.updateMempoolTxs({
      mempoolTxs: [
        testMempoolTx({
          tx_id: `0xff0001`,
          sender_address,
          nonce: 1,
          fee_rate: 200n,
          type_id: DbTxTypeId.TokenTransfer,
        }),
      ],
    });
    let request = await supertest(api.server).get(`/extended/v1/tx/mempool`);
    expect(request.body.total).toBe(1);
    expect(request.body.results).toHaveLength(1);

    // Add another tx with nonce = 1 to the mempool with a higher fee. Previous tx is marked as
    // pruned and replaced.
    await db.updateMempoolTxs({
      mempoolTxs: [
        testMempoolTx({
          tx_id: `0xff0002`,
          sender_address,
          nonce: 1,
          fee_rate: 300n,
          type_id: DbTxTypeId.TokenTransfer,
        }),
      ],
    });
    request = await supertest(api.server).get(`/extended/v1/tx/mempool`);
    expect(request.body.total).toBe(1);
    expect(request.body.results).toHaveLength(1);
    request = await supertest(api.server).get(`/extended/v1/tx/0xff0001`);
    expect(request.body).toEqual(
      expect.objectContaining({
        tx_status: 'dropped_replace_by_fee',
        replaced_by_tx_id: '0xff0002',
      })
    );

    // Add yet another conflicting tx but our address is the sponsor. Since it has a lower fee, it
    // will be immediately marked as RBFd by 0xff0002.
    await db.updateMempoolTxs({
      mempoolTxs: [
        testMempoolTx({
          tx_id: `0xff0003`,
          sender_address: 'SP3FXEKSA6D4BW3TFP2BWTSREV6FY863Y90YY7D8G',
          sponsor_address: sender_address,
          sponsored: true,
          nonce: 1,
          fee_rate: 150n,
          type_id: DbTxTypeId.TokenTransfer,
        }),
      ],
    });
    request = await supertest(api.server).get(`/extended/v1/tx/mempool`);
    expect(request.body.total).toBe(1);
    expect(request.body.results).toHaveLength(1);
    expect(request.body.results[0].tx_id).toBe('0xff0002');
    request = await supertest(api.server).get(`/extended/v1/tx/0xff0003`);
    expect(request.body).toEqual(
      expect.objectContaining({
        tx_status: 'dropped_replace_by_fee',
        replaced_by_tx_id: '0xff0002',
      })
    );

    // Confirm a block containing a new tx with the same nonce = 1 by the same sender without it
    // ever touching the mempool
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        index_block_hash: `0x0002`,
        parent_index_block_hash: `0x0001`,
      })
        .addTx({
          tx_id: `0xaa0001`,
          sender_address,
          nonce: 1,
          fee_rate: 100n,
          type_id: DbTxTypeId.TokenTransfer,
        })
        .build()
    );

    // Old mempool txs are now pruned and both marked as replaced by the confirmed tx.
    request = await supertest(api.server).get(`/extended/v1/tx/mempool`);
    expect(request.body.total).toBe(0);
    expect(request.body.results).toHaveLength(0);
    request = await supertest(api.server).get(`/extended/v1/tx/0xff0001`);
    expect(request.body).toEqual(
      expect.objectContaining({
        tx_status: 'dropped_replace_by_fee',
        replaced_by_tx_id: '0xaa0001',
      })
    );
    request = await supertest(api.server).get(`/extended/v1/tx/0xff0002`);
    expect(request.body).toEqual(
      expect.objectContaining({
        tx_status: 'dropped_replace_by_fee',
        replaced_by_tx_id: '0xaa0001',
      })
    );

    // Re-org block 2
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        index_block_hash: `0x00b2`,
        parent_index_block_hash: `0x0001`,
      }).build()
    );
    await db.update(
      new TestBlockBuilder({
        block_height: 3,
        index_block_hash: `0x00b3`,
        parent_index_block_hash: `0x00b2`,
      }).build()
    );

    // Only the highest fee tx is restored to the mempool, and all others are pruned and marked as
    // RBFd by it.
    request = await supertest(api.server).get(`/extended/v1/tx/mempool`);
    expect(request.body.total).toBe(1);
    expect(request.body.results).toHaveLength(1);
    request = await supertest(api.server).get(`/extended/v1/tx/0xff0002`); // Winner
    expect(request.body).toEqual(
      expect.objectContaining({
        tx_status: 'pending',
        replaced_by_tx_id: null,
      })
    );
    request = await supertest(api.server).get(`/extended/v1/tx/0xff0001`);
    expect(request.body).toEqual(
      expect.objectContaining({
        tx_status: 'dropped_replace_by_fee',
        replaced_by_tx_id: '0xff0002',
      })
    );
    request = await supertest(api.server).get(`/extended/v1/tx/0xaa0001`);
    expect(request.body).toEqual(
      expect.objectContaining({
        tx_status: 'dropped_replace_by_fee',
        replaced_by_tx_id: '0xff0002',
      })
    );
    request = await supertest(api.server).get(`/extended/v1/tx/0xff0003`);
    expect(request.body).toEqual(
      expect.objectContaining({
        tx_status: 'dropped_replace_by_fee',
        replaced_by_tx_id: '0xff0002',
      })
    );
  });

  test('account estimated balance from mempool activity', async () => {
    const address = 'SP3FXEKSA6D4BW3TFP2BWTSREV6FY863Y90YY7D8G';
    const url = `/extended/v1/address/${address}/stx`;
    await db.update(
      new TestBlockBuilder({
        block_height: 1,
        index_block_hash: '0x01',
        parent_index_block_hash: '0x00',
      })
        .addTx({
          tx_id: '0x0001',
          token_transfer_recipient_address: address,
          token_transfer_amount: 2000n,
        })
        .addTxStxEvent({ recipient: address, amount: 2000n })
        .build()
    );

    // Base balance
    const balance0 = await supertest(api.server).get(url);
    expect(balance0.body.balance).toEqual('2000');
    expect(balance0.body.estimated_balance).toEqual('2000');
    expect(balance0.body.pending_balance_inbound).toEqual('0');
    expect(balance0.body.pending_balance_outbound).toEqual('0');

    // STX transfer in mempool
    await db.updateMempoolTxs({
      mempoolTxs: [
        testMempoolTx({
          tx_id: '0x0002',
          sender_address: address,
          token_transfer_amount: 100n,
          fee_rate: 50n,
          nonce: 0,
        }),
      ],
    });
    const balance1 = await supertest(api.server).get(url);
    expect(balance1.body.balance).toEqual('2000');
    expect(balance1.body.estimated_balance).toEqual('1850'); // Minus amount and fee
    expect(balance1.body.pending_balance_inbound).toEqual('0');
    expect(balance1.body.pending_balance_outbound).toEqual('150');

    // Contract call in mempool
    await db.updateMempoolTxs({
      mempoolTxs: [
        testMempoolTx({
          tx_id: '0x0002aa',
          sender_address: address,
          type_id: DbTxTypeId.ContractCall,
          token_transfer_amount: 0n,
          contract_call_contract_id: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
          contract_call_function_args: '',
          contract_call_function_name: 'test',
          fee_rate: 50n,
          nonce: 1,
        }),
      ],
    });
    const balance1b = await supertest(api.server).get(url);
    expect(balance1b.body.balance).toEqual('2000');
    expect(balance1b.body.estimated_balance).toEqual('1800'); // Minus fee
    expect(balance1b.body.pending_balance_inbound).toEqual('0');
    expect(balance1b.body.pending_balance_outbound).toEqual('200');

    // Sponsored tx in mempool
    await db.updateMempoolTxs({
      mempoolTxs: [
        testMempoolTx({
          tx_id: '0x0003',
          sponsor_address: address,
          sponsored: true,
          token_transfer_amount: 100n,
          fee_rate: 50n,
          nonce: 2,
        }),
      ],
    });
    const balance2 = await supertest(api.server).get(url);
    expect(balance2.body.balance).toEqual('2000');
    expect(balance2.body.estimated_balance).toEqual('1750'); // Minus fee
    expect(balance2.body.pending_balance_inbound).toEqual('0');
    expect(balance2.body.pending_balance_outbound).toEqual('250');

    // STX received in mempool
    await db.updateMempoolTxs({
      mempoolTxs: [
        testMempoolTx({
          tx_id: '0x0004',
          token_transfer_recipient_address: address,
          token_transfer_amount: 100n,
          fee_rate: 50n,
          nonce: 1,
        }),
      ],
    });
    const balance3 = await supertest(api.server).get(url);
    expect(balance3.body.balance).toEqual('2000');
    expect(balance3.body.estimated_balance).toEqual('1850'); // Plus amount
    expect(balance3.body.pending_balance_inbound).toEqual('100');
    expect(balance3.body.pending_balance_outbound).toEqual('250');

    const balanceV2_1 = await supertest(api.server).get(
      `/extended/v2/addresses/${address}/balances/stx?include_mempool=true`
    );
    expect(balanceV2_1.body.balance).toEqual('2000');
    expect(balanceV2_1.body.estimated_balance).toEqual('1850'); // Plus amount
    expect(balanceV2_1.body.pending_balance_inbound).toEqual('100');
    expect(balanceV2_1.body.pending_balance_outbound).toEqual('250');

    // Confirm all txs
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        index_block_hash: '0x02',
        parent_index_block_hash: '0x01',
      })
        .addTx({
          tx_id: '0x0002',
          sender_address: address,
          token_transfer_amount: 100n,
          fee_rate: 50n,
          nonce: 0,
        })
        .addTxStxEvent({ sender: address, amount: 100n })
        .addTx({
          tx_id: '0x0002aa',
          sender_address: address,
          type_id: DbTxTypeId.ContractCall,
          token_transfer_amount: 0n,
          contract_call_contract_id: 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world',
          contract_call_function_args: '',
          contract_call_function_name: 'test',
          fee_rate: 50n,
          nonce: 1,
        })
        .addTx({
          tx_id: '0x0003',
          sponsor_address: address,
          sponsored: true,
          token_transfer_amount: 100n,
          fee_rate: 50n,
          nonce: 2,
        })
        .addTx({
          tx_id: '0x0004',
          token_transfer_recipient_address: address,
          token_transfer_amount: 100n,
          fee_rate: 50n,
          nonce: 1,
        })
        .addTxStxEvent({ recipient: address, amount: 100n })
        .build()
    );
    const balance4 = await supertest(api.server).get(url);
    expect(balance4.body.balance).toEqual('1850');
    expect(balance4.body.estimated_balance).toEqual('1850');
    expect(balance4.body.pending_balance_inbound).toEqual('0');
    expect(balance4.body.pending_balance_outbound).toEqual('0');

    const balanceV2_2 = await supertest(api.server).get(
      `/extended/v2/addresses/${address}/balances/stx?include_mempool=true`
    );
    expect(balanceV2_2.body.balance).toEqual('1850');
    expect(balanceV2_2.body.estimated_balance).toEqual('1850');
    expect(balanceV2_2.body.pending_balance_inbound).toEqual('0');
    expect(balanceV2_2.body.pending_balance_outbound).toEqual('0');
  });
});
