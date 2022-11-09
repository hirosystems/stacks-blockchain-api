import { ChainID } from '@stacks/transactions';
import { startApiServer, ApiServer } from '../api/init';
import { PgWriteStore } from '../datastore/pg-write-store';
import { cycleMigrations, runMigrations } from '../datastore/migrations';
import { TestBlockBuilder, testMempoolTx } from '../test-utils/test-builders';

describe('mempool tests', () => {
  let db: PgWriteStore;
  let api: ApiServer;

  beforeEach(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
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
        index_block_hash: `0x${chainA_BlockHeight.toString().repeat(2)}${chainA_Suffix}`,
        parent_index_block_hash: `0x${(chainA_BlockHeight - 1)
          .toString()
          .repeat(2)}${chainA_Suffix}`,
      })
        .addTx({ tx_id: `0x0${txId++}${chainA_Suffix}` })
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
        .addTx({ tx_id: `0x0${txId++}${chainB_Suffix}` }) // Txs that don't exist in the mempool and will be reorged
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
});
