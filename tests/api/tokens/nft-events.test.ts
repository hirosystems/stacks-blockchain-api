import { describe, test, beforeEach, afterEach } from 'node:test';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { ApiServer, startApiServer } from '../../../src/api/init.ts';
import { migrate } from '../../test-helpers.ts';
import { STACKS_TESTNET } from '@stacks/network';
import * as assert from 'node:assert/strict';
import { TestBlockBuilder } from '../test-builders.ts';
import { DbAssetEventTypeId } from '../../../src/datastore/common.ts';
import { hex } from '../test-helpers.ts';
import { serializeCV, uintCV } from '@stacks/transactions';

describe('nft events', () => {
  let db: PgWriteStore;
  let api: ApiServer;

  const alice = 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4';
  const bob = 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C';
  const carol = 'ST3J8EVYHVKH6XXPD61EE8XEHW4Y2K83861225AB1';

  const asset = 'SP000000000000000000002Q6VF78.guild::Guild';
  const otherAsset = 'SP000000000000000000002Q6VF78.other::Other';

  const cvHex = (n: number) => '0x' + serializeCV(uintCV(n));
  const tokenA = cvHex(1);
  const tokenB = cvHex(2);

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

  const get = async (path: string, query: Record<string, string> = {}) => {
    const res = await api.fastifyApp.inject({ method: 'GET', url: path, query });
    assert.equal(res.statusCode, 200, res.body);
    return JSON.parse(res.body);
  };

  const historyUrl = `/extended/v3/tokens/nft/${asset}/history`;
  const mintsUrl = `/extended/v3/tokens/nft/${asset}/mints`;

  /**
   * Block 1 mints tokenA to alice and tokenB to bob, plus a mint of a different asset class.
   * Block 2 moves tokenA alice -> bob -> carol and then burns tokenB.
   */
  const buildBlocks = async () => {
    await db.update(
      new TestBlockBuilder({
        block_height: 1,
        block_hash: hex(1),
        index_block_hash: hex(1),
        parent_index_block_hash: hex(0),
        parent_block_hash: hex(0),
      })
        .addTx({ tx_id: hex(0x11) })
        .addTxNftEvent({
          asset_event_type_id: DbAssetEventTypeId.Mint,
          recipient: alice,
          asset_identifier: asset,
          value: tokenA,
        })
        .addTxNftEvent({
          asset_event_type_id: DbAssetEventTypeId.Mint,
          recipient: bob,
          asset_identifier: asset,
          value: tokenB,
        })
        .addTxNftEvent({
          asset_event_type_id: DbAssetEventTypeId.Mint,
          recipient: carol,
          asset_identifier: otherAsset,
          value: tokenA,
        })
        .build()
    );
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        block_hash: hex(2),
        index_block_hash: hex(2),
        parent_index_block_hash: hex(1),
        parent_block_hash: hex(1),
      })
        .addTx({ tx_id: hex(0x22) })
        .addTxNftEvent({
          sender: alice,
          recipient: bob,
          asset_identifier: asset,
          value: tokenA,
        })
        .addTxNftEvent({
          sender: bob,
          recipient: carol,
          asset_identifier: asset,
          value: tokenA,
        })
        .addTxNftEvent({
          asset_event_type_id: DbAssetEventTypeId.Burn,
          sender: bob,
          asset_identifier: asset,
          value: tokenB,
        })
        .build()
    );
  };

  describe('history', () => {
    test('returns an empty page for an instance with no events', async () => {
      await buildBlocks();
      const body = await get(historyUrl, { value: cvHex(999) });
      assert.deepEqual(body, {
        total: 0,
        limit: 50,
        cursor: { next: null, previous: null, current: null },
        results: [],
      });
    });

    test('returns one instance history newest first, scoped to that instance', async () => {
      await buildBlocks();
      const body = await get(historyUrl, { value: tokenA });
      assert.equal(body.total, 3);
      assert.deepEqual(
        body.results.map((r: { sender: string | null; recipient: string | null }) => [
          r.sender,
          r.recipient,
        ]),
        [
          [bob, carol], // transfer
          [alice, bob], // transfer
          [null, alice], // mint: null sender
        ]
      );
    });

    test('separates instances of the same asset class', async () => {
      await buildBlocks();
      const body = await get(historyUrl, { value: tokenB });
      assert.deepEqual(
        body.results.map((r: { sender: string | null; recipient: string | null }) => [
          r.sender,
          r.recipient,
        ]),
        [
          [bob, null], // burn: null recipient
          [null, bob], // mint: null sender
        ]
      );
    });

    test('excludes the same instance value under a different asset class', async () => {
      await buildBlocks();
      const body = await get(`/extended/v3/tokens/nft/${otherAsset}/history`, { value: tokenA });
      assert.equal(body.total, 1);
      assert.deepEqual(body.results[0].recipient, carol);
    });

    test('accepts a value without the 0x prefix', async () => {
      await buildBlocks();
      const body = await get(historyUrl, { value: tokenA.replace(/^0x/, '') });
      assert.equal(body.total, 3);
    });

    test('includes block and transaction position', async () => {
      await buildBlocks();
      const body = await get(historyUrl, { value: tokenA });
      const first = body.results[0];
      assert.equal(first.transaction.tx_id, hex(0x22));
      assert.equal(typeof first.transaction.event_index, 'number');
      assert.equal(first.block.height, 2);
      assert.equal(first.block.hash, hex(2));
      assert.equal(first.block.index_hash, hex(2));
      assert.equal(typeof first.block.time, 'number');
    });

    test('paginates with cursors', async () => {
      await buildBlocks();
      const page1 = await get(historyUrl, { value: tokenA, limit: '2' });
      assert.equal(page1.total, 3);
      assert.equal(page1.results.length, 2);
      assert.equal(page1.cursor.previous, null);

      const page2 = await get(historyUrl, {
        value: tokenA,
        limit: '2',
        cursor: page1.cursor.next,
      });
      assert.deepEqual(
        page2.results.map((r: { sender: string | null; recipient: string | null }) => [
          r.sender,
          r.recipient,
        ]),
        [[null, alice]] // the mint, oldest event
      );
      assert.equal(page2.cursor.next, null);

      const back = await get(historyUrl, {
        value: tokenA,
        limit: '2',
        cursor: page2.cursor.previous,
      });
      assert.deepEqual(back.results, page1.results);
    });

    test('excludes events orphaned by a reorg', async () => {
      await buildBlocks();
      await db.update(
        new TestBlockBuilder({
          block_height: 3,
          block_hash: hex(0x3a),
          index_block_hash: hex(0x3a),
          parent_index_block_hash: hex(2),
          parent_block_hash: hex(2),
        })
          .addTx({ tx_id: hex(0x33a) })
          .addTxNftEvent({
            sender: carol,
            recipient: alice,
            asset_identifier: asset,
            value: tokenA,
          })
          .build()
      );
      assert.equal((await get(historyUrl, { value: tokenA })).total, 4);

      await db.update(
        new TestBlockBuilder({
          block_height: 3,
          block_hash: hex(0x3b),
          index_block_hash: hex(0x3b),
          parent_index_block_hash: hex(2),
          parent_block_hash: hex(2),
        })
          .addTx({ tx_id: hex(0x33b) })
          .build()
      );
      await db.update(
        new TestBlockBuilder({
          block_height: 4,
          block_hash: hex(4),
          index_block_hash: hex(4),
          parent_index_block_hash: hex(0x3b),
          parent_block_hash: hex(0x3b),
        })
          .addTx({ tx_id: hex(0x44) })
          .build()
      );

      assert.equal((await get(historyUrl, { value: tokenA })).total, 3);
    });

    test('requires a value', async () => {
      const res = await api.fastifyApp.inject({ method: 'GET', url: historyUrl });
      assert.equal(res.statusCode, 400, res.body);
    });

    test('rejects a malformed asset identifier', async () => {
      const res = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/tokens/nft/not-an-asset-id/history',
        query: { value: tokenA },
      });
      assert.equal(res.statusCode, 400, res.body);
    });
  });

  describe('mints', () => {
    test('returns an empty page for an asset class with no mints', async () => {
      await buildBlocks();
      const body = await get(
        '/extended/v3/tokens/nft/SP000000000000000000002Q6VF78.none::None/mints'
      );
      assert.deepEqual(body.results, []);
      assert.equal(body.total, 0);
    });

    test('returns only mint events for the asset class, newest first', async () => {
      await buildBlocks();
      const body = await get(mintsUrl);
      assert.equal(body.total, 2);
      assert.deepEqual(
        body.results.map((r: { recipient: string; value: { hex: string; repr: string } }) => [
          r.recipient,
          r.value.hex,
          r.value.repr,
        ]),
        [
          [bob, tokenB, 'u2'],
          [alice, tokenA, 'u1'],
        ]
      );
    });

    test('paginates with cursors', async () => {
      await buildBlocks();
      const page1 = await get(mintsUrl, { limit: '1' });
      assert.equal(page1.total, 2);
      assert.deepEqual(page1.results[0].recipient, bob);

      const page2 = await get(mintsUrl, { limit: '1', cursor: page1.cursor.next });
      assert.deepEqual(page2.results[0].recipient, alice);
      assert.equal(page2.cursor.next, null);
    });

    test('excludes events orphaned by a reorg', async () => {
      await buildBlocks();
      await db.update(
        new TestBlockBuilder({
          block_height: 3,
          block_hash: hex(0x3a),
          index_block_hash: hex(0x3a),
          parent_index_block_hash: hex(2),
          parent_block_hash: hex(2),
        })
          .addTx({ tx_id: hex(0x33a) })
          .addTxNftEvent({
            asset_event_type_id: DbAssetEventTypeId.Mint,
            recipient: carol,
            asset_identifier: asset,
            value: cvHex(3),
          })
          .build()
      );
      assert.equal((await get(mintsUrl)).total, 3);

      await db.update(
        new TestBlockBuilder({
          block_height: 3,
          block_hash: hex(0x3b),
          index_block_hash: hex(0x3b),
          parent_index_block_hash: hex(2),
          parent_block_hash: hex(2),
        })
          .addTx({ tx_id: hex(0x33b) })
          .build()
      );
      await db.update(
        new TestBlockBuilder({
          block_height: 4,
          block_hash: hex(4),
          index_block_hash: hex(4),
          parent_index_block_hash: hex(0x3b),
          parent_block_hash: hex(0x3b),
        })
          .addTx({ tx_id: hex(0x44) })
          .build()
      );

      assert.equal((await get(mintsUrl)).total, 2);
    });
  });
});
