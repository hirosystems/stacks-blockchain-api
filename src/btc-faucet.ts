import { RPCClient } from 'rpc-bitcoin';
import * as btc from 'bitcoinjs-lib';
import * as BN from 'bn.js';

type UnspentTxInfo = {
  txid: string;
  vout: number;
  address: string;
  acount: string;
  scriptPubKey: string;
  amount: number;
  confirmations: number;
  redeemScript: string;
  spendable: boolean;
  solvable: boolean;
  safe: boolean;
};

export const makeBTCFaucetPayment = async (address: string) => {
  const { BTC_FAUCET_PK, BTC_RPC_PORT, BTC_RPC_HOST, BTC_RPC_PW, BTC_RPC_USER } = process.env;
  if (!BTC_FAUCET_PK || !BTC_RPC_PORT || !BTC_RPC_HOST || !BTC_RPC_PW || !BTC_RPC_USER) {
    throw new Error('BTC Faucet not fully configured.');
  }
  const client = new RPCClient({
    url: BTC_RPC_HOST,
    port: parseInt(BTC_RPC_PORT, 10),
    user: BTC_RPC_USER,
    pass: BTC_RPC_PW,
  });

  const network = btc.networks.regtest;

  const faucetPK = btc.ECPair.fromWIF(BTC_FAUCET_PK, btc.networks.regtest);
  const faucetPayment = btc.payments.p2wpkh({
    pubkey: faucetPK.publicKey,
    network,
  });
  const p2sh = btc.payments.p2sh({ redeem: faucetPayment, network });

  const unspent: UnspentTxInfo[] = await client.listunspent({ minconf: 4 });

  const faucetAmount = new BN(50000000); // 0.5 BTC
  const inputs: UnspentTxInfo[] = [];
  const satsPerBTC = new BN(100000000);
  let inputTotals = new BN(0);
  const btcToSat = (btcVal: number) => {
    const btc = new BN(btcVal);
    const sats = btc.mul(satsPerBTC);
    return sats;
  };
  for (const input of unspent) {
    const sats = btcToSat(input.amount);
    inputTotals = inputTotals.add(sats);
    inputs.push(input);
    if (inputTotals.gt(faucetAmount)) {
      break;
    }
  }

  const tx = new btc.TransactionBuilder(btc.networks.regtest);
  console.log(`Using ${inputs.length} inputs, worth ${inputTotals.toNumber()}`);
  inputs.forEach((input, i) => {
    tx.addInput(input.txid, i);
  });

  const receipientScriptPub = btc.address.toOutputScript(address, btc.networks.regtest);
  tx.addOutput(receipientScriptPub, faucetAmount.toNumber());

  const change = inputTotals.sub(faucetAmount);
  console.log('Change amount:', change.toNumber());
  const faucetScriptPub = btc.address.toOutputScript(
    faucetPayment.address as string,
    btc.networks.regtest
  );
  const fee = new BN(500);
  tx.addOutput(faucetScriptPub, change.sub(fee).toNumber());

  inputs.forEach((input, i) => {
    tx.sign(i, faucetPK, p2sh.redeem?.output, undefined, btcToSat(input.amount).toNumber());
  });

  const builtTX = tx.build();
  console.log(`Faucet TXID: ${builtTX.getId()}`);
  await client.sendrawtransaction({ hexstring: builtTX.toHex() });

  return builtTX;
};
