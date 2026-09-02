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
 * Each route carries its own message, because the pox-5 pointer differs per route — the
 * assertions below pin the exact text, since it is what consumers see in the `Warning` header
 * and in the `410 Gone` body after sunset.
 *
 * The header is attached by `DeprecationPlugin` on `onSend`, which runs for error responses too —
 * so the 404s below still assert the deprecation contract without needing fixture data.
 */

const HISTORICAL = 'Historical pox-4 and earlier data only.';
const warning = (message: string) => `299 - "Deprecated: ${message}"`;

const PRINCIPAL = 'ST3NBRSFKX28FQ2ZJ1MAKX58HKHSDGNV5N7R21XCP';
const TX_ID = '0x' + '11'.repeat(32);

const ROUTES = [
  {
    name: 'events',
    path: (pox: string) => `/extended/v1/${pox}/events`,
    warning: warning(`${HISTORICAL} No pox-5 replacement; there is no global pox-5 event feed.`),
  },
  {
    name: 'tx/:tx_id',
    path: (pox: string) => `/extended/v1/${pox}/tx/${TX_ID}`,
    warning: warning(
      `${HISTORICAL} No pox-5 replacement; v3 transaction events do not carry decoded pox operations.`
    ),
  },
  {
    name: 'stacker/:principal',
    path: (pox: string) => `/extended/v1/${pox}/stacker/${PRINCIPAL}`,
    warning: warning(
      `${HISTORICAL} For a principal's current pox-5 position see ` +
        `/extended/v3/principals/{principal}/staking; there is no pox-5 event history equivalent.`
    ),
  },
  {
    name: ':pool_principal/delegations',
    path: (pox: string) => `/extended/v1/${pox}/${PRINCIPAL}/delegations`,
    warning: warning(
      `${HISTORICAL} See /extended/v3/staking/signers/{principal}/stakers for the pox-5 equivalent.`
    ),
  },
];

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

  for (const pox of ['pox2', 'pox3', 'pox4']) {
    for (const route of ROUTES) {
      test(`GET /extended/v1/${pox}/${route.name} carries its own deprecation warning`, async () => {
        const res = await supertest(api.server).get(route.path(pox));
        assert.equal(res.headers['warning'], route.warning);
      });
    }
  }

  test('each route advertises a distinct replacement', async () => {
    // Guards against a future refactor collapsing these back into one shared message: the whole
    // point is that the pox-5 pointer differs per route.
    const warnings = new Set(ROUTES.map(r => r.warning));
    assert.equal(warnings.size, ROUTES.length);
  });

  test('the deprecated routes are still served, not disabled', async () => {
    // `ENABLE_DEPRECATED_ENDPOINTS` defaults to true, so deprecation must not turn into 410 here.
    const res = await supertest(api.server).get('/extended/v1/pox4/events');
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.results, []);
  });
});
