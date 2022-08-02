import * as supertest from 'supertest';
import { ChainID } from '@stacks/transactions';
import { startApiServer, ApiServer } from '../api/init';
import { PgSqlClient } from '../datastore/connection';
import { TestBlockBuilder, testMempoolTx } from '../test-utils/test-builders';
import { PgWriteStore } from '../datastore/pg-write-store';
import { cycleMigrations, runMigrations } from '../datastore/migrations';
import { DbTxTypeId } from '../datastore/common';

describe('mempool tests', () => {
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

  test('garbage collection', async () => {
    const garbageThresholdOrig = process.env.STACKS_MEMPOOL_TX_GARBAGE_COLLECTION_THRESHOLD;
    process.env.STACKS_MEMPOOL_TX_GARBAGE_COLLECTION_THRESHOLD = '2';
    try {
      // Insert 5 blocks with 1 mempool tx each.
      for (let block_height = 1; block_height <= 5; block_height++) {
        const block = new TestBlockBuilder({
          block_height: block_height,
          index_block_hash: `0x0${block_height}`,
          parent_index_block_hash: `0x0${block_height - 1}`,
        })
          .addTx({ tx_id: `0x111${block_height}` })
          .build();
        await db.update(block);
        const mempoolTx = testMempoolTx({ tx_id: `0x0${block_height}` });
        await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });
      }

      // Make sure we only have mempool txs for block_height >= 3
      const mempoolTxResult = await db.getMempoolTxList({
        limit: 10,
        offset: 0,
        includeUnanchored: false,
      });
      const mempoolTxs = mempoolTxResult.results;
      expect(mempoolTxs.length).toEqual(3);
      const txIds = mempoolTxs.map(e => e.tx_id).sort();
      expect(txIds).toEqual(['0x03', '0x04', '0x05']);
    } finally {
      if (typeof garbageThresholdOrig === 'undefined') {
        delete process.env.STACKS_MEMPOOL_TX_GARBAGE_COLLECTION_THRESHOLD;
      } else {
        process.env.STACKS_MEMPOOL_TX_GARBAGE_COLLECTION_THRESHOLD = garbageThresholdOrig;
      }
    }
  });

  test('mempool stats', async () => {
    // Insert 5 blocks with 1 mempool tx each.
    for (let block_height = 1; block_height <= 5; block_height++) {
      const block = new TestBlockBuilder({
        block_height: block_height,
        index_block_hash: `0x0${block_height}`,
        parent_index_block_hash: `0x0${block_height - 1}`,
      })
        .addTx({ tx_id: `0x111${block_height}` })
        .build();
      await db.update(block);
      const mempoolTx1 = testMempoolTx({
        tx_id: `0x0${block_height}`,
        type_id: DbTxTypeId.TokenTransfer,
        fee_rate: BigInt(100 * block_height),
        raw_tx: '0x' + 'ff'.repeat(block_height),
      });
      const mempoolTx2 = testMempoolTx({
        tx_id: `0x1${block_height}`,
        type_id: DbTxTypeId.ContractCall,
        fee_rate: BigInt(200 * block_height),
        raw_tx: '0x' + 'ff'.repeat(block_height + 10),
      });
      const mempoolTx3 = testMempoolTx({
        tx_id: `0x2${block_height}`,
        type_id: DbTxTypeId.SmartContract,
        fee_rate: BigInt(300 * block_height),
        raw_tx: '0x' + 'ff'.repeat(block_height + 20),
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
        token_transfer: { p25: 4, p50: 3, p75: 2, p95: 1.2000000000000002 },
        smart_contract: { p25: 4, p50: 3, p75: 2, p95: 1.2000000000000002 },
        contract_call: { p25: 4, p50: 3, p75: 2, p95: 1.2000000000000002 },
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

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
