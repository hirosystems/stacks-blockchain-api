import * as supertest from 'supertest';
import { ChainID } from '@stacks/transactions';
import { startApiServer, ApiServer } from '../api/init';
import { PgSqlClient } from '../datastore/connection';
import { PgWriteStore } from '../datastore/pg-write-store';
import { cycleMigrations, runMigrations } from '../datastore/migrations';
import {
  DbBlock,
  DbTx,
  DbTxTypeId,
  DbMempoolTx,
  DbTxStatus,
  DataStoreBlockUpdateData,
} from '../datastore/common';
import { bufferToHexPrefixString, I32_MAX } from '../helpers';
import {
  TestBlockBuilder,
  testMempoolTx,
  TestMicroblockStreamBuilder,
} from '../test-utils/test-builders';
import { getNextChar, getPrevChar } from './helpers';
import { toBech32 } from 'bitcoinjs-lib/types/address';

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

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await runMigrations(undefined, 'down');
  });

  test("Re-org'ed txs that weren't previously in the mempool get INSERTED into the mempool AND the other mempool txs get UPDATED", async () => {
    let chainA_BlockHeight = 1;
    const chainA_Suffix = 'aa';
    let txId = 1;

    for (; chainA_BlockHeight <= 3; chainA_BlockHeight++) {
      const block = new TestBlockBuilder({
        block_height: chainA_BlockHeight,
        block_hash: `0x${chainA_BlockHeight.toString().repeat(2)}${chainA_Suffix}`,
        index_block_hash: `0x${chainA_BlockHeight.toString().repeat(2)}${chainA_Suffix}`,
        parent_index_block_hash: `0x${(chainA_BlockHeight - 1)
          .toString()
          .repeat(2)}${chainA_Suffix}`,
      })
        .addTx({ tx_id: `0x${txId.toString().repeat(4)}` }) // Txs in the mempool, they should get updated during a reorg
        .build();

      await db.update(block);
      const mempoolTx = testMempoolTx({
        tx_id: `0x${txId.toString().repeat(2)}`,
      });
      txId++;
      await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });
    }

    let mempoolTxResult = await db.getMempoolTxList({
      limit: 10,
      offset: 0,
      includeUnanchored: false,
    });
    let mempoolTxs = mempoolTxResult.results;
    expect(mempoolTxs.length).toEqual(3);
    let txIds = mempoolTxs.map(e => e.tx_id).sort();
    expect(txIds).toEqual(['0x11', '0x22', '0x33']);

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
        block_hash: `0x${chainB_BlockHeight.toString().repeat(2)}${chainB_Suffix}`,
        index_block_hash: `0x${chainB_BlockHeight.toString().repeat(2)}${chainB_Suffix}`,
        parent_index_block_hash: `0x${(chainB_BlockHeight - 1)
          .toString()
          .repeat(2)}${parentChainSuffix}`,
      })
        .addTx({ tx_id: `0x${txId.toString().repeat(4)}` }) // Txs that don't exist in the mempool and will be reorged
        .build();
      txId++;
      // chainA_Letter = getNextChar(chainA_Letter);
      await db.update(block);
      // const mempoolTx = testMempoolTx({ tx_id: `0x0${blockHeight}` });
      // await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });
    }

    // reorg the chain back to A
    expect(chainA_BlockHeight).toBe(4);
    for (; chainA_BlockHeight <= 5; chainA_BlockHeight++) {
      const block = new TestBlockBuilder({
        block_height: chainA_BlockHeight,
        block_hash: `0x${chainA_BlockHeight.toString().repeat(2)}${chainA_Suffix}`,
        index_block_hash: `0x${chainA_BlockHeight.toString().repeat(2)}${chainA_Suffix}`,
        parent_index_block_hash: `0x${(chainA_BlockHeight - 1)
          .toString()
          .repeat(2)}${chainA_Suffix}`,
      }).build();
      await db.update(block);
      // const mempoolTx = testMempoolTx({ tx_id: `0x0${blockHeight}` });
      // await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });
    }

    // // Make sure we only have mempool txs for block_height >= 3
    // mempoolTxResult = await db.getMempoolTxList({
    //   limit: 10,
    //   offset: 0,
    //   includeUnanchored: false,
    // });
    // mempoolTxs = mempoolTxResult.results;
    // expect(mempoolTxs.length).toEqual(2);
    // txIds = mempoolTxs.map(e => e.tx_id).sort();
    // expect(txIds).toEqual(['0x1113b', '0x1114b']);
  });
});

