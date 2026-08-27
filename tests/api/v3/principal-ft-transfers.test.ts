import { describe, test, beforeEach, afterEach } from 'node:test';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { ApiServer, startApiServer } from '../../../src/api/init.ts';
import { migrate } from '../../test-helpers.ts';
import { STACKS_TESTNET } from '@stacks/network';
import * as assert from 'node:assert/strict';
import { TestBlockBuilder } from '../test-builders.ts';
import { DbAssetEventTypeId } from '../../../src/datastore/common.ts';
import { hex } from '../test-helpers.ts';

describe('principal ft transfers', () => {
  let db: PgWriteStore;
  let api: ApiServer;

  const principal = 'ST1HB64MAJ1MBV4CQ80GF01DZS4T1DSMX20ADCRA4';
  const counterparty = 'ST3DWSXBPYDB484QXFTR81K4AWG4ZB5XZNFF3H70C';
  const other = 'ST3J8EVYHVKH6XXPD61EE8XEHW4Y2K83861225AB1';

  const token = 'SP000000000000000000002Q6VF78.token-a::a';
  const otherToken = 'SP000000000000000000002Q6VF78.token-b::b';

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

  const url = (p = principal, asset = token) =>
    `/extended/v3/principals/${p}/transfers/ft/${asset}`;

  const get = async (path: string, query: Record<string, string> = {}) => {
    const res = await api.fastifyApp.inject({ method: 'GET', url: path, query });
    assert.equal(res.statusCode, 200, res.body);
    return JSON.parse(res.body);
  };

  /**
   * Block 1, in event order: a mint crediting the principal, an outbound transfer, an inbound
   * transfer, a burn debiting it, a transfer on a different token, and a transfer between two
   * unrelated parties. Both of the last two must be excluded.
   */
  const buildBlock = () =>
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
        recipient: principal,
        asset_identifier: token,
        amount: 1_000n,
      })
      .addTxFtEvent({
        sender: principal,
        recipient: counterparty,
        asset_identifier: token,
        amount: 250n,
      })
      .addTxFtEvent({
        sender: counterparty,
        recipient: principal,
        asset_identifier: token,
        amount: 75n,
      })
      .addTxFtEvent({
        asset_event_type_id: DbAssetEventTypeId.Burn,
        sender: principal,
        asset_identifier: token,
        amount: 40n,
      })
      .addTxFtEvent({
        sender: principal,
        recipient: counterparty,
        asset_identifier: otherToken,
        amount: 999n,
      })
      .addTxFtEvent({
        sender: counterparty,
        recipient: other,
        asset_identifier: token,
        amount: 500n,
      })
      .build();

  test('returns an empty page for a principal with no events for the asset', async () => {
    await db.update(buildBlock());
    const body = await get(url(other, otherToken));
    assert.deepEqual(body, {
      total: 0,
      limit: 20,
      cursor: { next: null, previous: null, current: null },
      results: [],
    });
  });

  test('merges inbound and outbound into one feed, newest first', async () => {
    await db.update(buildBlock());
    const body = await get(url());
    assert.equal(body.total, 4);
    // Newest first means descending event_index within the block.
    assert.deepEqual(
      body.results.map((r: { sender: string | null; recipient: string | null; amount: string }) => [
        r.sender,
        r.recipient,
        r.amount,
      ]),
      [
        [principal, null, '40'], // burn
        [counterparty, principal, '75'], // inbound
        [principal, counterparty, '250'], // outbound
        [null, principal, '1000'], // mint
      ]
    );
  });

  test('excludes other assets and events between unrelated parties', async () => {
    await db.update(buildBlock());
    const body = await get(url());
    for (const r of body.results as { sender: string | null; recipient: string | null }[]) {
      assert.ok(
        r.sender === principal || r.recipient === principal,
        `unrelated event in feed: ${JSON.stringify(r)}`
      );
    }
    assert.ok(!body.results.some((r: { amount: string }) => r.amount === '999'));
    assert.ok(!body.results.some((r: { amount: string }) => r.amount === '500'));
  });

  test('includes block and transaction position', async () => {
    await db.update(buildBlock());
    const body = await get(url());
    const first = body.results[0];
    assert.equal(first.transaction.tx_id, hex(0x11));
    assert.equal(typeof first.transaction.event_index, 'number');
    assert.equal(first.block.height, 1);
    assert.equal(first.block.hash, hex(1));
    assert.equal(first.block.index_hash, hex(1));
    assert.equal(typeof first.block.time, 'number');
    assert.equal(typeof first.block.tx_index, 'number');
  });

  test('paginates forwards and backwards with cursors', async () => {
    await db.update(buildBlock());

    const page1 = await get(url(), { limit: '2' });
    assert.equal(page1.total, 4);
    assert.deepEqual(
      page1.results.map((r: { amount: string }) => r.amount),
      ['40', '75']
    );
    assert.equal(page1.cursor.previous, null);
    assert.ok(page1.cursor.next);

    const page2 = await get(url(), { limit: '2', cursor: page1.cursor.next });
    assert.deepEqual(
      page2.results.map((r: { amount: string }) => r.amount),
      ['250', '1000']
    );
    assert.equal(page2.cursor.next, null);

    const back = await get(url(), { limit: '2', cursor: page2.cursor.previous });
    assert.deepEqual(back.results, page1.results);
  });

  test('counts a self-transfer once', async () => {
    await db.update(
      new TestBlockBuilder({
        block_height: 1,
        block_hash: hex(1),
        index_block_hash: hex(1),
        parent_index_block_hash: hex(0),
        parent_block_hash: hex(0),
      })
        .addTx({ tx_id: hex(0x11) })
        .addTxFtEvent({
          sender: principal,
          recipient: principal,
          asset_identifier: token,
          amount: 500n,
        })
        .build()
    );

    const body = await get(url());
    // The event matches both the sender and recipient side; it must not appear twice, and
    // total must agree with the number of results.
    assert.equal(body.total, 1);
    assert.equal(body.results.length, 1);
    assert.deepEqual(
      [body.results[0].sender, body.results[0].recipient, body.results[0].amount],
      [principal, principal, '500']
    );
  });

  test('spans multiple blocks in chain order', async () => {
    await db.update(buildBlock());
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        block_hash: hex(2),
        index_block_hash: hex(2),
        parent_index_block_hash: hex(1),
        parent_block_hash: hex(1),
      })
        .addTx({ tx_id: hex(0x22) })
        .addTxFtEvent({
          sender: counterparty,
          recipient: principal,
          asset_identifier: token,
          amount: 7n,
        })
        .build()
    );

    const body = await get(url());
    assert.equal(body.total, 5);
    // The block 2 event is newest and sorts first.
    assert.equal(body.results[0].amount, '7');
    assert.equal(body.results[0].block.height, 2);
  });

  test('excludes events orphaned by a reorg', async () => {
    await db.update(buildBlock());

    // Block 2a credits the principal, then is orphaned by 2b/3.
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        block_hash: hex(0x2a),
        index_block_hash: hex(0x2a),
        parent_index_block_hash: hex(1),
        parent_block_hash: hex(1),
      })
        .addTx({ tx_id: hex(0x22a) })
        .addTxFtEvent({
          sender: counterparty,
          recipient: principal,
          asset_identifier: token,
          amount: 111n,
        })
        .build()
    );
    assert.equal((await get(url())).total, 5);

    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        block_hash: hex(0x2b),
        index_block_hash: hex(0x2b),
        parent_index_block_hash: hex(1),
        parent_block_hash: hex(1),
      })
        .addTx({ tx_id: hex(0x22b) })
        .build()
    );
    await db.update(
      new TestBlockBuilder({
        block_height: 3,
        block_hash: hex(3),
        index_block_hash: hex(3),
        parent_index_block_hash: hex(0x2b),
        parent_block_hash: hex(0x2b),
      })
        .addTx({ tx_id: hex(0x33) })
        .build()
    );

    const body = await get(url());
    assert.equal(body.total, 4);
    assert.ok(!body.results.some((r: { amount: string }) => r.amount === '111'));
  });

  test('rejects a malformed asset identifier', async () => {
    const res = await api.fastifyApp.inject({
      method: 'GET',
      url: `/extended/v3/principals/${principal}/transfers/ft/not-an-asset-id`,
    });
    assert.equal(res.statusCode, 400, res.body);
  });
});
