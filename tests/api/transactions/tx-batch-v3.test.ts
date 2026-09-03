import { describe, test, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { STACKS_TESTNET } from '@stacks/network';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { ApiServer, startApiServer } from '../../../src/api/init.ts';
import { migrate } from '../../test-helpers.ts';
import { hex } from '../test-helpers.ts';
import { TestBlockBuilder, testMempoolTx } from '../test-builders.ts';
import { DbTxStatus, DbTxTypeId } from '../../../src/datastore/common.ts';

/**
 * `GET /extended/v3/transactions/batch` — the v3 replacement for `GET /extended/v1/tx/multiple`.
 *
 * The contract under test: mined canonical transactions only, canonical order regardless of the
 * order ids were supplied, and ids that do not resolve are absent rather than an error. Ids are
 * accepted both as repeated `tx_id` params and as one comma-separated value.
 */

const SENDER = 'SP466FNC0P7JWTNM2R9T199QRZN1MYEDTAR0KP27';
const RECIPIENT = 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6';

const TX_1 = hex(1);
const TX_2 = hex(2);
const TX_3 = hex(3);
const MEMPOOL_TX = hex(9);
const UNKNOWN_TX = hex(0xdead);

/** Repeated-param form: `?tx_id=A&tx_id=B`. */
const get = (api: ApiServer, txIds: string[], headers?: Record<string, string>) =>
  api.fastifyApp.inject({
    method: 'GET',
    url: '/extended/v3/transactions/batch',
    query: txIds.length === 1 ? { tx_id: txIds[0] } : { tx_id: txIds },
    headers,
  });

/** Comma-separated form: `?tx_id=A,B`. */
const getCsv = (api: ApiServer, txIds: string[]) =>
  api.fastifyApp.inject({
    method: 'GET',
    url: '/extended/v3/transactions/batch',
    query: { tx_id: txIds.join(',') },
  });

/** Raw querystring, for cases the typed helpers cannot express. */
const getRaw = (api: ApiServer, query: string) =>
  api.fastifyApp.inject({ method: 'GET', url: `/extended/v3/transactions/batch${query}` });

describe('v3 transactions batch', () => {
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

    // Three mined txs across two blocks, so canonical ordering is observable, plus one that only
    // ever reaches the mempool.
    await db.update(
      new TestBlockBuilder({
        block_height: 1,
        index_block_hash: '0x0001',
        parent_index_block_hash: '0x0000',
        parent_block_hash: '0x0000',
      })
        .addTx({
          tx_id: TX_1,
          tx_index: 0,
          block_hash: '0x0001',
          index_block_hash: '0x0001',
          type_id: DbTxTypeId.Coinbase,
          status: DbTxStatus.Success,
          sender_address: SENDER,
        })
        .addTx({
          tx_id: TX_2,
          tx_index: 1,
          block_hash: '0x0001',
          index_block_hash: '0x0001',
          type_id: DbTxTypeId.TokenTransfer,
          status: DbTxStatus.Success,
          sender_address: SENDER,
          token_transfer_recipient_address: RECIPIENT,
          token_transfer_amount: 100n,
          token_transfer_memo: '0x0d0000000568656c6c6f',
        })
        .build()
    );
    await db.update(
      new TestBlockBuilder({
        block_height: 2,
        index_block_hash: '0x0002',
        parent_index_block_hash: '0x0001',
        parent_block_hash: '0x0001',
      })
        .addTx({
          tx_id: TX_3,
          tx_index: 0,
          block_hash: '0x0002',
          index_block_hash: '0x0002',
          type_id: DbTxTypeId.Coinbase,
          status: DbTxStatus.Success,
          sender_address: SENDER,
        })
        .build()
    );
    await db.updateMempoolTxs({
      mempoolTxs: [
        testMempoolTx({
          tx_id: MEMPOOL_TX,
          receipt_time: 1000,
          type_id: DbTxTypeId.TokenTransfer,
          sender_address: SENDER,
          token_transfer_recipient_address: RECIPIENT,
          token_transfer_amount: 500n,
        }),
      ],
    });
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await migrate('down');
  });

  test('returns summaries for the requested transactions', async () => {
    const res = await get(api, [TX_1, TX_3]);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.deepEqual(
      body.results.map((r: { tx_id: string }) => r.tx_id),
      [TX_3, TX_1]
    );
    // Summary shape, not full transaction: no event_count / execution_cost / post_conditions.
    const summary = body.results[0];
    assert.equal(summary.block.height, 2);
    assert.equal(summary.sender.address, SENDER);
    assert.equal(summary.status, 'success');
    assert.equal(summary.type, 'coinbase');
    assert.equal('event_count' in summary, false);
    assert.equal('execution_cost' in summary, false);
  });

  test('orders results canonically, not by the order ids were supplied', async () => {
    const res = await get(api, [TX_1, TX_3, TX_2]);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    // block 2 tx first, then block 1 by descending tx_index.
    assert.deepEqual(
      body.results.map((r: { tx_id: string }) => r.tx_id),
      [TX_3, TX_2, TX_1]
    );
  });

  test('omits unknown transaction ids instead of erroring', async () => {
    const res = await get(api, [TX_1, UNKNOWN_TX]);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.deepEqual(
      body.results.map((r: { tx_id: string }) => r.tx_id),
      [TX_1]
    );
  });

  test('omits mempool transactions — mined only', async () => {
    const res = await get(api, [TX_1, MEMPOOL_TX]);
    assert.equal(res.statusCode, 200);
    const body = JSON.parse(res.body);
    assert.deepEqual(
      body.results.map((r: { tx_id: string }) => r.tx_id),
      [TX_1]
    );
  });

  test('returns an empty result set when nothing resolves', async () => {
    const res = await get(api, [UNKNOWN_TX]);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(JSON.parse(res.body).results, []);
  });

  // The cap is `getPagingQueryLimit(ResourceType.Tx)` (20), matching the `tx_id` filter on
  // `/principals/{principal}/balance-changes`.
  test('rejects more than 20 transaction ids', async () => {
    const tx_ids = Array.from({ length: 21 }, (_, i) => hex(1000 + i));
    const res = await get(api, tx_ids);
    assert.equal(res.statusCode, 400);
  });

  test('accepts exactly 20 transaction ids', async () => {
    const tx_ids = [TX_1, ...Array.from({ length: 19 }, (_, i) => hex(1000 + i))];
    const res = await get(api, tx_ids);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(
      JSON.parse(res.body).results.map((r: { tx_id: string }) => r.tx_id),
      [TX_1]
    );
  });

  test('accepts a single comma-separated tx_id value', async () => {
    const res = await getCsv(api, [TX_1, TX_3, TX_2]);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(
      JSON.parse(res.body).results.map((r: { tx_id: string }) => r.tx_id),
      [TX_3, TX_2, TX_1]
    );
  });

  test('the comma-separated and repeated forms agree', async () => {
    const repeated = await get(api, [TX_1, TX_2]);
    const csv = await getCsv(api, [TX_1, TX_2]);
    assert.equal(repeated.statusCode, 200);
    assert.equal(csv.statusCode, 200);
    assert.deepEqual(JSON.parse(csv.body), JSON.parse(repeated.body));
  });

  test('rejects duplicate transaction ids', async () => {
    const res = await get(api, [TX_1, TX_1]);
    assert.equal(res.statusCode, 400);
  });

  test('rejects a malformed transaction id', async () => {
    const res = await get(api, ['0x0001']);
    assert.equal(res.statusCode, 400);
  });

  test('rejects a malformed id inside a comma-separated value', async () => {
    const res = await getCsv(api, [TX_1, '0x0001']);
    assert.equal(res.statusCode, 400);
  });

  test('rejects a missing tx_id param', async () => {
    const res = await getRaw(api, '');
    assert.equal(res.statusCode, 400);
  });

  test('rejects an empty tx_id param', async () => {
    const res = await getRaw(api, '?tx_id=');
    assert.equal(res.statusCode, 400);
  });

  test('the v1 endpoint it replaces is deprecated and points here', async () => {
    const res = await api.fastifyApp.inject({
      method: 'GET',
      url: '/extended/v1/tx/multiple',
      query: { tx_id: TX_1 },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(
      res.headers['warning'],
      '299 - "Deprecated: Use GET /extended/v3/transactions/batch instead. It returns mined ' +
        'transactions only, and omits ids it cannot resolve rather than reporting them as not ' +
        'found."'
    );
  });

  test('sets a chain-tip ETag and honours If-None-Match', async () => {
    const first = await get(api, [TX_1, TX_3]);
    assert.equal(first.statusCode, 200);
    const etag = first.headers['etag'] as string;
    assert.ok(etag, 'expected an ETag');
    assert.equal(first.headers['cache-control'], 'public, no-cache, must-revalidate');

    // Same URL, same chain tip — revalidation is a 304. Caches key on the URL, so a different
    // `tx_id` set is a separate cache entry and never reuses this response.
    const revalidated = await get(api, [TX_1, TX_3], { 'if-none-match': etag });
    assert.equal(revalidated.statusCode, 304);
  });
});