// test('pg mempool tx lifecycle', async () => {
//   const block1: DbBlock = {
//     block_hash: '0x11',
//     index_block_hash: '0xaa',
//     parent_index_block_hash: '0x00',
//     parent_block_hash: '0x00',
//     parent_microblock_hash: '0x00',
//     block_height: 1,
//     burn_block_time: 1234,
//     burn_block_hash: '0x1234',
//     burn_block_height: 123,
//     miner_txid: '0x4321',
//     canonical: true,
//     parent_microblock_sequence: 0,
//     execution_cost_read_count: 0,
//     execution_cost_read_length: 0,
//     execution_cost_runtime: 0,
//     execution_cost_write_count: 0,
//     execution_cost_write_length: 0,
//   };
//   const block2: DbBlock = {
//     block_hash: '0x22',
//     index_block_hash: '0xbb',
//     parent_index_block_hash: block1.index_block_hash,
//     parent_block_hash: block1.block_hash,
//     parent_microblock_hash: '0x00',
//     block_height: 2,
//     burn_block_time: 1234,
//     burn_block_hash: '0x1234',
//     burn_block_height: 123,
//     miner_txid: '0x4321',
//     canonical: true,
//     parent_microblock_sequence: 0,
//     execution_cost_read_count: 0,
//     execution_cost_read_length: 0,
//     execution_cost_runtime: 0,
//     execution_cost_write_count: 0,
//     execution_cost_write_length: 0,
//   };
//   const block3: DbBlock = {
//     block_hash: '0x33',
//     index_block_hash: '0xcc',
//     parent_index_block_hash: block2.index_block_hash,
//     parent_block_hash: block2.block_hash,
//     parent_microblock_hash: '0x00',
//     block_height: 3,
//     burn_block_time: 1234,
//     burn_block_hash: '0x1234',
//     burn_block_height: 123,
//     miner_txid: '0x4321',
//     canonical: true,
//     parent_microblock_sequence: 0,
//     execution_cost_read_count: 0,
//     execution_cost_read_length: 0,
//     execution_cost_runtime: 0,
//     execution_cost_write_count: 0,
//     execution_cost_write_length: 0,
//   };
//   const block3B: DbBlock = {
//     ...block3,
//     block_hash: '0x33bb',
//     index_block_hash: '0xccbb',
//     canonical: true,
//   };
//   const block4B: DbBlock = {
//     block_hash: '0x44bb',
//     index_block_hash: '0xddbb',
//     parent_index_block_hash: block3B.index_block_hash,
//     parent_block_hash: block3B.block_hash,
//     parent_microblock_hash: '0x00',
//     block_height: 4,
//     burn_block_time: 1234,
//     burn_block_hash: '0x1234',
//     burn_block_height: 123,
//     miner_txid: '0x4321',
//     canonical: true,
//     parent_microblock_sequence: 0,
//     execution_cost_read_count: 0,
//     execution_cost_read_length: 0,
//     execution_cost_runtime: 0,
//     execution_cost_write_count: 0,
//     execution_cost_write_length: 0,
//   };
//   const block4: DbBlock = {
//     block_hash: '0x44',
//     index_block_hash: '0xdd',
//     parent_index_block_hash: block3.index_block_hash,
//     parent_block_hash: block3.block_hash,
//     parent_microblock_hash: '0x00',
//     block_height: 4,
//     burn_block_time: 1234,
//     burn_block_hash: '0x1234',
//     burn_block_height: 123,
//     miner_txid: '0x4321',
//     canonical: true,
//     parent_microblock_sequence: 0,
//     execution_cost_read_count: 0,
//     execution_cost_read_length: 0,
//     execution_cost_runtime: 0,
//     execution_cost_write_count: 0,
//     execution_cost_write_length: 0,
//   };
//   const block5: DbBlock = {
//     block_hash: '0x55',
//     index_block_hash: '0xee',
//     parent_index_block_hash: block4.index_block_hash,
//     parent_block_hash: block4.block_hash,
//     parent_microblock_hash: '0x00',
//     block_height: 5,
//     burn_block_time: 1234,
//     burn_block_hash: '0x1234',
//     burn_block_height: 123,
//     miner_txid: '0x4321',
//     canonical: true,
//     parent_microblock_sequence: 0,
//     execution_cost_read_count: 0,
//     execution_cost_read_length: 0,
//     execution_cost_runtime: 0,
//     execution_cost_write_count: 0,
//     execution_cost_write_length: 0,
//   };
//   const block6: DbBlock = {
//     block_hash: '0x66',
//     index_block_hash: '0xff',
//     parent_index_block_hash: block5.index_block_hash,
//     parent_block_hash: block5.block_hash,
//     parent_microblock_hash: '0x00',
//     block_height: 6,
//     burn_block_time: 1234,
//     burn_block_hash: '0x1234',
//     burn_block_height: 123,
//     miner_txid: '0x4321',
//     canonical: true,
//     parent_microblock_sequence: 0,
//     execution_cost_read_count: 0,
//     execution_cost_read_length: 0,
//     execution_cost_runtime: 0,
//     execution_cost_write_count: 0,
//     execution_cost_write_length: 0,
//   };

