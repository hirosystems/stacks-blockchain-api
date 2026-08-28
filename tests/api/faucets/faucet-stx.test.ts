import supertest from 'supertest';
import { decodeTransaction, TxPayloadTypeID } from '@stacks/codec';
import type { DecodedTxResult, TxPayloadTokenTransfer } from '@stacks/codec';
import { STACKS_MAINNET, STACKS_TESTNET } from '@stacks/network';
import { startApiServer, ApiServer } from '../../../src/api/init.ts';
import { FAUCET_TESTNET_KEYS } from '../../../src/api/routes/v1/faucets.ts';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { DbFaucetRequestCurrency } from '../../../src/datastore/common.ts';
import { getStxFaucetNetwork, stxToMicroStx } from '../../../src/helpers.ts';
import { ENV } from '../../../src/env.ts';
import { migrate } from '../../test-helpers.ts';
import {
  MockStacksNode,
  startMockStacksNode,
  MOCK_FEE_ESTIMATE,
  MOCK_POX_MIN_AMOUNT_USTX,
} from './helpers.ts';
import { beforeEach, afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

const RECIPIENT_ADDRESS = 'ST3M7N9Q9HDRM7RVP1Q26P0EE69358PZZAZD7KMXQ';

function decodeTokenTransfer(txRaw: string): DecodedTxResult & { payload: TxPayloadTokenTransfer } {
  const tx = decodeTransaction(txRaw);
  assert.equal(tx.payload.type_id, TxPayloadTypeID.TokenTransfer);
  return tx as DecodedTxResult & { payload: TxPayloadTokenTransfer };
}

describe('STX faucet', () => {
  let db: PgWriteStore;
  let api: ApiServer;
  let node: MockStacksNode;

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

  test('transfers the default amount to the recipient', async () => {
    const response = await supertest(api.server).post(
      `/extended/v1/faucets/stx?address=${RECIPIENT_ADDRESS}`
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);

    // The broadcast tx is the one returned in the response.
    assert.equal(node.receivedTxs.length, 1);
    assert.equal(node.receivedTxs[0], response.body.txRaw);

    const tx = decodeTokenTransfer(response.body.txRaw);
    assert.equal(response.body.txId, tx.tx_id);
    assert.equal(tx.payload.recipient.address, RECIPIENT_ADDRESS);
    assert.equal(tx.payload.amount, stxToMicroStx(500).toString());
    const memo = Buffer.from(tx.payload.memo_hex.replace(/^0x/, ''), 'hex');
    assert.equal(memo.toString('utf8').replace(/\0/g, ''), 'faucet');
    assert.equal(tx.auth.origin_condition.signer.address, FAUCET_TESTNET_KEYS[0].stacksAddress);
    assert.equal(tx.auth.origin_condition.nonce, '0');
    assert.equal(tx.auth.origin_condition.tx_fee, MOCK_FEE_ESTIMATE.toString());

    // The request is recorded for rate limiting.
    const requests = await db.getSTXFaucetRequests(RECIPIENT_ADDRESS);
    assert.equal(requests.results.length, 1);
    assert.equal(requests.results[0].currency, DbFaucetRequestCurrency.STX);
  });

  test('stacking request uses the PoX minimum plus padding', async () => {
    const response = await supertest(api.server).post(
      `/extended/v1/faucets/stx?address=${RECIPIENT_ADDRESS}&stacking=true`
    );
    assert.equal(response.status, 200);
    const tx = decodeTokenTransfer(response.body.txRaw);
    const expectedAmount = BigInt(MOCK_POX_MIN_AMOUNT_USTX * 1.2);
    assert.equal(tx.payload.amount, expectedAmount.toString());
  });

  test('stacking request falls back to the default amount when PoX info is unavailable', async () => {
    node.poxResponse = { status: 500, body: { error: 'PoX info unavailable' } };
    const response = await supertest(api.server).post(
      `/extended/v1/faucets/stx?address=${RECIPIENT_ADDRESS}&stacking=true`
    );
    assert.equal(response.status, 200);
    const tx = decodeTokenTransfer(response.body.txRaw);
    assert.equal(tx.payload.amount, stxToMicroStx(500).toString());
  });

  test('falls back to a fixed fee when fee estimation is unavailable', async () => {
    node.feeEstimateResponse = { status: 500, body: { error: 'estimator offline' } };
    const response = await supertest(api.server).post(
      `/extended/v1/faucets/stx?address=${RECIPIENT_ADDRESS}`
    );
    assert.equal(response.status, 200);
    const tx = decodeTokenTransfer(response.body.txRaw);
    assert.equal(tx.auth.origin_condition.tx_fee, '200');
  });

  test('address is required', async () => {
    const response = await supertest(api.server).post(`/extended/v1/faucets/stx`);
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: 'address required', success: false });
  });

  test('POST body parameters are rejected with a helpful error', async () => {
    const response = await supertest(api.server)
      .post(`/extended/v1/faucets/stx`)
      .send({ address: RECIPIENT_ADDRESS });
    assert.equal(response.status, 400);
    assert.equal(response.body.success, false);
    assert.ok(response.body.error.includes('POST body is no longer supported'));
    assert.ok(response.body.error.includes(`address=${RECIPIENT_ADDRESS}`));
    assert.equal(node.receivedTxs.length, 0);
  });

  test('requests are rate limited per address', async () => {
    for (let i = 0; i < 5; i++) {
      await db.insertFaucetRequest({
        ip: '127.0.0.1',
        address: RECIPIENT_ADDRESS,
        currency: DbFaucetRequestCurrency.STX,
        occurred_at: Date.now(),
      });
    }
    const response = await supertest(api.server).post(
      `/extended/v1/faucets/stx?address=${RECIPIENT_ADDRESS}`
    );
    assert.equal(response.status, 429);
    assert.deepEqual(response.body, { error: 'Too many requests', success: false });
    assert.equal(node.receivedTxs.length, 0);
  });

  test('stacking requests are rate limited after a single recent request', async () => {
    await db.insertFaucetRequest({
      ip: '127.0.0.1',
      address: RECIPIENT_ADDRESS,
      currency: DbFaucetRequestCurrency.STX,
      occurred_at: Date.now(),
    });
    const response = await supertest(api.server).post(
      `/extended/v1/faucets/stx?address=${RECIPIENT_ADDRESS}&stacking=true`
    );
    assert.equal(response.status, 429);
  });

  test('responds 503 out-of-funds when the node rejects with NotEnoughFunds', async () => {
    node.sendTxResponses.push({
      status: 400,
      body: { error: 'transaction rejected', reason: 'NotEnoughFunds' },
    });
    const response = await supertest(api.server).post(
      `/extended/v1/faucets/stx?address=${RECIPIENT_ADDRESS}`
    );
    assert.equal(response.status, 503);
    assert.deepEqual(response.body, {
      error: 'The faucet is temporarily out of funds, please try again later',
      success: false,
    });
  });

  test('responds 503 unavailable when the node is unreachable', async () => {
    await node.close();
    const response = await supertest(api.server).post(
      `/extended/v1/faucets/stx?address=${RECIPIENT_ADDRESS}`
    );
    assert.equal(response.status, 503);
    assert.deepEqual(response.body, {
      error: 'Faucet is temporarily unavailable, please try again later',
      success: false,
    });
  });

  test('responds 403 when the STX faucet is disabled', async () => {
    ENV.TESTNET_STX_FAUCET_ENABLED = false;
    try {
      const response = await supertest(api.server).post(
        `/extended/v1/faucets/stx?address=${RECIPIENT_ADDRESS}`
      );
      assert.equal(response.status, 403);
      assert.deepEqual(response.body, { error: 'STX faucet is not available', success: false });
    } finally {
      ENV.TESTNET_STX_FAUCET_ENABLED = true;
    }
  });
});

