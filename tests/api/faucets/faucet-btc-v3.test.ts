import supertest from 'supertest';
import * as btc from 'bitcoinjs-lib';
import { STACKS_TESTNET } from '@stacks/network';
import { startApiServer, ApiServer } from '../../../src/api/init.ts';
import { getFaucetAccount } from '../../../src/btc-faucet.ts';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { DbFaucetRequestCurrency } from '../../../src/datastore/common.ts';
import { ENV } from '../../../src/env.ts';
import { migrate } from '../../test-helpers.ts';
import { MockBitcoinRpc, startMockBitcoinRpc, makeRandomBtcAddress } from './helpers.ts';
import { beforeEach, afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';

const FAUCET_SEED_BTC = 10;

describe('BTC faucet (v3)', () => {
  let db: PgWriteStore;
  let api: ApiServer;
  let bitcoind: MockBitcoinRpc;
  let faucetAddress: string;

  const requestFaucet = (body?: object) => {
    const req = supertest(api.server).post('/extended/v3/faucets/btc');
    return body === undefined ? req : req.send(body);
  };

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    bitcoind = await startMockBitcoinRpc();
    ENV.BTC_RPC_HOST = 'http://127.0.0.1';
    ENV.BTC_RPC_PORT = bitcoind.port;
    faucetAddress = getFaucetAccount(btc.networks.regtest).address;
    bitcoind.seedUtxo(faucetAddress, FAUCET_SEED_BTC);
    api = await startApiServer({
      datastore: db,
      writeDatastore: db,
      chainId: STACKS_TESTNET.chainId,
    });
  });

  afterEach(async () => {
    await api.terminate();
    await bitcoind.close();
    await db?.close();
    await migrate('down');
  });

  function recipientOutputSats(txHex: string, recipient: string): bigint[] {
    const tx = btc.Transaction.fromHex(txHex);
    const script = Buffer.from(btc.address.toOutputScript(recipient, btc.networks.regtest));
    return tx.outs.filter(out => script.equals(Buffer.from(out.script))).map(out => out.value);
  }

  test('sends the configured default amount and reports it in satoshis', async () => {
    const recipient = makeRandomBtcAddress();
    const response = await requestFaucet({ address: recipient });
    assert.equal(response.status, 200);

    // v3 does not echo the raw transaction, so the broadcast tx is read from the mock ledger.
    assert.equal(bitcoind.sentRawTxs.length, 1);
    const tx = btc.Transaction.fromHex(bitcoind.sentRawTxs[0]);
    assert.deepEqual(response.body, {
      transaction: { tx_id: `0x${tx.getId()}`, chain: 'bitcoin' },
      amount: { btc: '10000' },
    });
    assert.deepEqual(recipientOutputSats(bitcoind.sentRawTxs[0], recipient), [10_000n]);
  });

  test('sends and reports the amount configured by TESTNET_BTC_FAUCET_AMOUNT', async () => {
    const defaultAmount = ENV.TESTNET_BTC_FAUCET_AMOUNT;
    ENV.TESTNET_BTC_FAUCET_AMOUNT = 50_000_000;
    try {
      const recipient = makeRandomBtcAddress('p2wpkh');
      const response = await requestFaucet({ address: recipient });
      assert.equal(response.status, 200);
      assert.deepEqual(response.body.amount, { btc: '50000000' });
      assert.deepEqual(recipientOutputSats(bitcoind.sentRawTxs[0], recipient), [50_000_000n]);
    } finally {
      ENV.TESTNET_BTC_FAUCET_AMOUNT = defaultAmount;
    }
  });

  test('ignores the v1 `large`/`xlarge` options', async () => {
    const recipient = makeRandomBtcAddress();
    const response = await requestFaucet({ address: recipient, large: true, xlarge: true });
    assert.equal(response.status, 200);
    assert.deepEqual(response.body.amount, { btc: '10000' });
  });

  test('address is required in the body', async () => {
    const response = await requestFaucet({});
    assert.equal(response.status, 400);
    assert.deepEqual(Object.keys(response.body), ['error']);
    assert.match(response.body.error, /address/);
    assert.equal(bitcoind.sentRawTxs.length, 0);
  });

  test('a query string address is not accepted', async () => {
    const recipient = makeRandomBtcAddress();
    const response = await supertest(api.server).post(
      `/extended/v3/faucets/btc?address=${recipient}`
    );
    assert.equal(response.status, 400);
    assert.equal(bitcoind.sentRawTxs.length, 0);
  });

  test('rejects non-regtest, non-signet addresses', async () => {
    const mainnetAddress = makeRandomBtcAddress('p2pkh', btc.networks.bitcoin);
    const response = await requestFaucet({ address: mainnetAddress });
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: 'Invalid BTC regtest or signet address' });
  });

  test('is not rate limited or recorded by the API', async () => {
    // Faucet rate limits are enforced at the edge (Cloudflare), not by the API. Rows that would
    // trip the deprecated v1 limit (5 per 5 minutes) have no effect on v3.
    const recipient = makeRandomBtcAddress();
    for (let i = 0; i < 5; i++) {
      await db.insertFaucetRequest({
        ip: '127.0.0.1',
        address: recipient,
        currency: DbFaucetRequestCurrency.BTC,
        occurred_at: Date.now(),
      });
    }
    const responses = await Promise.all(
      Array.from({ length: 3 }, () => requestFaucet({ address: recipient }))
    );
    assert.deepEqual(
      responses.map(r => r.status),
      [200, 200, 200]
    );
    assert.equal(bitcoind.sentRawTxs.length, 3);
    // Only the seeded rows remain: v3 requests are not recorded.
    const requests = await db.getBTCFaucetRequests(recipient);
    assert.equal(requests.results.length, 5);
  });

  test('responds 503 out-of-funds when spendable UTXOs cannot cover the request', async () => {
    // Replace the mock ledger with one whose only faucet UTXO is below the configured amount.
    await bitcoind.close();
    bitcoind = await startMockBitcoinRpc();
    ENV.BTC_RPC_PORT = bitcoind.port;
    bitcoind.seedUtxo(faucetAddress, 0.00005);

    const response = await requestFaucet({ address: makeRandomBtcAddress() });
    assert.equal(response.status, 503);
    assert.deepEqual(response.body, {
      error: 'The faucet is temporarily out of funds, please try again later',
    });
  });

  test('responds 503 unavailable when bitcoind is unreachable', async () => {
    await bitcoind.close();
    const response = await requestFaucet({ address: makeRandomBtcAddress() });
    assert.equal(response.status, 503);
    assert.deepEqual(response.body, {
      error: 'Faucet is temporarily unavailable, please try again later',
    });
  });

  test('responds 403 when the BTC faucet is disabled', async () => {
    ENV.TESTNET_BTC_FAUCET_ENABLED = false;
    try {
      const response = await requestFaucet({ address: makeRandomBtcAddress() });
      assert.equal(response.status, 403);
      assert.deepEqual(response.body, { error: 'BTC faucet is not available' });
    } finally {
      ENV.TESTNET_BTC_FAUCET_ENABLED = true;
    }
  });
});
