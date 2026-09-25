import supertest from 'supertest';
import { decodeTransaction, TxPayloadTypeID } from '@stacks/codec';
import type { DecodedTxResult, TxPayloadTokenTransfer } from '@stacks/codec';
import { STACKS_TESTNET } from '@stacks/network';
import { startApiServer, ApiServer } from '../../../src/api/init.ts';
import { FAUCET_TESTNET_KEYS } from '../../../src/api/faucets/common.ts';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { DbFaucetRequestCurrency } from '../../../src/datastore/common.ts';
import { ENV } from '../../../src/env.ts';
import { migrate } from '../../test-helpers.ts';
import { MockStacksNode, startMockStacksNode, MOCK_FEE_ESTIMATE } from './helpers.ts';
import { beforeEach, afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

const RECIPIENT_ADDRESS = 'ST3M7N9Q9HDRM7RVP1Q26P0EE69358PZZAZD7KMXQ';

/**
 * v3 does not return the raw transaction hex, so tests decode the tx the mock node actually
 * received rather than one echoed back in the response.
 */
function decodeBroadcastTransfer(
  node: MockStacksNode,
  index = 0
): DecodedTxResult & { payload: TxPayloadTokenTransfer } {
  const tx = decodeTransaction(node.receivedTxs[index]);
  assert.equal(tx.payload.type_id, TxPayloadTypeID.TokenTransfer);
  return tx as DecodedTxResult & { payload: TxPayloadTokenTransfer };
}

describe('STX faucet (v3)', () => {
  let db: PgWriteStore;
  let api: ApiServer;
  let node: MockStacksNode;

  const requestFaucet = (body?: object) => {
    const req = supertest(api.server).post('/extended/v3/faucets/stx');
    return body === undefined ? req : req.send(body);
  };

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    node = await startMockStacksNode();
    ENV.STACKS_FAUCET_NODE_HOST = '127.0.0.1';
    ENV.STACKS_FAUCET_NODE_PORT = node.port;
    api = await startApiServer({
      datastore: db,
      writeDatastore: db,
      chainId: STACKS_TESTNET.chainId,
    });
  });

  afterEach(async () => {
    ENV.STACKS_FAUCET_NODE_HOST = undefined;
    ENV.STACKS_FAUCET_NODE_PORT = undefined;
    await api.terminate();
    await node.close();
    await db?.close();
    await migrate('down');
  });

  test('transfers the configured default amount and reports it in µSTX', async () => {
    const response = await requestFaucet({ address: RECIPIENT_ADDRESS });
    assert.equal(response.status, 200);

    assert.equal(node.receivedTxs.length, 1);
    const tx = decodeBroadcastTransfer(node);
    assert.deepEqual(response.body, {
      transaction: { tx_id: tx.tx_id, chain: 'stacks' },
      amount: { stx: '500000000' },
    });
    assert.match(response.body.transaction.tx_id, /^0x[a-f0-9]{64}$/);
    assert.equal(tx.payload.recipient.address, RECIPIENT_ADDRESS);
    assert.equal(tx.payload.amount, '500000000');
    assert.equal(tx.auth.origin_condition.signer.address, FAUCET_TESTNET_KEYS[0].stacksAddress);
    assert.equal(tx.auth.origin_condition.tx_fee, MOCK_FEE_ESTIMATE.toString());
  });

  test('sends and reports the amount configured by TESTNET_STX_FAUCET_AMOUNT', async () => {
    const defaultAmount = ENV.TESTNET_STX_FAUCET_AMOUNT;
    ENV.TESTNET_STX_FAUCET_AMOUNT = 123_456_789;
    try {
      const response = await requestFaucet({ address: RECIPIENT_ADDRESS });
      assert.equal(response.status, 200);
      assert.deepEqual(response.body.amount, { stx: '123456789' });
      assert.equal(decodeBroadcastTransfer(node).payload.amount, '123456789');
    } finally {
      ENV.TESTNET_STX_FAUCET_AMOUNT = defaultAmount;
    }
  });

  test('ignores the v1 `stacking` option', async () => {
    const response = await requestFaucet({ address: RECIPIENT_ADDRESS, stacking: true });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.amount, { stx: '500000000' });
  });

  test('address is required in the body', async () => {
    const response = await requestFaucet({});
    assert.equal(response.status, 400);
    assert.deepEqual(Object.keys(response.body), ['error']);
    assert.match(response.body.error, /address/);
    assert.equal(node.receivedTxs.length, 0);
  });

  test('an empty address is rejected', async () => {
    const response = await requestFaucet({ address: '' });
    assert.equal(response.status, 400);
    assert.deepEqual(Object.keys(response.body), ['error']);
    assert.equal(node.receivedTxs.length, 0);
  });

  test('rejects addresses that are not valid testnet Stacks principals', async () => {
    const invalid = [
      'not-an-address',
      // Valid mainnet address: must not be paid on testnet.
      'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE',
      // The recipient with its last character changed: bad c32 checksum.
      'ST3M7N9Q9HDRM7RVP1Q26P0EE69358PZZAZD7KMXR',
      // Contract principal deployed by a mainnet address.
      'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.some-contract',
    ];
    for (const address of invalid) {
      const response = await requestFaucet({ address });
      assert.equal(response.status, 400, address);
      assert.deepEqual(response.body, { error: 'Invalid testnet Stacks address' }, address);
    }
    assert.equal(node.receivedTxs.length, 0);
  });

  test('accepts a testnet contract principal', async () => {
    const response = await requestFaucet({ address: `${RECIPIENT_ADDRESS}.some-contract` });
    assert.equal(response.status, 200);
    assert.equal(node.receivedTxs.length, 1);
  });

  test('a request without a body is rejected', async () => {
    const response = await requestFaucet();
    assert.equal(response.status, 400);
    assert.deepEqual(Object.keys(response.body), ['error']);
    assert.equal(node.receivedTxs.length, 0);
  });

  test('a query string address is not accepted', async () => {
    const response = await supertest(api.server).post(
      `/extended/v3/faucets/stx?address=${RECIPIENT_ADDRESS}`
    );
    assert.equal(response.status, 400);
    assert.equal(node.receivedTxs.length, 0);
  });

  test('a malformed JSON body is rejected', async () => {
    const response = await supertest(api.server)
      .post('/extended/v3/faucets/stx')
      .set('Content-Type', 'application/json')
      .send('{"address": ');
    assert.equal(response.status, 400);
    assert.deepEqual(Object.keys(response.body), ['error']);
    assert.equal(node.receivedTxs.length, 0);
  });

  test('a form-encoded body is rejected', async () => {
    const response = await supertest(api.server)
      .post('/extended/v3/faucets/stx')
      .type('form')
      .send({ address: RECIPIENT_ADDRESS });
    assert.equal(response.status, 415);
    assert.deepEqual(Object.keys(response.body), ['error']);
    assert.equal(node.receivedTxs.length, 0);
  });

  const buildAndBroadcastLog = () =>
    node.requestLog.filter(path => path === '/v2/info' || path === '/v2/transactions');

  test('concurrent requests from a single faucet key are serialized', async () => {
    // A slow fee estimate widens the window in which unserialized requests would interleave.
    node.feeEstimateDelayMs = 100;
    const responses = await Promise.all([
      requestFaucet({ address: RECIPIENT_ADDRESS }),
      requestFaucet({ address: RECIPIENT_ADDRESS }),
    ]);
    assert.deepEqual(
      responses.map(r => r.status),
      [200, 200]
    );
    assert.deepEqual(buildAndBroadcastLog(), [
      '/v2/info',
      '/v2/transactions',
      '/v2/info',
      '/v2/transactions',
    ]);
  });

  test('concurrent requests are spread across faucet keys and run in parallel', async () => {
    ENV.FAUCET_PRIVATE_KEY = `${FAUCET_TESTNET_KEYS[0].secretKey},${FAUCET_TESTNET_KEYS[1].secretKey}`;
    node.feeEstimateDelayMs = 100;
    try {
      const responses = await Promise.all([
        requestFaucet({ address: RECIPIENT_ADDRESS }),
        requestFaucet({ address: RECIPIENT_ADDRESS }),
      ]);
      assert.deepEqual(
        responses.map(r => r.status),
        [200, 200]
      );
      // Each request took the idle key rather than queueing behind the other.
      const senders = [0, 1].map(
        i => decodeBroadcastTransfer(node, i).auth.origin_condition.signer.address
      );
      assert.deepEqual(
        new Set(senders),
        new Set(FAUCET_TESTNET_KEYS.slice(0, 2).map(k => k.stacksAddress))
      );
      // Both transactions were built before either was broadcast.
      assert.deepEqual(buildAndBroadcastLog(), [
        '/v2/info',
        '/v2/info',
        '/v2/transactions',
        '/v2/transactions',
      ]);
    } finally {
      ENV.FAUCET_PRIVATE_KEY = undefined;
    }
  });

  test('is not rate limited or recorded by the API', async () => {
    // Faucet rate limits are enforced at the edge (Cloudflare), not by the API. Rows that would
    // trip the deprecated v1 limit (5 per 5 minutes) have no effect on v3.
    for (let i = 0; i < 5; i++) {
      await db.insertFaucetRequest({
        ip: '127.0.0.1',
        address: RECIPIENT_ADDRESS,
        currency: DbFaucetRequestCurrency.STX,
        occurred_at: Date.now(),
      });
    }
    const responses = await Promise.all(
      Array.from({ length: 3 }, () => requestFaucet({ address: RECIPIENT_ADDRESS }))
    );
    assert.deepEqual(
      responses.map(r => r.status),
      [200, 200, 200]
    );
    assert.equal(node.receivedTxs.length, 3);
    // Only the seeded rows remain: v3 requests are not recorded.
    const requests = await db.getSTXFaucetRequests(RECIPIENT_ADDRESS);
    assert.equal(requests.results.length, 5);
  });

  test('responds 503 out-of-funds when the node rejects with NotEnoughFunds', async () => {
    node.sendTxResponses.push({
      status: 400,
      body: { error: 'transaction rejected', reason: 'NotEnoughFunds' },
    });
    const response = await requestFaucet({ address: RECIPIENT_ADDRESS });
    assert.equal(response.status, 503);
    assert.deepEqual(response.body, {
      error: 'The faucet is temporarily out of funds, please try again later',
    });
  });

  test('responds 503 unavailable when the node is unreachable', async () => {
    await node.close();
    const response = await requestFaucet({ address: RECIPIENT_ADDRESS });
    assert.equal(response.status, 503);
    assert.deepEqual(response.body, {
      error: 'Faucet is temporarily unavailable, please try again later',
    });
  });

  test('responds 403 when the STX faucet is disabled', async () => {
    ENV.TESTNET_STX_FAUCET_ENABLED = false;
    try {
      const response = await requestFaucet({ address: RECIPIENT_ADDRESS });
      assert.equal(response.status, 403);
      assert.deepEqual(response.body, { error: 'STX faucet is not available' });
    } finally {
      ENV.TESTNET_STX_FAUCET_ENABLED = true;
    }
  });
});
