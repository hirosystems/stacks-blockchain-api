import assert from 'node:assert/strict';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { DbTxStatus } from '../../../src/datastore/common.ts';
import { TestBlockBuilder, testMempoolTx } from '../test-builders.ts';
import { migrate } from '../../test-helpers.ts';
import { beforeEach, afterEach, describe, test } from 'node:test';

describe('nakamoto re-org handling', () => {
  let db: PgWriteStore;

  const SIGNER_BITVEC = '1111';

  /**
   * Builds a signer-validated (Nakamoto) test block. `hash` is used for both `block_hash` and
   * `index_block_hash` to keep test chains easy to follow.
   */
  function nakamotoBlock(args: {
    height: number;
    hash: string;
    parent: string;
    txId?: string;
  }): TestBlockBuilder {
    const builder = new TestBlockBuilder({
      block_height: args.height,
      block_hash: args.hash,
      index_block_hash: args.hash,
      parent_index_block_hash: args.parent,
      signer_bitvec: SIGNER_BITVEC,
    });
    if (args.txId) {
      // Give each tx a unique sender so mempool prune/restore logic (which also matches txs by
      // sender and nonce) treats them as independent.
      builder.addTx({ tx_id: args.txId, sender_address: `SP${args.txId}` });
    }
    return builder;
  }

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
  });

  afterEach(async () => {
    await db.close();
    await migrate('down');
  });

  test('switches to a same-height sibling block immediately', async () => {
    await db.updateMempoolTxs({
      mempoolTxs: [testMempoolTx({ tx_id: '0x0301', sender_address: 'SP0x0301' })],
    });

    await db.update(nakamotoBlock({ height: 1, hash: '0xa1', parent: '0x00' }).build());
    await db.update(nakamotoBlock({ height: 2, hash: '0xa2', parent: '0xa1', txId: '0x0201' }).build());
    await db.update(nakamotoBlock({ height: 3, hash: '0xa3', parent: '0xa2', txId: '0x0301' }).build());

    // The mempool tx was mined in block 0xa3.
    const mempoolQuery1 = await db.getMempoolTx({ txId: '0x0301', includeUnanchored: false });
    assert.equal(mempoolQuery1.found, false);
    let chainTip = await db.getChainTip(db.sql);
    assert.equal(chainTip.block_height, 3);
    assert.equal(chainTip.index_block_hash, '0xa3');
    assert.equal(chainTip.tx_count, 2);

    // A sibling block at the same height arrives. It must become the canonical chain tip
    // immediately, without waiting for the fork to become the longest chain.
    await db.update(nakamotoBlock({ height: 3, hash: '0xb3', parent: '0xa2', txId: '0x0302' }).build());

    chainTip = await db.getChainTip(db.sql);
    assert.equal(chainTip.block_height, 3);
    assert.equal(chainTip.index_block_hash, '0xb3');
    assert.equal(chainTip.block_count, 3);
    assert.equal(chainTip.tx_count, 2);
    assert.equal(chainTip.tx_count_unanchored, 2);

    const blockA3 = await db.getBlock({ hash: '0xa3' });
    assert.equal(blockA3.result?.canonical, false);
    const blockB3 = await db.getBlock({ hash: '0xb3' });
    assert.equal(blockB3.result?.canonical, true);

    const txA = await db.getTx({ txId: '0x0301', includeUnanchored: false });
    assert.equal(txA.result?.canonical, false);
    const txB = await db.getTx({ txId: '0x0302', includeUnanchored: false });
    assert.equal(txB.result?.canonical, true);

    // The orphaned block's tx is restored to the mempool.
    const mempoolQuery2 = await db.getMempoolTx({ txId: '0x0301', includeUnanchored: false });
    assert.equal(mempoolQuery2.found, true);
    assert.equal(mempoolQuery2.result?.status, DbTxStatus.Pending);
  });

  test('moves the chain tip backwards when a shorter fork becomes canonical', async () => {
    await db.updateMempoolTxs({
      mempoolTxs: [testMempoolTx({ tx_id: '0x0401', sender_address: 'SP0x0401' })],
    });

    await db.update(nakamotoBlock({ height: 1, hash: '0xa1', parent: '0x00' }).build());
    await db.update(nakamotoBlock({ height: 2, hash: '0xa2', parent: '0xa1', txId: '0x0201' }).build());
    await db.update(nakamotoBlock({ height: 3, hash: '0xa3', parent: '0xa2', txId: '0x0301' }).build());
    await db.update(nakamotoBlock({ height: 4, hash: '0xa4', parent: '0xa3', txId: '0x0401' }).build());
    await db.update(nakamotoBlock({ height: 5, hash: '0xa5', parent: '0xa4', txId: '0x0501' }).build());

    let chainTip = await db.getChainTip(db.sql);
    assert.equal(chainTip.block_height, 5);
    assert.equal(chainTip.tx_count, 4);

    // A fork block arrives at height 3, building off canonical block 2. The chain tip must move
    // backwards to height 3 and blocks 3, 4 and 5 must be orphaned.
    await db.update(nakamotoBlock({ height: 3, hash: '0xb3', parent: '0xa2', txId: '0x0302' }).build());

    chainTip = await db.getChainTip(db.sql);
    assert.equal(chainTip.block_height, 3);
    assert.equal(chainTip.index_block_hash, '0xb3');
    assert.equal(chainTip.block_count, 3);
    assert.equal(chainTip.tx_count, 2);
    assert.equal(chainTip.tx_count_unanchored, 2);

    for (const orphaned of ['0xa3', '0xa4', '0xa5']) {
      const block = await db.getBlock({ hash: orphaned });
      assert.equal(block.result?.canonical, false, `block ${orphaned} should be orphaned`);
    }
    // Note: txs 0x0401 and 0x0501 sit above the new chain tip height so they are not visible via
    // `getTx`; check their canonical flags directly.
    for (const orphanedTx of ['0x0301', '0x0401', '0x0501']) {
      const txResult = await db.sql<{ canonical: boolean }[]>`
        SELECT canonical FROM txs WHERE tx_id = ${orphanedTx}
      `;
      assert.equal(txResult.length, 1);
      assert.equal(txResult[0].canonical, false, `tx ${orphanedTx} should be non-canonical`);
    }
    const txB = await db.getTx({ txId: '0x0302', includeUnanchored: false });
    assert.equal(txB.result?.canonical, true);

    // The orphaned tx that was in the mempool is restored.
    const mempoolQuery = await db.getMempoolTx({ txId: '0x0401', includeUnanchored: false });
    assert.equal(mempoolQuery.found, true);
    assert.equal(mempoolQuery.result?.status, DbTxStatus.Pending);
  });

  test('restores a previously orphaned chain when a new block builds on it', async () => {
    await db.update(nakamotoBlock({ height: 1, hash: '0xa1', parent: '0x00' }).build());
    await db.update(nakamotoBlock({ height: 2, hash: '0xa2', parent: '0xa1', txId: '0x0201' }).build());
    await db.update(nakamotoBlock({ height: 3, hash: '0xa3', parent: '0xa2', txId: '0x0301' }).build());
    await db.update(nakamotoBlock({ height: 4, hash: '0xa4', parent: '0xa3', txId: '0x0401' }).build());
    await db.update(nakamotoBlock({ height: 5, hash: '0xa5', parent: '0xa4', txId: '0x0501' }).build());
    // Shorter fork wins at height 3.
    await db.update(nakamotoBlock({ height: 3, hash: '0xb3', parent: '0xa2', txId: '0x0302' }).build());

    // Now a block arrives building off the previously orphaned block 0xa4: blocks 0xa3 and 0xa4
    // are restored, 0xb3 is orphaned, and the new block becomes the tip.
    await db.update(nakamotoBlock({ height: 5, hash: '0xc5', parent: '0xa4', txId: '0x0502' }).build());

    const chainTip = await db.getChainTip(db.sql);
    assert.equal(chainTip.block_height, 5);
    assert.equal(chainTip.index_block_hash, '0xc5');
    assert.equal(chainTip.block_count, 5);
    assert.equal(chainTip.tx_count, 4);

    const canonical = ['0xa1', '0xa2', '0xa3', '0xa4', '0xc5'];
    const nonCanonical = ['0xa5', '0xb3'];
    for (const hash of canonical) {
      const block = await db.getBlock({ hash });
      assert.equal(block.result?.canonical, true, `block ${hash} should be canonical`);
    }
    for (const hash of nonCanonical) {
      const block = await db.getBlock({ hash });
      assert.equal(block.result?.canonical, false, `block ${hash} should be orphaned`);
    }

    for (const txId of ['0x0201', '0x0301', '0x0401', '0x0502']) {
      const tx = await db.getTx({ txId, includeUnanchored: false });
      assert.equal(tx.result?.canonical, true, `tx ${txId} should be canonical`);
    }
    for (const txId of ['0x0302', '0x0501']) {
      const tx = await db.getTx({ txId, includeUnanchored: false });
      assert.equal(tx.result?.canonical, false, `tx ${txId} should be non-canonical`);
    }
  });

  test('switches when the new block builds on a non-canonical sibling of the tip', async () => {
    await db.update(nakamotoBlock({ height: 1, hash: '0xa1', parent: '0x00' }).build());
    await db.update(nakamotoBlock({ height: 2, hash: '0xa2', parent: '0xa1', txId: '0x0201' }).build());
    await db.update(nakamotoBlock({ height: 3, hash: '0xa3', parent: '0xa2', txId: '0x0301' }).build());
    // Sibling switch at height 3.
    await db.update(nakamotoBlock({ height: 3, hash: '0xb3', parent: '0xa2', txId: '0x0302' }).build());
    // A block at height 4 builds off the now-orphaned 0xa3.
    await db.update(nakamotoBlock({ height: 4, hash: '0xc4', parent: '0xa3', txId: '0x0402' }).build());

    const chainTip = await db.getChainTip(db.sql);
    assert.equal(chainTip.block_height, 4);
    assert.equal(chainTip.index_block_hash, '0xc4');
    assert.equal(chainTip.tx_count, 3);

    const blockA3 = await db.getBlock({ hash: '0xa3' });
    assert.equal(blockA3.result?.canonical, true);
    const blockB3 = await db.getBlock({ hash: '0xb3' });
    assert.equal(blockB3.result?.canonical, false);

    const txA = await db.getTx({ txId: '0x0301', includeUnanchored: false });
    assert.equal(txA.result?.canonical, true);
    const txB = await db.getTx({ txId: '0x0302', includeUnanchored: false });
    assert.equal(txB.result?.canonical, false);
  });

  test('ignores duplicate block events', async () => {
    await db.update(nakamotoBlock({ height: 1, hash: '0xa1', parent: '0x00' }).build());
    await db.update(nakamotoBlock({ height: 2, hash: '0xa2', parent: '0xa1', txId: '0x0201' }).build());
    await db.update(nakamotoBlock({ height: 3, hash: '0xa3', parent: '0xa2', txId: '0x0301' }).build());
    // Sibling switch at height 3.
    await db.update(nakamotoBlock({ height: 3, hash: '0xb3', parent: '0xa2', txId: '0x0302' }).build());

    // Re-delivering the now-orphaned block must not flip it back to canonical.
    await db.update(nakamotoBlock({ height: 3, hash: '0xa3', parent: '0xa2', txId: '0x0301' }).build());
    let chainTip = await db.getChainTip(db.sql);
    assert.equal(chainTip.block_height, 3);
    assert.equal(chainTip.index_block_hash, '0xb3');
    assert.equal(chainTip.tx_count, 2);
    const blockA3 = await db.getBlock({ hash: '0xa3' });
    assert.equal(blockA3.result?.canonical, false);
    const txA = await db.getTx({ txId: '0x0301', includeUnanchored: false });
    assert.equal(txA.result?.canonical, false);

    // Re-delivering the canonical chain tip is also a no-op.
    await db.update(nakamotoBlock({ height: 3, hash: '0xb3', parent: '0xa2', txId: '0x0302' }).build());
    chainTip = await db.getChainTip(db.sql);
    assert.equal(chainTip.block_height, 3);
    assert.equal(chainTip.index_block_hash, '0xb3');
    assert.equal(chainTip.tx_count, 2);
  });
});
