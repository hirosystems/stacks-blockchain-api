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

  const historyUrl = (value: string, assetId: string = asset) =>
    `/extended/v3/tokens/nft/${assetId}/${value}/history`;

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
      const body = await get(historyUrl(cvHex(999)));
      assert.deepEqual(body, {
        total: 0,
        limit: 50,
        cursor: { next: null, previous: null, current: null },
        results: [],
      });
    });

    test('returns one instance history newest first, scoped to that instance', async () => {
      await buildBlocks();
      const body = await get(historyUrl(tokenA));
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
      const body = await get(historyUrl(tokenB));
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
      const body = await get(historyUrl(tokenA, otherAsset));
      assert.equal(body.total, 1);
      assert.deepEqual(body.results[0].recipient, carol);
    });

    test('addresses the instance by a SIP-009 integer token id', async () => {
      await buildBlocks();
      // tokenA is `u1`, so `1` must resolve to the same instance as its serialized hex.
      const byInt = await get(historyUrl('1'));
      const byHex = await get(historyUrl(tokenA));
      assert.equal(byInt.total, 3);
      assert.deepEqual(byInt.results, byHex.results);
    });

    test('handles an integer token id beyond Number.MAX_SAFE_INTEGER', async () => {
      // Clarity uints are 128-bit; the id must survive as a string rather than a float.
      const bigId = '340282366920938463463374607431768211455';
      const res = await api.fastifyApp.inject({
        method: 'GET',
        url: historyUrl(bigId),
      });
      assert.equal(res.statusCode, 200, res.body);
      assert.equal(JSON.parse(res.body).total, 0);
    });

    test('rejects an integer token id above the uint128 max', async () => {
      // uintCV throws a RangeError past uint128 max; that must surface as a 400 rather than
      // an unhandled 500, matching how out-of-range cursor components are handled.
      const res = await api.fastifyApp.inject({
        method: 'GET',
        url: historyUrl('340282366920938463463374607431768211456'),
      });
      assert.equal(res.statusCode, 400, res.body);
    });

    test('rejects a value that is neither an integer nor 0x-prefixed hex', async () => {
      const res = await api.fastifyApp.inject({
        method: 'GET',
        url: historyUrl('deadbeef'),
      });
      assert.equal(res.statusCode, 400, res.body);
    });

    test('reads hex stripped of its 0x prefix as a decimal id, not as hex', async () => {
      await buildBlocks();
      // A serialized uint is all decimal digits (`0x0100…0803`), so dropping the prefix
      // leaves a string that matches the integer form and is read as a (huge) token id
      // rather than as hex. It resolves to nothing rather than erroring, which is why the
      // 0x prefix is required rather than optional -- pinned here so any change is deliberate.
      const body = await get(historyUrl(tokenA.replace(/^0x/, '')));
      assert.equal(body.total, 0);
      assert.deepEqual(body.results, []);
    });

    test('includes block and transaction position', async () => {
      await buildBlocks();
      const body = await get(historyUrl(tokenA));
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
      const page1 = await get(historyUrl(tokenA), { limit: '2' });
      assert.equal(page1.total, 3);
      assert.equal(page1.results.length, 2);
      assert.equal(page1.cursor.previous, null);

      const page2 = await get(historyUrl(tokenA), { limit: '2', cursor: page1.cursor.next });
      assert.deepEqual(
        page2.results.map((r: { sender: string | null; recipient: string | null }) => [
          r.sender,
          r.recipient,
        ]),
        [[null, alice]] // the mint, oldest event
      );
      assert.equal(page2.cursor.next, null);

      const back = await get(historyUrl(tokenA), { limit: '2', cursor: page2.cursor.previous });
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
      assert.equal((await get(historyUrl(tokenA))).total, 4);

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

      assert.equal((await get(historyUrl(tokenA))).total, 3);
    });

    test('does not match without a value segment', async () => {
      const res = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/tokens/nft/${asset}/history`,
      });
      assert.equal(res.statusCode, 404, res.body);
    });

    test('rejects a malformed asset identifier', async () => {
      const res = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/tokens/nft/not-an-asset-id/${tokenA}/history`,
      });
      assert.equal(res.statusCode, 400, res.body);
    });
  });
});
