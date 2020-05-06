import { RPCClient } from 'rpc-bitcoin';
import * as btc from 'bitcoinjs-lib';
import { parsePort } from './helpers';
// eslint-disable-next-line @typescript-eslint/ban-ts-ignore
// @ts-ignore
import * as coinSelect from 'coinselect';

export function getFaucetPk(): string {
  const { BTC_FAUCET_PK } = process.env;
  if (!BTC_FAUCET_PK) {
    throw new Error('BTC Faucet not fully configured.');
  }
  return BTC_FAUCET_PK;
}

export function getFaucetWallet(
  network: btc.Network
): { key: btc.ECPairInterface; wif: string; address: string } {
  const wif = getFaucetPk();
  const key = btc.ECPair.fromWIF(wif, network);
  const addr = getKeyAddress(key);
  return {
    key: key,
    wif: wif,
    address: addr,
  };
}

export function getKeyAddress(key: btc.ECPairInterface): string {
  const { address } = btc.payments.p2pkh({
    pubkey: key.publicKey,
    network: key.network,
  });
  if (!address) {
    throw new Error('address generation failed');
  }
  return address;
}

export function getRpcClient(): RPCClient {
  const { BTC_RPC_PORT, BTC_RPC_HOST, BTC_RPC_PW, BTC_RPC_USER } = process.env;
  if (!BTC_RPC_PORT || !BTC_RPC_HOST || !BTC_RPC_PW || !BTC_RPC_USER) {
    throw new Error('BTC Faucet not fully configured.');
  }
  const client = new RPCClient({
    url: BTC_RPC_HOST,
    port: parsePort(BTC_RPC_PORT),
    user: BTC_RPC_USER,
    pass: BTC_RPC_PW,
  });
  return client;
}

interface TxOutSetUnspent {
  amount: number;
  desc: string;
  height: number;
  scriptPubKey: string;
  txid: string;
  vout: number;
}

interface TxOutSet {
  bestblock: string;
  height: number;
  success: boolean;
  total_amount: number;
  txouts: number;
  unspents: TxOutSetUnspent[];
}

interface PsbtInput {
  txId: string;
  txRaw: Buffer;
  value: number;
  script: Buffer;
  vout: number;
}

interface PsbtOutput {
  address: string;
  value: number;
}

function performCoinSelect(
  inputs: PsbtInput[],
  outputs: PsbtOutput[],
  feeRate: number
): {
  inputs: PsbtInput[];
  outputs: PsbtOutput[];
} {
  const coinSelectResult = coinSelect(inputs, outputs, feeRate);
  if (!coinSelectResult.inputs || !coinSelectResult.outputs) {
    throw new Error('no utxo coin select solution found');
  }
  return coinSelectResult;
}

// Replace with client.estimatesmartfee() for testnet/mainnet
const REGTEST_FEE_RATE = 2000;

// TODO: this should be wrapped in p-queue so only one is performed at a time
export async function makeBTCFaucetPayment(
  network: btc.Network,
  address: string,
  /** Amount to send in BTC */
  faucetAmount: number
): Promise<{ txId: string }> {
  const client = getRpcClient();
  const faucetWallet = getFaucetWallet(network);

  const faucetAmountSats = faucetAmount * 1e8;

  const txOutSet: TxOutSet = await client.scantxoutset({
    action: 'start',
    scanobjects: [`addr(${faucetWallet.address})`],
  });

  const spendableUtxos = txOutSet.unspents.filter(utxo => txOutSet.height - utxo.height > 100);
  const totalSpendableAmount = spendableUtxos.reduce((prev, utxo) => prev + utxo.amount, 0);
  if (totalSpendableAmount < faucetAmount) {
    throw new Error(`not enough total amount in utxo set: ${totalSpendableAmount}`);
  }

  const minUtxoSet: PsbtInput[] = [];
  let minAmount = 0;
  // Typical btc transaction with 1 input and 2 outputs is around 250 bytes
  const estimatedTotalFee = 500 * REGTEST_FEE_RATE;
  for (const utxo of spendableUtxos) {
    const rawTxHex = await client.getrawtransaction({ txid: utxo.txid });
    const txOut = btc.Transaction.fromHex(rawTxHex).outs[utxo.vout];
    const rawTxBuffer = Buffer.from(rawTxHex, 'hex');
    minUtxoSet.push({
      script: txOut.script,
      value: txOut.value,
      txRaw: rawTxBuffer,
      txId: utxo.txid,
      vout: utxo.vout,
    });
    minAmount += utxo.amount;
    if (minAmount >= faucetAmount + estimatedTotalFee) {
      break;
    }
  }

  const outputTarget: PsbtOutput = { address: address, value: faucetAmountSats };
  const coinSelectResult = performCoinSelect(minUtxoSet, [outputTarget], REGTEST_FEE_RATE);
  const psbt = new btc.Psbt({ network: network });

  coinSelectResult.inputs.forEach(input => {
    psbt.addInput({
      hash: input.txId,
      index: input.vout,
      nonWitnessUtxo: input.txRaw,
    });
  });

  coinSelectResult.outputs.forEach(output => {
    if (!output.address) {
      // output change address
      output.address = faucetWallet.address;
    }
    psbt.addOutput({ address: output.address, value: output.value });
  });

  psbt.signAllInputs(faucetWallet.key);
  if (!psbt.validateSignaturesOfAllInputs()) {
    throw new Error('invalid pbst signature');
  }
  psbt.finalizeAllInputs();

  const tx = psbt.extractTransaction();
  const sendTxResult: string = await client.sendrawtransaction({ hexstring: tx.toHex() });

  return { txId: sendTxResult };
}