describe('STX faucet key rotation', () => {
  let db: PgWriteStore;
  let api: ApiServer;
  let node: MockStacksNode;

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
    // The faucet key list is captured when routes are registered, so it must be set before the
    // API server starts.
    ENV.FAUCET_PRIVATE_KEY = `${FAUCET_TESTNET_KEYS[0].secretKey},${FAUCET_TESTNET_KEYS[1].secretKey}`;
    api = await startApiServer({
      datastore: db,
      writeDatastore: db,
      chainId: STACKS_TESTNET.chainId,
    });
  });

  afterEach(async () => {
    ENV.FAUCET_PRIVATE_KEY = undefined;
    ENV.STACKS_FAUCET_NODE_HOST = undefined;
    ENV.STACKS_FAUCET_NODE_PORT = undefined;
    await api.terminate();
    await node.close();
    await db?.close();
    await migrate('down');
  });

  test('rotates to the next faucet key on a nonce conflict', async () => {
    node.sendTxResponses.push({
      status: 400,
      body: { error: 'transaction rejected', reason: 'ConflictingNonceInMempool' },
    });
    const response = await supertest(api.server).post(
      `/extended/v1/faucets/stx?address=${RECIPIENT_ADDRESS}`
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(node.receivedTxs.length, 2);
    const firstSender = decodeTokenTransfer(node.receivedTxs[0]).auth.origin_condition.signer;
    const secondSender = decodeTokenTransfer(node.receivedTxs[1]).auth.origin_condition.signer;
    assert.notEqual(firstSender.address, secondSender.address);
  });
});

describe('faucet availability', () => {
  let db: PgWriteStore;
  let api: ApiServer;

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    api = await startApiServer({
      datastore: db,
      writeDatastore: db,
      chainId: STACKS_MAINNET.chainId,
    });
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await migrate('down');
  });

  test('faucets are not available on mainnet', async () => {
    for (const faucet of ['stx', 'btc', 'sbtc']) {
      const response = await supertest(api.server).post(
        `/extended/v1/faucets/${faucet}?address=${RECIPIENT_ADDRESS}`
      );
      assert.equal(response.status, 403);
      assert.deepEqual(response.body, { error: 'Faucet is not available', success: false });
    }
  });
});

describe('STX faucet network config', () => {
  test('faucet node env var override', () => {
    const faucetDefaults = getStxFaucetNetwork();
    assert.equal(faucetDefaults.client.baseUrl, 'http://127.0.0.1:20443');

    ENV.STACKS_FAUCET_NODE_HOST = '1.2.3.4';
    ENV.STACKS_FAUCET_NODE_PORT = 12345;
    try {
      const faucetOverride = getStxFaucetNetwork();
      assert.equal(faucetOverride.client.baseUrl, 'http://1.2.3.4:12345');
    } finally {
      ENV.STACKS_FAUCET_NODE_HOST = undefined;
      ENV.STACKS_FAUCET_NODE_PORT = undefined;
    }
  });
});
