import * as bitcoin from 'bitcoinjs-lib';
import { makeBTCFaucetPayment, getRpcClient, getFaucetWallet, getKeyAddress } from '../btc-faucet';

test('test btc faucet', async () => {
  const regtest = bitcoin.networks.regtest;

  const client = getRpcClient();

  const wallet = getFaucetWallet(regtest);

  // Mint btc to the faucet wallet address.
  await client.generatetoaddress({ address: wallet.address, nblocks: 110 });

  const btcToSend = 55.2;
  const recipientAddress = getKeyAddress(bitcoin.ECPair.makeRandom({ network: regtest }));
  const paymentResult = await makeBTCFaucetPayment(regtest, recipientAddress, btcToSend);
  expect(paymentResult.txId).toBeTruthy();

  // Mine some blocks
  await client.generatetoaddress({ address: wallet.address, nblocks: 10 });

  // Test that recipient address received btc
  await client.createwallet({ wallet_name: 'recipient_wallet' });
  await client.importaddress({ address: recipientAddress, rescan: true }, 'recipient_wallet');
  const getBalanceResult: number = await client.getbalance(
    { include_watchonly: true },
    'recipient_wallet'
  );
  expect(getBalanceResult).toBe(btcToSend);
});
