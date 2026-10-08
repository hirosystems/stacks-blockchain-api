import { describe, test, beforeEach, afterEach } from 'node:test';
import * as assert from 'node:assert/strict';
import { STACKS_TESTNET } from '@stacks/network';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { ApiServer, startApiServer } from '../../../src/api/init.ts';
import { migrate } from '../../test-helpers.ts';
import { hex } from '../test-helpers.ts';
import { TestBlockBuilder } from '../test-builders.ts';

/**
 * Every v3 endpoint that takes a tx id or block hash answers a hash supplied without its `0x`
 * prefix with a `302` to the same URL with the prefix added, keeping the rest of the querystring.
 */

const PRINCIPAL = 'SP466FNC0P7JWTNM2R9T199QRZN1MYEDTAR0KP27';
const TX_1 = hex(1);
const TX_2 = hex(2);
const BLOCK_HASH = hex(0xb10c);
const bare = (hash: string) => hash.slice(2);

describe('v3 unprefixed hash redirects', () => {
  let db: PgWriteStore;
  let api: ApiServer;

  const get = (url: string) => api.fastifyApp.inject({ method: 'GET', url });

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    api = await startApiServer({ datastore: db, chainId: STACKS_TESTNET.chainId });
    await db.update(
      new TestBlockBuilder({
        block_height: 1,
        block_hash: BLOCK_HASH,
        index_block_hash: BLOCK_HASH,
      })
        .addTx({ tx_id: TX_1, sender_address: PRINCIPAL })
        .build()
    );
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await migrate('down');
  });

  const pathCases: [string, string, string][] = [
    ['transaction', `/extended/v3/transactions/${bare(TX_1)}`, `/extended/v3/transactions/${TX_1}`],
    [
      'transaction with querystring',
      `/extended/v3/transactions/${bare(TX_1)}?include=post_conditions`,
      `/extended/v3/transactions/${TX_1}?include=post_conditions`,
    ],
    [
      'transaction events',
      `/extended/v3/transactions/${bare(TX_1)}/events?limit=5`,
      `/extended/v3/transactions/${TX_1}/events?limit=5`,
    ],
    [
      'principal transaction balance changes',
      `/extended/v3/principals/${PRINCIPAL}/transactions/${bare(TX_1)}/balance-changes`,
      `/extended/v3/principals/${PRINCIPAL}/transactions/${TX_1}/balance-changes`,
    ],
    [
      'block transactions',
      `/extended/v3/blocks/${bare(BLOCK_HASH)}/transactions`,
      `/extended/v3/blocks/${BLOCK_HASH}/transactions`,
    ],
    [
      'percent-encoded transaction',
      `/extended/v3/transactions/%30${bare(TX_1).slice(1)}`,
      `/extended/v3/transactions/${TX_1}`,
    ],
    [
      'percent-encoded block hash',
      `/extended/v3/blocks/%30${bare(BLOCK_HASH).slice(1)}/transactions`,
      `/extended/v3/blocks/${BLOCK_HASH}/transactions`,
    ],
  ];

  for (const [name, url, location] of pathCases) {
    test(`redirects ${name} path param`, async () => {
      const res = await get(url);
      assert.equal(res.statusCode, 302);
      assert.equal(res.headers.location, location);
    });
  }

  const queryCases: [string, string, string][] = [
    [
      'batch, repeated',
      `/extended/v3/transactions/batch?tx_id=${bare(TX_1)}&tx_id=${TX_2}`,
      `/extended/v3/transactions/batch?tx_id=${TX_1}&tx_id=${TX_2}`,
    ],
    [
      'batch, comma-separated',
      `/extended/v3/transactions/batch?tx_id=${TX_1},${bare(TX_2)}`,
      `/extended/v3/transactions/batch?tx_id=${TX_1},${TX_2}`,
    ],
    [
      'batch, encoded comma',
      `/extended/v3/transactions/batch?tx_id=${bare(TX_1)}%2C${bare(TX_2)}`,
      `/extended/v3/transactions/batch?tx_id=${TX_1},${TX_2}`,
    ],
    [
      'principal balance changes, other params kept in place',
      `/extended/v3/principals/${PRINCIPAL}/balance-changes?limit=5&tx_id=${bare(TX_1)}`,
      `/extended/v3/principals/${PRINCIPAL}/balance-changes?limit=5&tx_id=${TX_1}`,
    ],
    [
      'batch, percent-encoded',
      `/extended/v3/transactions/batch?tx_id=%30${bare(TX_1).slice(1)},${TX_2}`,
      `/extended/v3/transactions/batch?tx_id=${TX_1},${TX_2}`,
    ],
    [
      'batch, valueless and malformed params kept verbatim',
      `/extended/v3/transactions/batch?flag&%E0=1&tx_id=${bare(TX_1)}`,
      `/extended/v3/transactions/batch?flag&%E0=1&tx_id=${TX_1}`,
    ],
  ];

  for (const [name, url, location] of queryCases) {
    test(`redirects ${name} query param`, async () => {
      const res = await get(url);
      assert.equal(res.statusCode, 302);
      assert.equal(res.headers.location, location);
    });
  }

  test('does not redirect prefixed hashes, heights or aliases', async () => {
    for (const url of [
      `/extended/v3/transactions/${TX_1}`,
      `/extended/v3/transactions/batch?tx_id=${TX_1}`,
      `/extended/v3/blocks/${BLOCK_HASH}/transactions`,
      `/extended/v3/blocks/1/transactions`,
      `/extended/v3/blocks/latest/transactions`,
    ]) {
      const res = await get(url);
      assert.equal(res.statusCode, 200, url);
    }
  });

  test('leaves malformed ids to schema validation', async () => {
    const res = await get(`/extended/v3/transactions/${bare(TX_1).slice(1)}`);
    assert.equal(res.statusCode, 400);
  });

  test('redirect target resolves the transaction', async () => {
    const redirect = await get(`/extended/v3/transactions/${bare(TX_1)}`);
    const res = await get(redirect.headers.location as string);
    assert.equal(res.statusCode, 200);
    assert.equal(JSON.parse(res.body).tx_id, TX_1);
  });
});
