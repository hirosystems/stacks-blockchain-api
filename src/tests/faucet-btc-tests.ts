import { Server } from 'http';
import * as supertest from 'supertest';
import * as bitcoin from 'bitcoinjs-lib';
import {
  makeBtcFaucetPayment,
  getRpcClient,
  getFaucetAccount,
  getKeyAddress,
  getBtcBalance,
} from '../btc-faucet';
import { ApiServer, startApiServer } from '../api/init';
import { MemoryDataStore } from '../datastore/memory-store';
import { ChainID } from '@stacks/transactions';

async function getBalanceWithWalletImport(address: string): Promise<number> {
  const client = getRpcClient();
  const walletName = `recipient_wallet_${address}`;
  await client.createwallet({ wallet_name: walletName });
  await client.importaddress({ address: address, rescan: true }, walletName);
  const getBalanceResult: number = await client.getbalance({ include_watchonly: true }, walletName);
  return getBalanceResult;
}

describe('btc faucet', () => {
  const regtest = bitcoin.networks.regtest;

  beforeAll(async () => {
    // Mint btc to the faucet wallet address.
    const client = getRpcClient();
    const wallet = getFaucetAccount(regtest);
    await client.generatetoaddress({ address: wallet.address, nblocks: 110 });
  });

  test('tx change is returned to faucet', async () => {
    const client = getRpcClient();

    const wallet = getFaucetAccount(regtest);
    const faucetBalanceInitial = await getBtcBalance(regtest, wallet.address);

    const btcToSend1 = 0.5;
    const recipientAddress = getKeyAddress(bitcoin.ECPair.makeRandom({ network: regtest }));
    const paymentResult = await makeBtcFaucetPayment(regtest, recipientAddress, btcToSend1);
    expect(paymentResult.txId).toBeTruthy();

    await client.generatetoaddress({
      address: getKeyAddress(bitcoin.ECPair.makeRandom({ network: regtest })),
      nblocks: 100,
    });
    const faucetBalanceFinal = await getBtcBalance(regtest, wallet.address);

    const expectedFaucetBalance = faucetBalanceInitial - btcToSend1 - paymentResult.txFee;
    expect(faucetBalanceFinal).toBe(expectedFaucetBalance);

    const faucetBalanceImported = await getBalanceWithWalletImport(wallet.address);
    expect(faucetBalanceImported).toBe(expectedFaucetBalance);
  });

  test('send faucet transaction', async () => {
    const client = getRpcClient();
    const wallet = getFaucetAccount(regtest);

    // Mint btc to the faucet wallet address.
    await client.generatetoaddress({ address: wallet.address, nblocks: 110 });

    const btcToSend1 = 55.2;
    const recipientAddress1 = getKeyAddress(bitcoin.ECPair.makeRandom({ network: regtest }));
    const paymentResult1 = await makeBtcFaucetPayment(regtest, recipientAddress1, btcToSend1);
    expect(paymentResult1.txId).toBeTruthy();

    const btcToSend2 = 60.5;
    const recipientAddress2 = getKeyAddress(bitcoin.ECPair.makeRandom({ network: regtest }));
    const paymentResult2 = await makeBtcFaucetPayment(regtest, recipientAddress2, btcToSend2);
    expect(paymentResult2.txId).toBeTruthy();

    const btcToSend3 = 0.5;
    const recipientAddress3 = getKeyAddress(bitcoin.ECPair.makeRandom({ network: regtest }));
    const paymentResult3 = await makeBtcFaucetPayment(regtest, recipientAddress3, btcToSend3);
    expect(paymentResult3.txId).toBeTruthy();

    // Mine some blocks
    await client.generatetoaddress({ address: wallet.address, nblocks: 10 });

    // Test that recipient addresses received btc
    const getBalanceResult1 = await getBalanceWithWalletImport(recipientAddress1);
    expect(getBalanceResult1).toBe(btcToSend1);

    const fetchedBalance1 = await getBtcBalance(regtest, recipientAddress1);
    expect(fetchedBalance1).toBe(btcToSend1);

    const getBalanceResult2 = await getBalanceWithWalletImport(recipientAddress2);
    expect(getBalanceResult2).toBe(btcToSend2);

    const fetchedBalance2 = await getBtcBalance(regtest, recipientAddress2);
    expect(fetchedBalance2).toBe(btcToSend2);

    const getBalanceResult3 = await getBalanceWithWalletImport(recipientAddress3);
    expect(getBalanceResult3).toBe(btcToSend3);

    const fetchedBalance3 = await getBtcBalance(regtest, recipientAddress3);
    expect(fetchedBalance3).toBe(btcToSend3);
  });

  describe('faucet http API', () => {
    let apiServer: ApiServer;

    beforeAll(async () => {
      apiServer = await startApiServer({
        datastore: new MemoryDataStore(),
        chainId: ChainID.Testnet,
        httpLogLevel: 'silly',
      });
    });

    test('faucet http receive endpoint', async () => {
      const addr = getKeyAddress(bitcoin.ECPair.makeRandom({ network: regtest }));
      const response = await supertest(apiServer.server).post(
        `/extended/v1/faucets/btc?address=${addr}`
      );
      expect(response.status).toBe(200);
      const resJson = JSON.parse(response.text);
      expect(typeof resJson.txid).toBe('string');
      expect(typeof resJson.raw_tx).toBe('string');
    });

    test('faucet http balance endpoint', async () => {
      const addr = getKeyAddress(bitcoin.ECPair.makeRandom({ network: regtest }));
      const response = await supertest(apiServer.server).post(
        `/extended/v1/faucets/btc?address=${addr}`
      );
      expect(response.status).toBe(200);
      await getRpcClient().generatetoaddress({
        address: getKeyAddress(bitcoin.ECPair.makeRandom({ network: regtest })),
        nblocks: 1,
      });
      const balanceResponse = await supertest(apiServer.server).get(
        `/extended/v1/faucets/btc/${addr}`
      );
      expect(balanceResponse.status).toBe(200);
      expect(JSON.parse(balanceResponse.text)).toEqual({ balance: 0.5 });
    });

    afterAll(async () => {
      await apiServer.terminate();
    });
  });
});
