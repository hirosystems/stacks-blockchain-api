import supertest from 'supertest';
import * as bitcoin from 'bitcoinjs-lib';
import { ECPair } from '../../../src/ec-helpers.ts';
import {
  makeBtcFaucetPayment,
  getFaucetAccount,
  getKeyAddress,
  getBtcBalance,
} from '../../../src/btc-faucet.ts';
import { ENV } from '../../../src/env.ts';
import { getKryptonContext, KryptonContext, stopKryptonContext } from '../krypton-env.ts';
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';

async function getBalanceWithWalletImport(ctx: KryptonContext, address: string): Promise<number> {
  const client = ctx.bitcoinRpcClient;
  const walletName = `recipient_wallet_${address}`;
  await client.createwallet({ wallet_name: walletName });
  await client.importaddress({ address: address, rescan: true }, walletName);
  const getBalanceResult: number = await client.getbalance({ include_watchonly: true }, walletName);
  return getBalanceResult;
}

describe('btc faucet', () => {
  let ctx: KryptonContext;
  const regtest = bitcoin.networks.regtest;

  before(async () => {
    ctx = await getKryptonContext();
    // Mint btc to the faucet wallet address.
    const client = ctx.bitcoinRpcClient;
    const wallet = getFaucetAccount(regtest);
    await client.generatetoaddress({ address: wallet.address, nblocks: 110 });
  });

  after(async () => {
    await stopKryptonContext(ctx);
  });

  test('tx change is returned to faucet', async () => {
    const client = ctx.bitcoinRpcClient;

    const wallet = getFaucetAccount(regtest);
    const faucetBalanceInitial = await getBtcBalance(regtest, wallet.address);

    const btcToSend1 = 0.5;
    const recipientAddress = getKeyAddress(ECPair.makeRandom({ network: regtest }));
    const paymentResult = await makeBtcFaucetPayment(regtest, recipientAddress, btcToSend1);
    assert.ok(paymentResult.txId);

    await client.generatetoaddress({
      address: getKeyAddress(ECPair.makeRandom({ network: regtest })),
      nblocks: 100,
    });
    const faucetBalanceFinal = await getBtcBalance(regtest, wallet.address);

    const expectedFaucetBalance = faucetBalanceInitial - btcToSend1 - paymentResult.txFee;
    assert.equal(faucetBalanceFinal, expectedFaucetBalance);

    const faucetBalanceImported = await getBalanceWithWalletImport(ctx, wallet.address);
    assert.equal(faucetBalanceImported, expectedFaucetBalance);
  });

  test('send faucet transaction', async () => {
    const client = ctx.bitcoinRpcClient;
    const wallet = getFaucetAccount(regtest);

    // Mint btc to the faucet wallet address.
    await client.generatetoaddress({ address: wallet.address, nblocks: 110 });

    const btcToSend1 = 55.2;
    const recipientAddress1 = getKeyAddress(ECPair.makeRandom({ network: regtest }));
    const paymentResult1 = await makeBtcFaucetPayment(regtest, recipientAddress1, btcToSend1);
    assert.ok(paymentResult1.txId);

    const btcToSend2 = 60.5;
    const recipientAddress2 = getKeyAddress(ECPair.makeRandom({ network: regtest }));
    const paymentResult2 = await makeBtcFaucetPayment(regtest, recipientAddress2, btcToSend2);
    assert.ok(paymentResult2.txId);

    const btcToSend3 = 0.5;
    const recipientAddress3 = getKeyAddress(ECPair.makeRandom({ network: regtest }));
    const paymentResult3 = await makeBtcFaucetPayment(regtest, recipientAddress3, btcToSend3);
    assert.ok(paymentResult3.txId);

    // Mine some blocks
    await client.generatetoaddress({ address: wallet.address, nblocks: 10 });

    // Test that recipient addresses received btc
    const getBalanceResult1 = await getBalanceWithWalletImport(ctx, recipientAddress1);
    assert.equal(getBalanceResult1, btcToSend1);

    const fetchedBalance1 = await getBtcBalance(regtest, recipientAddress1);
    assert.equal(fetchedBalance1, btcToSend1);

    const getBalanceResult2 = await getBalanceWithWalletImport(ctx, recipientAddress2);
    assert.equal(getBalanceResult2, btcToSend2);

    const fetchedBalance2 = await getBtcBalance(regtest, recipientAddress2);
    assert.equal(fetchedBalance2, btcToSend2);

    const getBalanceResult3 = await getBalanceWithWalletImport(ctx, recipientAddress3);
    assert.equal(getBalanceResult3, btcToSend3);

    const fetchedBalance3 = await getBtcBalance(regtest, recipientAddress3);
    assert.equal(fetchedBalance3, btcToSend3);
  });

  describe('faucet http API', () => {
    test('faucet http receive endpoint', async () => {
      const addr = getKeyAddress(ECPair.makeRandom({ network: regtest }));
      const response = await supertest(ctx.api.server).post(
        `/extended/v1/faucets/btc?address=${addr}`
      );
      assert.equal(response.status, 200);
      const resJson = JSON.parse(response.text);
      assert.equal(typeof resJson.txid, 'string');
      assert.equal(typeof resJson.raw_tx, 'string');
    });

    test('faucet http balance endpoint', async () => {
      const addr = getKeyAddress(ECPair.makeRandom({ network: regtest }));
      const response = await supertest(ctx.api.server).post(
        `/extended/v1/faucets/btc?address=${addr}`
      );
      assert.equal(response.status, 200);
      await ctx.bitcoinRpcClient.generatetoaddress({
        address: getKeyAddress(ECPair.makeRandom({ network: regtest })),
        nblocks: 1,
      });
      const balanceResponse = await supertest(ctx.api.server).get(
        `/extended/v1/faucets/btc/${addr}`
      );
      assert.equal(balanceResponse.status, 200);
      assert.deepEqual(JSON.parse(balanceResponse.text), { balance: 0.0001 });
    });

    test('faucet http balance endpoint large', async () => {
      const addr = getKeyAddress(ECPair.makeRandom({ network: regtest }));
      const response = await supertest(ctx.api.server).post(
        `/extended/v1/faucets/btc?address=${addr}&large=true`
      );
      assert.equal(response.status, 200);
      await ctx.bitcoinRpcClient.generatetoaddress({
        address: getKeyAddress(ECPair.makeRandom({ network: regtest })),
        nblocks: 1,
      });
      const balanceResponse = await supertest(ctx.api.server).get(
        `/extended/v1/faucets/btc/${addr}`
      );
      assert.equal(balanceResponse.status, 200);
      assert.deepEqual(JSON.parse(balanceResponse.text), { balance: 0.01 });
    });

    test('faucet http balance endpoint xlarge', async () => {
      const addr = getKeyAddress(ECPair.makeRandom({ network: regtest }));
      const response = await supertest(ctx.api.server).post(
        `/extended/v1/faucets/btc?address=${addr}&xlarge=true`
      );
      assert.equal(response.status, 200);
      await ctx.bitcoinRpcClient.generatetoaddress({
        address: getKeyAddress(ECPair.makeRandom({ network: regtest })),
        nblocks: 1,
      });
      const balanceResponse = await supertest(ctx.api.server).get(
        `/extended/v1/faucets/btc/${addr}`
      );
      assert.equal(balanceResponse.status, 200);
      assert.deepEqual(JSON.parse(balanceResponse.text), { balance: 0.5 });
    });

    test('faucet not configured', async () => {
      ENV.BTC_RPC_PORT = 0;
      const addr = getKeyAddress(ECPair.makeRandom({ network: regtest }));
      const response = await supertest(ctx.api.server).post(
        `/extended/v1/faucets/btc?address=${addr}`
      );
      assert.equal(response.status, 403);
      const resJson = JSON.parse(response.text);
      assert.equal(resJson.error, 'BTC Faucet is not configured.');
    });
  });
});