//   const tx1Mempool: DbMempoolTx = {
//     pruned: false,
//     tx_id: '0x01',
//     anchor_mode: 3,
//     nonce: 0,
//     raw_tx: '0x746573742d7261772d7478',
//     type_id: DbTxTypeId.TokenTransfer,
//     receipt_time: 123456,
//     token_transfer_amount: 1n,
//     token_transfer_memo: bufferToHexPrefixString(Buffer.from('hi')),
//     token_transfer_recipient_address: 'stx-recipient-addr',
//     status: DbTxStatus.Pending,
//     post_conditions: '0x',
//     fee_rate: 1234n,
//     sponsored: false,
//     sponsor_address: undefined,
//     sender_address: 'sender-addr',
//     origin_hash_mode: 1,
//   };
//   const tx1: DbTx = {
//     ...tx1Mempool,
//     tx_index: 0,
//     raw_tx: '0x746573742d7261772d7478',
//     index_block_hash: block3B.index_block_hash,
//     block_hash: block3B.block_hash,
//     block_height: block3B.block_height,
//     burn_block_time: block3B.burn_block_time,
//     parent_burn_block_time: 1626122935,
//     status: DbTxStatus.Success,
//     raw_result: '0x0100000000000000000000000000000001', // u1
//     canonical: true,
//     event_count: 0,
//     parent_index_block_hash: '0x00',
//     parent_block_hash: '0x00',
//     microblock_canonical: true,
//     microblock_sequence: I32_MAX,
//     microblock_hash: '0x00',
//     execution_cost_read_count: 0,
//     execution_cost_read_length: 0,
//     execution_cost_runtime: 0,
//     execution_cost_write_count: 0,
//     execution_cost_write_length: 0,
//   };
//   const tx1b: DbTx = {
//     ...tx1,
//     index_block_hash: block6.index_block_hash,
//     block_hash: block6.block_hash,
//     block_height: block6.block_height,
//     burn_block_time: block6.burn_block_time,
//     status: DbTxStatus.Success,
//     raw_result: '0x0100000000000000000000000000000001', // u1
//     canonical: true,
//     event_count: 0,
//   };

//   await db.updateMempoolTxs({ mempoolTxs: [tx1Mempool] });
//   const txQuery1 = await db.getMempoolTx({ txId: tx1Mempool.tx_id, includeUnanchored: false });
//   expect(txQuery1.found).toBe(true);
//   expect(txQuery1?.result?.status).toBe(DbTxStatus.Pending);
//   expect(txQuery1?.result?.raw_tx).toBe('0x746573742d7261772d7478');

//   for (const block of [block1, block2, block3]) {
//     await db.update({
//       block: block,
//       microblocks: [],
//       minerRewards: [],
//       txs: [],
//     });
//   }
//   await db.update({
//     block: block3B,
//     microblocks: [],
//     minerRewards: [],
//     txs: [
//       {
//         tx: tx1,
//         stxLockEvents: [],
//         stxEvents: [],
//         ftEvents: [],
//         nftEvents: [],
//         contractLogEvents: [],
//         smartContracts: [],
//         names: [],
//         namespaces: [],
//       },
//     ],
//   });
//   // tx should still be in mempool since it was included in a non-canonical chain-tip
//   const txQuery2 = await db.getMempoolTx({ txId: tx1Mempool.tx_id, includeUnanchored: false });
//   expect(txQuery2.found).toBe(true);
//   expect(txQuery2?.result?.status).toBe(DbTxStatus.Pending);

//   await db.update({
//     block: block4B,
//     microblocks: [],
//     minerRewards: [],
//     txs: [],
//   });
//   // the fork containing this tx was made canonical, it should no longer be in the mempool
//   const txQuery3 = await db.getMempoolTx({ txId: tx1Mempool.tx_id, includeUnanchored: false });
//   expect(txQuery3.found).toBe(false);

