import supertest from 'supertest';
import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { STACKS_TESTNET } from '@stacks/network';
import { ApiServer, startApiServer } from '../../../src/api/init.ts';
import DeprecationPlugin from '../../../src/api/deprecation-plugin.ts';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { ENV } from '../../../src/env.ts';
import { migrate } from '../../test-helpers.ts';

/**
 * Deprecation coverage for the `/extended/v2/blocks` and `/extended/v2/burn-blocks` routes that
 * have a v3 counterpart.
 *
 * These routes are deprecated in favor of v3 but exempt from the `ENABLE_DEPRECATED_ENDPOINTS`
 * sunset kill switch (`deprecatedExemptFromSunset`): they keep the `Warning` header, yet keep
 * serving when deprecated endpoints are disabled.
 *
 * The header is attached by `DeprecationPlugin` on `onSend`, which runs for error responses too —
 * so the 404s below still assert the deprecation contract without needing fixture data.
 */

const warning = (message: string) => `299 - "Deprecated: ${message}"`;
const PAGINATED = 'It is cursor-paginated (no offset).';

const HASH = '0x' + '11'.repeat(32);

const EXEMPT_ROUTES = [
  {
    path: '/extended/v2/blocks',
    warning: warning(`Use GET /extended/v3/blocks instead. ${PAGINATED}`),
  },
  {
    path: `/extended/v2/blocks/${HASH}`,
    warning: warning('Use GET /extended/v3/blocks/{height_or_hash} instead.'),
  },
  {
    path: `/extended/v2/blocks/${HASH}/transactions`,
    warning: warning(
      `Use GET /extended/v3/blocks/{height_or_hash}/transactions instead. ${PAGINATED}`
    ),
  },
  {
    path: '/extended/v2/burn-blocks',
    warning: warning(`Use GET /extended/v3/bitcoin-blocks instead. ${PAGINATED}`),
  },
  {
    path: `/extended/v2/burn-blocks/${HASH}`,
    warning: warning('Use GET /extended/v3/bitcoin-blocks/{height_or_hash} instead.'),
  },
  {
    path: `/extended/v2/burn-blocks/${HASH}/blocks`,
    warning: warning(
      `Use GET /extended/v3/bitcoin-blocks/{height_or_hash}/blocks instead. ${PAGINATED}`
    ),
  },
];

/** Deprecated v1 block routes are part of the sunset, so they must still be disabled. */
const GATED_ROUTES = ['/extended/v1/block', `/extended/v1/block/${HASH}`];

describe('v2 block and burn-block endpoint deprecation', () => {
  let db: PgWriteStore;
  let api: ApiServer | undefined;

  async function startApi(): Promise<ApiServer> {
    api = await startApiServer({ datastore: db, chainId: STACKS_TESTNET.chainId });
    return api;
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
    ENV.ENABLE_DEPRECATED_ENDPOINTS = true;
    await api?.terminate();
    api = undefined;
    await db?.close();
    await migrate('down');
  });

  for (const route of EXEMPT_ROUTES) {
    test(`GET ${route.path} carries its v3 deprecation warning`, async () => {
      const api = await startApi();
      const res = await supertest(api.server).get(route.path);
      assert.equal(res.headers['warning'], route.warning);
    });
  }

  test('exempt routes keep serving when deprecated endpoints are disabled', async () => {
    ENV.ENABLE_DEPRECATED_ENDPOINTS = false;
    const api = await startApi();
    for (const route of EXEMPT_ROUTES) {
      const res = await supertest(api.server).get(route.path);
      assert.notEqual(res.status, 410, route.path);
      assert.equal(res.headers['warning'], route.warning, route.path);
    }
    // The list endpoints are served normally against an empty database.
    const blocks = await supertest(api.server).get('/extended/v2/blocks');
    assert.equal(blocks.status, 200);
    assert.deepEqual(blocks.body.results, []);
    const burnBlocks = await supertest(api.server).get('/extended/v2/burn-blocks');
    assert.equal(burnBlocks.status, 200);
    assert.deepEqual(burnBlocks.body.results, []);
  });

  test('v1 block routes still return 410 when disabled', async () => {
    ENV.ENABLE_DEPRECATED_ENDPOINTS = false;
    const api = await startApi();
    for (const path of GATED_ROUTES) {
      const res = await supertest(api.server).get(path);
      assert.equal(res.status, 410, path);
      assert.equal(res.body.error, 'Gone', path);
    }
  });
});

describe('DeprecationPlugin deprecatedExemptFromSunset', () => {
  async function buildServer(enableDeprecatedEndpoints: boolean) {
    const fastify = Fastify();
    await fastify.register(DeprecationPlugin, {
      defaultDeprecatedMessage: 'default message',
      enableDeprecatedEndpoints,
    });
    fastify.get('/gated', { schema: { deprecated: true } }, async () => ({ ok: true }));
    fastify.get(
      '/exempt',
      { schema: { deprecated: true, deprecatedExemptFromSunset: true } },
      async () => ({ ok: true })
    );
    // The flag alone does nothing on a route that is not deprecated.
    fastify.get('/current', { schema: { deprecatedExemptFromSunset: true } }, async () => ({
      ok: true,
    }));
    await fastify.ready();
    return fastify;
  }

  test('only non-exempt deprecated routes are disabled', async () => {
    const fastify = await buildServer(false);
    try {
      const gated = await fastify.inject({ method: 'GET', url: '/gated' });
      assert.equal(gated.statusCode, 410);
      assert.equal(gated.headers['warning'], warning('default message'));

      const exempt = await fastify.inject({ method: 'GET', url: '/exempt' });
      assert.equal(exempt.statusCode, 200);
      assert.deepEqual(exempt.json(), { ok: true });
      assert.equal(exempt.headers['warning'], warning('default message'));

      const current = await fastify.inject({ method: 'GET', url: '/current' });
      assert.equal(current.statusCode, 200);
      assert.equal(current.headers['warning'], undefined);
    } finally {
      await fastify.close();
    }
  });

  test('all routes serve when deprecated endpoints are enabled', async () => {
    const fastify = await buildServer(true);
    try {
      for (const url of ['/gated', '/exempt', '/current']) {
        const res = await fastify.inject({ method: 'GET', url });
        assert.equal(res.statusCode, 200, url);
      }
    } finally {
      await fastify.close();
    }
  });
});
