import { describe, test, beforeEach, afterEach } from 'node:test';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { ApiServer, startApiServer } from '../../../src/api/init.ts';
import { migrate } from '../../test-helpers.ts';
import { STACKS_TESTNET } from '@stacks/network';
import * as assert from 'node:assert/strict';
import { TestBlockBuilder } from '../test-builders.ts';
import { DbAssetEventTypeId } from '../../../src/datastore/common.ts';
import { hex } from '../test-helpers.ts';

describe('stx supply', () => {
  let db: PgWriteStore;
  let api: ApiServer;

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    api = await startApiServer({ datastore: db, chainId: STACKS_TESTNET.chainId });
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await migrate('down');
  });

  async function getSupply(): Promise<{ total: string; projected_total_2050: string }> {
    const res = await api.fastifyApp.inject({ method: 'GET', url: '/extended/v3/stx/supply' });
    assert.equal(res.statusCode, 200);
    return JSON.parse(res.body);
  }

  test('accumulates mints, burns, and matured coinbase rewards', async () => {
    assert.equal((await getSupply()).total, '0');

    // Mints and a matured coinbase reward increase the supply.
    await db.update(
      new TestBlockBuilder({
        block_height: 1,
        index_block_hash: hex(1),
        parent_index_block_hash: hex(0),
      })
        .addTx({ tx_id: hex(0x11) })
        .addTxStxEvent({ asset_event_type_id: DbAssetEventTypeId.Mint, amount: 1000n })
        .addMinerReward({ coinbase_amount: 100n, tx_fees_anchored: 7n })
        .build()
    );
    // Miner tx fees are redistribution, not new supply — only the coinbase counts.
    assert.equal((await getSupply()).total, '1100');

    // Burns decrease it; transfers don't affect it.
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        index_block_hash: hex(2),
        parent_index_block_hash: hex(1),
      })
        .addTx({ tx_id: hex(0x22) })
        .addTxStxEvent({ asset_event_type_id: DbAssetEventTypeId.Mint, amount: 500n })
        .addTxStxEvent({ asset_event_type_id: DbAssetEventTypeId.Burn, amount: 200n })
        .addTxStxEvent({ asset_event_type_id: DbAssetEventTypeId.Transfer, amount: 10_000n })
        .build()
    );
    const supply = await getSupply();
    assert.equal(supply.total, '1400');
    assert.equal(supply.projected_total_2050, '2318000000000000');
  });

  test('adjusts for reorgs', async () => {
    await db.update(
      new TestBlockBuilder({
        block_height: 1,
        index_block_hash: hex(1),
        parent_index_block_hash: hex(0),
      })
        .addTx({ tx_id: hex(0x11) })
        .addTxStxEvent({ asset_event_type_id: DbAssetEventTypeId.Mint, amount: 1000n })
        .addMinerReward({ coinbase_amount: 100n })
        .build()
    );

    // Canonical block 2a: mint + burn + matured coinbase.
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        index_block_hash: hex(0x2a),
        parent_index_block_hash: hex(1),
      })
        .addTx({ tx_id: hex(0x22a) })
        .addTxStxEvent({ asset_event_type_id: DbAssetEventTypeId.Mint, amount: 500n })
        .addTxStxEvent({ asset_event_type_id: DbAssetEventTypeId.Burn, amount: 200n })
        .addMinerReward({ coinbase_amount: 70n })
        .build()
    );
    assert.equal((await getSupply()).total, '1470');

    // Sibling block 2b arrives non-canonical: no supply change.
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        index_block_hash: hex(0x2b),
        parent_index_block_hash: hex(1),
      })
        .addTx({ tx_id: hex(0x22b) })
        .addTxStxEvent({ asset_event_type_id: DbAssetEventTypeId.Mint, amount: 50n })
        .build()
    );
    assert.equal((await getSupply()).total, '1470');

    // Block 3b builds on 2b: 2a is orphaned (mint − burn + coinbase reverted) and 2b is
    // restored, then 3b's own mint applies.
    await db.update(
      new TestBlockBuilder({
        block_height: 3,
        index_block_hash: hex(3),
        parent_index_block_hash: hex(0x2b),
      })
        .addTx({ tx_id: hex(0x33) })
        .addTxStxEvent({ asset_event_type_id: DbAssetEventTypeId.Mint, amount: 25n })
        .build()
    );
    // 1000 + 100 (block 1) + 50 (block 2b) + 25 (block 3b)
    assert.equal((await getSupply()).total, '1175');
  });
});