//   // the tx should be in the mined tx table, marked as canonical and success status
//   const txQuery4 = await db.getTx({ txId: tx1.tx_id, includeUnanchored: false });
//   expect(txQuery4.found).toBe(true);
//   expect(txQuery4?.result?.status).toBe(DbTxStatus.Success);
//   expect(txQuery4?.result?.canonical).toBe(true);
//   expect(txQuery4?.result?.raw_tx).toBe('0x746573742d7261772d7478');

//   // reorg the chain to make the tx no longer canonical
//   for (const block of [block4, block5]) {
//     await db.update({
//       block: block,
//       microblocks: [],
//       minerRewards: [],
//       txs: [],
//     });
//   }

//   // the tx should be in the mined tx table, marked as non-canonical
//   const txQuery5 = await db.getTx({ txId: tx1.tx_id, includeUnanchored: false });
//   expect(txQuery5.found).toBe(true);
//   expect(txQuery5?.result?.status).toBe(DbTxStatus.Success);
//   expect(txQuery5?.result?.canonical).toBe(false);

//   // the fork containing this tx was made canonical again, it should now in the mempool
//   const txQuery6 = await db.getMempoolTx({ txId: tx1Mempool.tx_id, includeUnanchored: false });
//   expect(txQuery6.found).toBe(true);
//   expect(txQuery6?.result?.status).toBe(DbTxStatus.Pending);

//   // mine the same tx in the latest canonical block
//   await db.update({
//     block: block6,
//     microblocks: [],
//     minerRewards: [],
//     txs: [
//       {
//         tx: tx1b,
//         stxLockEvents: [],
//         stxEvents: [],
//         ftEvents: [],
//         nftEvents: [],
//         contractLogEvents: [],
//         smartContracts: [],
//         names: [],
//         namespaces: [],
//       },
//     ],
//   });

//   // tx should no longer be in the mempool after being mined
//   const txQuery7 = await db.getMempoolTx({ txId: tx1b.tx_id, includeUnanchored: false });
//   expect(txQuery7.found).toBe(false);

//   // tx should be back in the mined tx table and associated with the new block
//   const txQuery8 = await db.getTx({ txId: tx1b.tx_id, includeUnanchored: false });
//   expect(txQuery8.found).toBe(true);
//   expect(txQuery8.result?.index_block_hash).toBe(block6.index_block_hash);
//   expect(txQuery8.result?.canonical).toBe(true);
//   expect(txQuery8.result?.status).toBe(DbTxStatus.Success);
// });

//   test("TEMPORARY. Re-org'ed txs that weren't previously in the mempool don't get INSERTED/show up in the mempool. Existing mempool txs get UPDATED", async () => {
//     // const garbageThresholdOrig = process.env.STACKS_MEMPOOL_TX_GARBAGE_COLLECTION_THRESHOLD;
//     // process.env.STACKS_MEMPOOL_TX_GARBAGE_COLLECTION_THRESHOLD = '2';
//     // Insert 5 blocks with 1 mempool tx each.
//     let blockHeight = 1;
//     for (; blockHeight <= 5; blockHeight++) {
//       const block = new TestBlockBuilder({
//         blockHeight: blockHeight,
//         index_block_hash: `0x0${blockHeight}`,
//         parent_index_block_hash: `0x0${blockHeight - 1}`,
//       })
//         .addTx({ tx_id: `0x111${blockHeight}` })
//         .build();
//       await db.update(block);
//       const mempoolTx = testMempoolTx({ tx_id: `0x0${blockHeight}` });
//       await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });
//     }

//     const block = new TestBlockBuilder({
//       blockHeight: blockHeight,
//       index_block_hash: `0x0${blockHeight}`,
//       parent_index_block_hash: `0x0${blockHeight - 1}`,
//     })
//       .addTx({ tx_id: `0x111${blockHeight}` })
//       .build();
//     await db.update(block);
//     // Do not include the tx in the mempool for test simulation
//     // const mempoolTx = testMempoolTx({ tx_id: `0x0${blockHeight}` });
//     // await db.updateMempoolTxs({ mempoolTxs: [mempoolTx] });

//     // Make sure we only have mempool txs for block_height >= 3
//     const mempoolTxResult = await db.getMempoolTxList({
//       limit: 10,
//       offset: 0,
//       includeUnanchored: false,
//     });
//     // const mempoolTxs = mempoolTxResult.results;
//     // expect(mempoolTxs.length).toEqual(3);
//     // const txIds = mempoolTxs.map(e => e.tx_id).sort();
//     // expect(txIds).toEqual(['0x03', '0x04', '0x05']);
//   });
// });
