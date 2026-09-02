import supertest from 'supertest';
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { STACKS_TESTNET } from '@stacks/network';
import { ApiServer, startApiServer } from '../../../src/api/init.ts';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { migrate } from '../../test-helpers.ts';

/**
 * Deprecation coverage for the legacy `/extended/v1/pox{2,3,4}` routes.
 *
 * These endpoints read the `pox2_events` / `pox3_events` / `pox4_events` tables and have no
 * pox-5 counterpart, so they serve historical data only. They live in this suite because it is
 * the stacking-focused one; the routes themselves are v1, not pox-5.
 *
 * The `Warning` header is attached by `DeprecationPlugin` on `onSend`, which runs for error
 * responses too — so the 404s below still assert the deprecation contract without needing
 * fixture data.
 */

const EXPECTED_WARNING =
  '299 - "Deprecated: Historical pox-4 and earlier data only. ' +
  'See /extended/v3/principals/{principal}/staking for pox-5 data."';

const PRINCIPAL = 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP';
const TX_ID = '0x' + '11'.repeat(32);

describe('v1 pox endpoint deprecation', () => {
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

  // Each route, for every pox version it accepts. `/events` is the only one that resolves
  // without fixture data; the rest 404, which still exercises the `onSend` hook.
  for (const pox of ['pox2', 'pox3', 'pox4']) {
    test(`GET /extended/v1/${pox}/events is deprecated`, async () => {
      const res = await supertest(api.server).get(`/extended/v1/${pox}/events`);
      assert.equal(res.status, 200);
      assert.equal(res.headers['warning'], EXPECTED_WARNING);
    });

    test(`GET /extended/v1/${pox}/tx/:tx_id is deprecated`, async () => {
      const res = await supertest(api.server).get(`/extended/v1/${pox}/tx/${TX_ID}`);
      assert.equal(res.headers['warning'], EXPECTED_WARNING);
    });

    test(`GET /extended/v1/${pox}/stacker/:principal is deprecated`, async () => {
      const res = await supertest(api.server).get(`/extended/v1/${pox}/stacker/${PRINCIPAL}`);
      assert.equal(res.headers['warning'], EXPECTED_WARNING);
    });

    test(`GET /extended/v1/${pox}/:pool_principal/delegations is deprecated`, async () => {
      const res = await supertest(api.server).get(`/extended/v1/${pox}/${PRINCIPAL}/delegations`);
      assert.equal(res.headers['warning'], EXPECTED_WARNING);
    });
  }

  test('the deprecated routes are still served, not disabled', async () => {
    // `ENABLE_DEPRECATED_ENDPOINTS` defaults to true, so deprecation must not turn into 410 here.
    const res = await supertest(api.server).get('/extended/v1/pox4/events');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.results, []);
  });
});
