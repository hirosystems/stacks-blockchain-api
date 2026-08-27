import { describe, test, beforeEach, afterEach } from 'node:test';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { ApiServer, startApiServer } from '../../../src/api/init.ts';
import { migrate } from '../../test-helpers.ts';
import { STACKS_TESTNET } from '@stacks/network';
import * as assert from 'node:assert/strict';
import { TestBlockBuilder } from '../test-builders.ts';
import { DbAssetEventTypeId } from '../../../src/datastore/common.ts';
import { hex } from '../test-helpers.ts';

describe('fungible token holders', () => {
  let db: PgWriteStore;
  let api: ApiServer;

  // Addresses chosen so that ascending balance order and ascending address order
  // differ, letting the `(balance DESC, address ASC)` tiebreak be asserted.
  const holderA = 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4';
  const holderB = 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C';
  const holderC = 'ST3J8EVYHVKH6XXPD61EE8XEHW4Y2K83861225AB1';
  const holderContract = 'ST27W5M8BRKA7C5MZE2R1S1F4XTPHFWFRNHA9M04Y.hello-world';
  const treasury = 'ST2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1MH';

  const token = 'SP000000000000000000002Q6VF78.token-aeusdc::aeUSDC';
  const otherToken = 'SP000000000000000000002Q6VF78.token-other::other';

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

  const getHolders = async (path: string, query: Record<string, string> = {}) => {
    const res = await api.fastifyApp.inject({ method: 'GET', url: path, query });
    assert.equal(res.statusCode, 200, res.body);
    return JSON.parse(res.body);
  };

  /**
   * Mints the token to four holders, plus a fifth that transfers its whole
   * position away (netting to zero), plus an unrelated token and some STX.
   */
  const buildFtBlock = () =>
    new TestBlockBuilder({
      block_height: 1,
      block_hash: hex(1),
      index_block_hash: hex(1),
      parent_index_block_hash: hex(0),
      parent_block_hash: hex(0),
    })
      .addTx({ tx_id: hex(0x11) })
      .addTxFtEvent({
        asset_event_type_id: DbAssetEventTypeId.Mint,
        recipient: holderA,
        asset_identifier: token,
        amount: 3_000_000n,
      })
      // holderB and holderContract share a balance, so their relative order is
      // decided by the address tiebreak.
      .addTxFtEvent({
        asset_event_type_id: DbAssetEventTypeId.Mint,
        recipient: holderB,
        asset_identifier: token,
        amount: 2_000_000n,
      })
      .addTxFtEvent({
        asset_event_type_id: DbAssetEventTypeId.Mint,
        recipient: holderContract,
        asset_identifier: token,
        amount: 2_000_000n,
      })
      .addTxFtEvent({
        asset_event_type_id: DbAssetEventTypeId.Mint,
        recipient: holderC,
        asset_identifier: token,
        amount: 1_000_000n,
      })
      // Nets to zero: minted then fully transferred away, so not a holder.
      .addTxFtEvent({
        asset_event_type_id: DbAssetEventTypeId.Mint,
        recipient: treasury,
        asset_identifier: token,
        amount: 500_000n,
      })
      .addTxFtEvent({
        asset_event_type_id: DbAssetEventTypeId.Burn,
        sender: treasury,
        asset_identifier: token,
        amount: 500_000n,
      })
      // A different token, and STX, must not leak into this token's holders.
      .addTxFtEvent({
        asset_event_type_id: DbAssetEventTypeId.Mint,
        recipient: holderA,
        asset_identifier: otherToken,
        amount: 7_000_000n,
      })
      .addTxStxEvent({
        asset_event_type_id: DbAssetEventTypeId.Mint,
        recipient: holderA,
        amount: 9_999n,
      })
      .build();

  const ftHoldersUrl = `/extended/v3/tokens/ft/${token}/holders`;

  describe('ft holders', () => {
    test('returns an empty page for a token with no holders', async () => {
      const unknown = 'SP000000000000000000002Q6VF78.token-none::none';
      const body = await getHolders(`/extended/v3/tokens/ft/${unknown}/holders`);
      assert.deepEqual(body, {
        total: 0,
        limit: 100,
        cursor: { next: null, previous: null, current: null },
        results: [],
      });
    });

    test('lists holders by balance descending, excluding zero balances and other tokens', async () => {
      await db.update(buildFtBlock());
      const body = await getHolders(ftHoldersUrl);
      assert.equal(body.total, 4);
      assert.deepEqual(body.results, [
        { principal: holderA, balance: '3000000' },
        // Equal balances break by address ascending.
        { principal: holderContract, balance: '2000000' },
        { principal: holderB, balance: '2000000' },
        { principal: holderC, balance: '1000000' },
      ]);
      assert.deepEqual(body.cursor, {
        next: null,
        previous: null,
        current: `3000000:${holderA}`,
      });
    });

    test('paginates forwards and backwards with cursors', async () => {
      await db.update(buildFtBlock());

      const page1 = await getHolders(ftHoldersUrl, { limit: '2' });
      assert.equal(page1.total, 4);
      assert.equal(page1.limit, 2);
      assert.deepEqual(page1.results, [
        { principal: holderA, balance: '3000000' },
        { principal: holderContract, balance: '2000000' },
      ]);
      assert.equal(page1.cursor.previous, null);
      assert.equal(page1.cursor.next, `2000000:${holderB}`);

      const page2 = await getHolders(ftHoldersUrl, { limit: '2', cursor: page1.cursor.next });
      assert.deepEqual(page2.results, [
        { principal: holderB, balance: '2000000' },
        { principal: holderC, balance: '1000000' },
      ]);
      assert.equal(page2.cursor.next, null);
      assert.equal(page2.cursor.current, `2000000:${holderB}`);

      // Walking back from page 2 returns page 1.
      const back = await getHolders(ftHoldersUrl, { limit: '2', cursor: page2.cursor.previous });
      assert.deepEqual(back.results, page1.results);
    });

    test('rejects a malformed asset identifier', async () => {
      const res = await api.fastifyApp.inject({
        method: 'GET',
        url: '/extended/v3/tokens/ft/not-an-asset-id/holders',
      });
      assert.equal(res.statusCode, 400, res.body);
    });
  });

  describe('stx holders', () => {
    const stxHoldersUrl = '/extended/v3/tokens/stx/holders';

    test('lists STX holders and excludes fungible token balances', async () => {
      await db.update(
        new TestBlockBuilder({
          block_height: 1,
          block_hash: hex(1),
          index_block_hash: hex(1),
          parent_index_block_hash: hex(0),
          parent_block_hash: hex(0),
        })
          .addTx({ tx_id: hex(0x11) })
          .addTxStxEvent({
            asset_event_type_id: DbAssetEventTypeId.Mint,
            recipient: holderA,
            amount: 5_000n,
          })
          .addTxStxEvent({
            asset_event_type_id: DbAssetEventTypeId.Mint,
            recipient: holderB,
            amount: 2_000n,
          })
          .addTxFtEvent({
            asset_event_type_id: DbAssetEventTypeId.Mint,
            recipient: holderC,
            asset_identifier: token,
            amount: 9_000_000n,
          })
          .build()
      );

      const body = await getHolders(stxHoldersUrl);
      assert.equal(body.total, 2);
      assert.deepEqual(body.results, [
        { principal: holderA, balance: '5000' },
        { principal: holderB, balance: '2000' },
      ]);
    });
  });

  describe('ft supply', () => {
    test('returns the sum of all balances', async () => {
      await db.update(buildFtBlock());
      const res = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/tokens/ft/${token}/supply`,
      });
      assert.equal(res.statusCode, 200, res.body);
      // 3M + 2M + 2M + 1M minted and still held; the 500k minted to the treasury
      // was burned again.
      assert.deepEqual(JSON.parse(res.body), {
        asset_identifier: token,
        total: '8000000',
      });
    });

    test('returns a zero supply for an unknown token', async () => {
      const unknown = 'SP000000000000000000002Q6VF78.token-none::none';
      const res = await api.fastifyApp.inject({
        method: 'GET',
        url: `/extended/v3/tokens/ft/${unknown}/supply`,
      });
      assert.equal(res.statusCode, 200, res.body);
      assert.deepEqual(JSON.parse(res.body), {
        asset_identifier: unknown,
        total: '0',
      });
    });
  });
});
