import supertest from 'supertest';
import { decodeTransaction, TxPayloadTypeID } from '@stacks/codec';
import type { DecodedTxResult, TxPayloadContractCall } from '@stacks/codec';
import { STACKS_TESTNET } from '@stacks/network';
import { startApiServer, ApiServer } from '../../../src/api/init.ts';
import { FAUCET_TESTNET_KEYS } from '../../../src/api/faucets/common.ts';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { DbFaucetRequestCurrency } from '../../../src/datastore/common.ts';
import { ENV } from '../../../src/env.ts';
import { migrate } from '../../test-helpers.ts';
import { MockStacksNode, startMockStacksNode } from './helpers.ts';
import { beforeEach, afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

const RECIPIENT_ADDRESS = 'ST3M7N9Q9HDRM7RVP1Q26P0EE69358PZZAZD7KMXQ';

/**
 * v3 does not return the raw transaction hex, so tests decode the tx the mock node actually
 * received rather than one echoed back in the response.
 */
function decodeBroadcastContractCall(
  node: MockStacksNode,
  index = 0
): DecodedTxResult & { payload: TxPayloadContractCall } {
  const tx = decodeTransaction(node.receivedTxs[index]);
  assert.equal(tx.payload.type_id, TxPayloadTypeID.ContractCall);
  return tx as DecodedTxResult & { payload: TxPayloadContractCall };
}

describe('sBTC faucet (v3)', () => {
  let db: PgWriteStore;
  let api: ApiServer;
  let node: MockStacksNode;

  const requestFaucet = (body?: object) => {
    const req = supertest(api.server).post('/extended/v3/faucets/sbtc');
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
    ENV.TESTNET_SBTC_FAUCET_ENABLED = true;
    api = await startApiServer({
      datastore: db,
      writeDatastore: db,
      chainId: STACKS_TESTNET.chainId,
    });
  });

  afterEach(async () => {
    ENV.TESTNET_SBTC_FAUCET_ENABLED = false;
    ENV.STACKS_FAUCET_NODE_HOST = undefined;
    ENV.STACKS_FAUCET_NODE_PORT = undefined;
    await api.terminate();
    await node.close();
    await db?.close();
    await migrate('down');
  });

  test('transfers sBTC and reports the amount in satoshis', async () => {
    const [contractId] = ENV.TESTNET_SBTC_FAUCET_ASSET_IDENTIFIER.split('::');
    const [contractAddress, contractName] = contractId.split('.');
    const senderAddress = FAUCET_TESTNET_KEYS[0].stacksAddress;

    const response = await requestFaucet({ address: RECIPIENT_ADDRESS });
    assert.equal(response.status, 200);

    assert.equal(node.receivedTxs.length, 1);
    const tx = decodeBroadcastContractCall(node);
    assert.deepEqual(response.body, {
      transaction: { tx_id: tx.tx_id, chain: 'stacks' },
      amount: { sbtc: ENV.TESTNET_SBTC_FAUCET_AMOUNT.toString() },
    });
    assert.equal('txRaw' in response.body, false);
    assert.equal('success' in response.body, false);
    assert.match(response.body.transaction.tx_id, /^0x[a-f0-9]{64}$/);

    assert.equal(tx.payload.address, contractAddress);
    assert.equal(tx.payload.contract_name, contractName);
    assert.equal(tx.payload.function_name, 'transfer');
    assert.equal(tx.payload.function_args[0].repr, `u${ENV.TESTNET_SBTC_FAUCET_AMOUNT}`);
    assert.equal(tx.payload.function_args[2].repr, `'${RECIPIENT_ADDRESS}`);
    assert.equal(tx.auth.origin_condition.signer.address, senderAddress);
  });

  test('reports the configured sBTC amount', async () => {
    const defaultAmount = ENV.TESTNET_SBTC_FAUCET_AMOUNT;
    ENV.TESTNET_SBTC_FAUCET_AMOUNT = 12345;
    try {
      const response = await requestFaucet({ address: RECIPIENT_ADDRESS });
      assert.equal(response.status, 200);
      assert.deepEqual(response.body.amount, { sbtc: '12345' });
      assert.equal(decodeBroadcastContractCall(node).payload.function_args[0].repr, 'u12345');
    } finally {
      ENV.TESTNET_SBTC_FAUCET_AMOUNT = defaultAmount;
    }
  });

  test('address is required in the body', async () => {
    const response = await requestFaucet({});
    assert.equal(response.status, 400);
    assert.deepEqual(Object.keys(response.body), ['error']);
    assert.match(response.body.error, /address/);
    assert.equal(node.receivedTxs.length, 0);
  });

  test('rejects addresses that are not valid testnet Stacks principals', async () => {
    for (const address of ['not-an-address', 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE']) {
      const response = await requestFaucet({ address });
      assert.equal(response.status, 400, address);
      assert.deepEqual(response.body, { error: 'Invalid testnet Stacks address' }, address);
    }
    assert.equal(node.receivedTxs.length, 0);
  });

  test('a query string address is not accepted', async () => {
    const response = await supertest(api.server).post(
      `/extended/v3/faucets/sbtc?address=${RECIPIENT_ADDRESS}`
    );
    assert.equal(response.status, 400);
    assert.equal(node.receivedTxs.length, 0);
  });

  test('is not rate limited or recorded by the API', async () => {
    // Faucet rate limits are enforced at the edge (Cloudflare), not by the API. Rows that would
    // trip the deprecated v1 limit (5 per 5 minutes) have no effect on v3.
    for (let i = 0; i < 5; i++) {
      await db.insertFaucetRequest({
        ip: '127.0.0.1',
        address: RECIPIENT_ADDRESS,
        currency: DbFaucetRequestCurrency.SBTC,
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
    const requests = await db.getSBTCFaucetRequests(RECIPIENT_ADDRESS);
    assert.equal(requests.results.length, 5);
  });

  test('STX and sBTC requests from the shared faucet account are serialized', async () => {
    // sBTC always sends from the first faucet key, which (as the only key configured) STX also
    // uses. Both derive that account's nonce per request, so they share its queue: one must
    // broadcast before the other starts building its transaction. A slow fee estimate widens the
    // window in which unserialized requests would interleave.
    node.feeEstimateDelayMs = 100;
    const [stx, sbtc] = await Promise.all([
      supertest(api.server).post('/extended/v3/faucets/stx').send({ address: RECIPIENT_ADDRESS }),
      requestFaucet({ address: RECIPIENT_ADDRESS }),
    ]);
    assert.equal(stx.status, 200);
    assert.equal(sbtc.status, 200);
    const buildAndBroadcast = node.requestLog.filter(
      path => path === '/v2/info' || path === '/v2/transactions'
    );
    assert.deepEqual(buildAndBroadcast, [
      '/v2/info',
      '/v2/transactions',
      '/v2/info',
      '/v2/transactions',
    ]);
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

  test('responds 403 when the sBTC faucet is disabled', async () => {
    ENV.TESTNET_SBTC_FAUCET_ENABLED = false;
    const response = await requestFaucet({ address: RECIPIENT_ADDRESS });
    assert.equal(response.status, 403);
    assert.deepEqual(response.body, { error: 'sBTC faucet is not available' });
  });
});
