import { RPCClient } from 'rpc-bitcoin';
import * as btc from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { mapSeriesAsync, parsePort } from './helpers';
import * as coinselect from 'coinselect';
import { ECPair, ECPairInterface, validateSigFunction } from './ec-helpers';
import { BtcFaucetConfigError } from './errors';
import { logger } from './logger';
import { time } from '@hirosystems/api-toolkit';

function getFaucetPk(): string {
  const { BTC_FAUCET_PK } = process.env;
  if (!BTC_FAUCET_PK) {
    throw new Error('BTC Faucet not fully configured.');
  }
  return BTC_FAUCET_PK;
}

export function getFaucetAccount(network: btc.Network): { key: ECPairInterface; address: string } {
  const pkBuffer = Buffer.from(getFaucetPk(), 'hex');
  const key = ECPair.fromPrivateKey(pkBuffer, { network: network });
  return { key, address: getKeyAddress(key) };
}

export function getKeyAddress(key: ECPairInterface): string {
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
    throw new BtcFaucetConfigError('BTC Faucet is not configured.');
  }
  const client = new RPCClient({
    url: BTC_RPC_HOST,
    port: parsePort(BTC_RPC_PORT),
    user: BTC_RPC_USER,
    pass: BTC_RPC_PW,
    timeout: 120000,
  });
  return client;
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
const REGTEST_FEE_RATE = 50;

const MIN_TX_CONFIRMATIONS = 1;

export function isValidBtcAddress(network: btc.Network, address: string): boolean {
  try {
    btc.initEccLib(ecc);
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
  const txOutSet = await getTxOutSet(client, address);
  return txOutSet.total_amount;
}

async function getTxOutSet(client: RPCClient, address: string): Promise<TxOutSet> {
  const txOutSet: TxOutSet = await time(
    () => client.scantxoutset({ action: 'start', scanobjects: [`addr(${address})`] }),
    ms => logger.debug(`scantxoutset for ${address} took ${ms} ms`)
  );
  if (!txOutSet.success) {
    logger.error('scantxoutset did not immediately complete -- polling for progress...');
    let scanProgress = true;
    do {
      scanProgress = await client.scantxoutset({
        action: 'status',
        scanobjects: [`addr(${address})`],
      });
    } while (scanProgress);
    return getTxOutSet(client, address);
  }
  return txOutSet;
}

interface GetRawTxResult {
  txid: string;
  hex: string;
  vin: {
    txid: string;
    vout: number;
    scriptSig: {
      hex: string;
    };
  }[];
  vout: {
    n: number;
    value: number;
    scriptPubKey: {
      addresses: string[];
      hex: string;
      type: string; // 'pubkeyhash'
    };
  }[];
}

async function getRawTransactions(client: RPCClient, txIds: string[]): Promise<GetRawTxResult[]> {
  const batchRawTxRes: GetRawTxResult[] = await time(
    async () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return await mapSeriesAsync(txIds, async txId =>
        client.getrawtransaction({ txid: txId, verbose: true })
      );
    },
    ms => logger.debug(`batch getrawtransaction for ${txIds.length} txs took ${ms} ms`)
  );
  return batchRawTxRes;
}

async function getSpendableUtxos(client: RPCClient, address: string): Promise<TxOutUnspent[]> {
  const txOutSet = await getTxOutSet(client, address);
  const mempoolTxIds: string[] = await time(
    () => client.getrawmempool(),
    ms => logger.debug(`getrawmempool took ${ms} ms`)
  );
  const rawTxs = await getRawTransactions(client, mempoolTxIds);
  const spentUtxos = rawTxs.map(tx => tx.vin).flat();
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
): Promise<{ txId: string; rawTx: string; txFee: number }> {
  if (!isValidBtcAddress(network, address)) {
    throw new Error(`Invalid BTC regtest address: ${address}`);
  }

  const client = getRpcClient();
  const faucetWallet = getFaucetAccount(network);

  const faucetAmountSats = Math.round(faucetAmount * 1e8);

  const spendableUtxos = await getSpendableUtxos(client, faucetWallet.address);
  const totalSpendableAmount = spendableUtxos.reduce((amount, utxo) => amount + utxo.amount, 0);
  if (totalSpendableAmount < faucetAmount) {
    throw new Error(`not enough total amount in utxo set: ${totalSpendableAmount}`);
  }

  const candidateInputs = spendableUtxos.map(utxo => {
    return {
      script: Buffer.from(utxo.scriptPubKey, 'hex'),
      value: Math.round(utxo.amount * 1e8),
      txId: utxo.txid,
      vout: utxo.vout,
    };
  });

  const coinSelectResult = coinselect(
    candidateInputs,
    [{ address: address, value: faucetAmountSats }],
    REGTEST_FEE_RATE
  );

  const psbt = new btc.Psbt({ network: network });

  for (const input of coinSelectResult.inputs) {
    const rawTx: string = await client.getrawtransaction({ txid: input.txId });
    psbt.addInput({
      hash: input.txId,
      index: input.vout,
      nonWitnessUtxo: Buffer.from(rawTx, 'hex'),
    });
  }

  coinSelectResult.outputs.forEach(output => {
    if (!output.address) {
      // output change address
      output.address = faucetWallet.address;
    }
    psbt.addOutput({ address: output.address, value: output.value });
  });

  psbt.signAllInputs(faucetWallet.key);
  if (!psbt.validateSignaturesOfAllInputs(validateSigFunction)) {
    throw new Error('invalid psbt signature');
  }
  psbt.finalizeAllInputs();

  const tx = psbt.extractTransaction();
  const txHex = tx.toHex();
  const txId = tx.getId();
  const sendTxResult: string = await time(
    () => client.sendrawtransaction({ hexstring: txHex }),
    ms => logger.debug(`sendrawtransaction took ${ms}`)
  );

  if (sendTxResult !== txId) {
    throw new Error('Calculated txid does not match txid returned from RPC');
  }

  const feeAmount = coinSelectResult.fee / 1e8;

  return { txId: sendTxResult, rawTx: txHex, txFee: feeAmount };
}
