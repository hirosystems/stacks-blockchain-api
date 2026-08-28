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

describe('BTC faucet', () => {
  let db: PgWriteStore;
  let api: ApiServer;
  let bitcoind: MockBitcoinRpc;
  let faucetAddress: string;

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

  async function getBalanceFromApi(address: string): Promise<number> {
    const response = await supertest(api.server).get(`/extended/v1/faucets/btc/${address}`);
    assert.equal(response.status, 200);
    return response.body.balance;
  }

  test('sends the default amount and returns change to the faucet', async () => {
    const recipient = makeRandomBtcAddress();
    const response = await supertest(api.server).post(
      `/extended/v1/faucets/btc?address=${recipient}`
    );
    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
    assert.equal(typeof response.body.txid, 'string');
    assert.equal(typeof response.body.raw_tx, 'string');

    // The broadcast tx pays the recipient the default 0.0001 BTC and change back to the faucet.
    assert.equal(bitcoind.sentRawTxs.length, 1);
    assert.equal(bitcoind.sentRawTxs[0], response.body.raw_tx);
    const tx = btc.Transaction.fromHex(response.body.raw_tx);
    assert.equal(tx.getId(), response.body.txid);
    const recipientScript = Buffer.from(
      btc.address.toOutputScript(recipient, btc.networks.regtest)
    );
    const faucetScript = Buffer.from(
      btc.address.toOutputScript(faucetAddress, btc.networks.regtest)
    );
    const recipientOutputs = tx.outs.filter(out => recipientScript.equals(Buffer.from(out.script)));
    const changeOutputs = tx.outs.filter(out => faucetScript.equals(Buffer.from(out.script)));
    assert.equal(recipientOutputs.length, 1);
    assert.equal(recipientOutputs[0].value, 10_000n);
    assert.equal(changeOutputs.length, 1);

    // The paid fee is the seeded amount minus every output.
    const outputTotal = tx.outs.reduce((total, out) => total + out.value, 0n);
    const feeSats = BigInt(FAUCET_SEED_BTC * 1e8) - outputTotal;
    assert.ok(feeSats > 0n);

    assert.equal(await getBalanceFromApi(recipient), 0.0001);
    const expectedFaucetBalance = Number(changeOutputs[0].value) / 1e8;
    assert.equal(await getBalanceFromApi(faucetAddress), expectedFaucetBalance);

    const requests = await db.getBTCFaucetRequests(recipient);
    assert.equal(requests.results.length, 1);
    assert.equal(requests.results[0].currency, DbFaucetRequestCurrency.BTC);
  });

  test('accepts the address via the POST body', async () => {
    const recipient = makeRandomBtcAddress();
    const response = await supertest(api.server)
      .post(`/extended/v1/faucets/btc`)
      .send({ address: recipient });
    assert.equal(response.status, 200);
    assert.equal(response.body.success, true);
  });

  test('sends larger amounts for large and xlarge requests', async () => {
    const largeRecipient = makeRandomBtcAddress();
    const largeResponse = await supertest(api.server).post(
      `/extended/v1/faucets/btc?address=${largeRecipient}&large=true`
    );
    assert.equal(largeResponse.status, 200);
    assert.equal(await getBalanceFromApi(largeRecipient), 0.01);

    const xlargeRecipient = makeRandomBtcAddress();
    const xlargeResponse = await supertest(api.server).post(
      `/extended/v1/faucets/btc?address=${xlargeRecipient}&xlarge=true`
    );
    assert.equal(xlargeResponse.status, 200);
    assert.equal(await getBalanceFromApi(xlargeRecipient), 0.5);
  });

  test('spends change from previous faucet transactions', async () => {
    const firstRecipient = makeRandomBtcAddress();
    const firstResponse = await supertest(api.server).post(
      `/extended/v1/faucets/btc?address=${firstRecipient}&large=true`
    );
    assert.equal(firstResponse.status, 200);

    // The only spendable faucet UTXO is now the change output of the first tx.
    const secondRecipient = makeRandomBtcAddress('p2wpkh');
    const secondResponse = await supertest(api.server).post(
      `/extended/v1/faucets/btc?address=${secondRecipient}&large=true`
    );
    assert.equal(secondResponse.status, 200);
    assert.equal(await getBalanceFromApi(secondRecipient), 0.01);

    const secondTx = btc.Transaction.fromHex(secondResponse.body.raw_tx);
    const firstTxId = firstResponse.body.txid;
    const spentTxIds = secondTx.ins.map(input =>
      Buffer.from(input.hash).reverse().toString('hex')
    );
    assert.deepEqual(spentTxIds, [firstTxId]);
  });

  test('rejects large and xlarge requested together', async () => {
    const recipient = makeRandomBtcAddress();
    const response = await supertest(api.server).post(
      `/extended/v1/faucets/btc?address=${recipient}&large=true&xlarge=true`
    );
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, {
      error: 'cannot simultaneously request a large and xlarge amount',
      success: false,
    });
  });

  test('address is required', async () => {
    const response = await supertest(api.server).post(`/extended/v1/faucets/btc`);
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: 'address required', success: false });
  });

  test('rejects non-regtest addresses', async () => {
    const mainnetAddress = makeRandomBtcAddress('p2pkh', btc.networks.bitcoin);
    const response = await supertest(api.server).post(
      `/extended/v1/faucets/btc?address=${mainnetAddress}`
    );
    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { error: 'Invalid BTC regtest address', success: false });
  });

  test('requests are rate limited per address', async () => {
    const recipient = makeRandomBtcAddress();
    for (let i = 0; i < 5; i++) {
      await db.insertFaucetRequest({
        ip: '127.0.0.1',
        address: recipient,
        currency: DbFaucetRequestCurrency.BTC,
        occurred_at: Date.now(),
      });
    }
    const response = await supertest(api.server).post(
      `/extended/v1/faucets/btc?address=${recipient}`
    );
    assert.equal(response.status, 429);
    assert.deepEqual(response.body, { error: 'Too many requests', success: false });
    assert.equal(bitcoind.sentRawTxs.length, 0);
  });

  test('responds 503 out-of-funds when spendable UTXOs cannot cover the request', async () => {
    // Replace the mock ledger with one whose only faucet UTXO is too small for an xlarge request.
    await bitcoind.close();
    bitcoind = await startMockBitcoinRpc();
    ENV.BTC_RPC_PORT = bitcoind.port;
    bitcoind.seedUtxo(faucetAddress, 0.001);

    const recipient = makeRandomBtcAddress();
    const response = await supertest(api.server).post(
      `/extended/v1/faucets/btc?address=${recipient}&xlarge=true`
    );
    assert.equal(response.status, 503);
    assert.deepEqual(response.body, {
      error: 'The faucet is temporarily out of funds, please try again later',
      success: false,
    });
  });

  test('immature coinbase UTXOs are not spendable', async () => {
    await bitcoind.close();
    bitcoind = await startMockBitcoinRpc();
    ENV.BTC_RPC_PORT = bitcoind.port;
    // 50 confirmations: enough for a regular UTXO, not for a coinbase UTXO (needs 100).
    bitcoind.seedUtxo(faucetAddress, FAUCET_SEED_BTC, {
      height: bitcoind.chainHeight - 50,
      coinbase: true,
    });

    const recipient = makeRandomBtcAddress();
    const response = await supertest(api.server).post(
      `/extended/v1/faucets/btc?address=${recipient}`
    );
    assert.equal(response.status, 503);
    assert.deepEqual(response.body, {
      error: 'The faucet is temporarily out of funds, please try again later',
      success: false,
    });
  });

  test('responds 503 unavailable when bitcoind is unreachable', async () => {
    await bitcoind.close();
    const recipient = makeRandomBtcAddress();
    const response = await supertest(api.server).post(
      `/extended/v1/faucets/btc?address=${recipient}`
    );
    assert.equal(response.status, 503);
    assert.deepEqual(response.body, {
      error: 'Faucet is temporarily unavailable, please try again later',
      success: false,
    });
  });

  test('responds 403 when bitcoind is not configured', async () => {
    const configuredPort = ENV.BTC_RPC_PORT;
    ENV.BTC_RPC_PORT = 0;
    try {
      const recipient = makeRandomBtcAddress();
      const response = await supertest(api.server).post(
        `/extended/v1/faucets/btc?address=${recipient}`
      );
      assert.equal(response.status, 403);
      assert.deepEqual(response.body, { error: 'BTC Faucet is not configured.', success: false });
    } finally {
      ENV.BTC_RPC_PORT = configuredPort;
    }
  });

  test('responds 403 when the BTC faucet is disabled', async () => {
    ENV.TESTNET_BTC_FAUCET_ENABLED = false;
    try {
      const recipient = makeRandomBtcAddress();
      const response = await supertest(api.server).post(
        `/extended/v1/faucets/btc?address=${recipient}`
      );
      assert.equal(response.status, 403);
      assert.deepEqual(response.body, { error: 'BTC faucet is not available', success: false });
    } finally {
      ENV.TESTNET_BTC_FAUCET_ENABLED = true;
    }
  });
});
