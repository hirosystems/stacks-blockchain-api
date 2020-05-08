import { RPCClient, RPCIniOptions } from 'rpc-bitcoin';
import * as btc from 'bitcoinjs-lib';
import * as Bluebird from 'bluebird';
import { parsePort } from './helpers';
import coinSelect = require('coinselect');

export function getFaucetPk(): string {
  const { BTC_FAUCET_PK } = process.env;
  if (!BTC_FAUCET_PK) {
    throw new Error('BTC Faucet not fully configured.');
  }
  return BTC_FAUCET_PK;
}

export function getFaucetWallet(
  network: btc.Network
): { key: btc.ECPairInterface; address: string } {
  const pkBuffer = Buffer.from(getFaucetPk(), 'hex');
  const key = btc.ECPair.fromPrivateKey(pkBuffer, { network: network });
  return { key, address: getKeyAddress(key) };
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

function getRpcConfig(): RPCIniOptions {
  const { BTC_RPC_PORT, BTC_RPC_HOST, BTC_RPC_PW, BTC_RPC_USER } = process.env;
  if (!BTC_RPC_PORT || !BTC_RPC_HOST || !BTC_RPC_PW || !BTC_RPC_USER) {
    throw new Error('BTC Faucet not fully configured.');
  }
  const params: RPCIniOptions = {
    url: BTC_RPC_HOST,
    port: parsePort(BTC_RPC_PORT),
    user: BTC_RPC_USER,
    pass: BTC_RPC_PW,
  };
  return params;
}

export function getRpcClient(): RPCClient {
  const client = new RPCClient(getRpcConfig());
  return client;
}

export async function isBtcRpcReachable(): Promise<boolean> {
  const client = getRpcClient();
  try {
    await client.getrpcinfo();
    return true;
  } catch (error) {
    const config = getRpcConfig();
    console.error(
      `WARNING: Bitcoin RPC connection failed for configured endpoint ${config.url}:${config.port}`
    );
    console.error(error);
    return false;
  }
}

interface TxOutUnspent {
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
  unspents: TxOutUnspent[];
}

// Replace with client.estimatesmartfee() for testnet/mainnet
const REGTEST_FEE_RATE = 2000;

const MIN_TX_CONFIRMATIONS = 100;

function isValidBtcAddress(network: btc.Network, address: string): boolean {
  try {
    btc.address.toOutputScript(address, network);
    return true;
  } catch (error) {
    return false;
  }
}

export async function getBtcBalance(network: btc.Network, address: string) {
  if (!isValidBtcAddress(network, address)) {
    throw new Error(`Invalid BTC regtest address: ${address}`);
  }
  const client = getRpcClient();

  const txOutSet: TxOutSet = await client.scantxoutset({
    action: 'start',
    scanobjects: [`addr(${address})`],
  });

  const mempoolTxIds: string[] = await client.getrawmempool();
  const mempoolTxs = await Bluebird.mapSeries(mempoolTxIds, txid =>
    client.getrawtransaction({ txid, verbose: true })
  );
  const mempoolBalance = mempoolTxs
    .map(tx => tx.vout)
    .flat()
    .filter(
      vout =>
        btc.address.fromOutputScript(Buffer.from(vout.scriptPubKey.hex, 'hex'), network) === address
    )
    .reduce((amount, vout) => amount + vout.value, 0);

  return txOutSet.total_amount + mempoolBalance;
}

async function getSpendableUtxos(client: RPCClient, address: string): Promise<TxOutUnspent[]> {
  const txOutSet: TxOutSet = await client.scantxoutset({
    action: 'start',
    scanobjects: [`addr(${address})`],
  });
  const mempoolTxIds: string[] = await client.getrawmempool();
  const txs = await Bluebird.mapSeries(mempoolTxIds, txid =>
    client.getrawtransaction({ txid, verbose: true })
  );
  const spentUtxos: { txid: string; vout: number }[] = txs.map(tx => tx.vin).flat();
  const spendableUtxos = txOutSet.unspents.filter(
    utxo =>
      !spentUtxos.find(vin => vin.txid === utxo.txid && vin.vout === utxo.vout) &&
      txOutSet.height - utxo.height > MIN_TX_CONFIRMATIONS
  );
  return spendableUtxos;
}

export async function makeBtcFaucetPayment(
  network: btc.Network,
  address: string,
  /** Amount to send in BTC */
  faucetAmount: number
): Promise<{ txId: string; rawTx: string }> {
  if (!isValidBtcAddress(network, address)) {
    throw new Error(`Invalid BTC regtest address: ${address}`);
  }

  const client = getRpcClient();
  const faucetWallet = getFaucetWallet(network);

  const faucetAmountSats = faucetAmount * 1e8;

  const spendableUtxos = await getSpendableUtxos(client, faucetWallet.address);
  const totalSpendableAmount = spendableUtxos.reduce((amount, utxo) => amount + utxo.amount, 0);
  if (totalSpendableAmount < faucetAmount) {
    throw new Error(`not enough total amount in utxo set: ${totalSpendableAmount}`);
  }

  let minAmount = 0;
  // Typical btc transaction with 1 input and 2 outputs is around 250 bytes
  const estimatedTotalFee = 500 * REGTEST_FEE_RATE;
  const candidateUtxos = spendableUtxos.filter(utxo => {
    minAmount += utxo.amount;
    return minAmount < faucetAmount + estimatedTotalFee;
  });

  const candidateInputs = await Bluebird.mapSeries(candidateUtxos, async utxo => {
    const rawTxHex = await client.getrawtransaction({ txid: utxo.txid });
    const txOut = btc.Transaction.fromHex(rawTxHex).outs[utxo.vout];
    const rawTxBuffer = Buffer.from(rawTxHex, 'hex');
    return {
      script: txOut.script,
      value: txOut.value,
      txRaw: rawTxBuffer,
      txId: utxo.txid,
      vout: utxo.vout,
    };
  });

  const coinSelectResult = coinSelect(
    candidateInputs,
    [{ address: address, value: faucetAmountSats }],
    REGTEST_FEE_RATE
  );

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
  const txHex = tx.toHex();
  const txId = tx.getId();
  const sendTxResult: string = await client.sendrawtransaction({ hexstring: txHex });

  if (sendTxResult !== txId) {
    throw new Error('Calculated txid does not match txid returned from RPC');
  }

  return { txId: sendTxResult, rawTx: txHex };
}
