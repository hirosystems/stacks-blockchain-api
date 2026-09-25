import PQueue from 'p-queue';
import { BigNumber } from 'bignumber.js';
import {
  ContractIdString,
  getAddressFromPrivateKey,
  makeContractCall,
  makeSTXTokenTransfer,
  noneCV,
  Pc,
  principalCV,
  privateKeyToPublic,
  publicKeyToHex,
  SignedContractCallOptions,
  SignedTokenTransferOptions,
  StacksTransactionWire,
  uintCV,
} from '@stacks/transactions';
import type { StacksNetwork } from '@stacks/network';
import { createCoreRpcClient, type CoreRpcClient } from '@stacks/rpc-client';
import { logger } from '@stacks/api-toolkit';
import { getStxFaucetNetwork, stxToMicroStx } from '../../helpers.js';
import { ENV } from '../../env.js';
import type { PgStore } from '../../datastore/pg-store.js';
import { getTxRejectionReason } from './errors.js';

const testnetAccounts = [
  {
    secretKey: 'cb3df38053d132895220b9ce471f6b676db5b9bf0b4adefb55f2118ece2478df01',
    stacksAddress: 'STB44HYPYAT2BB2QE513NSP81HTMYWBJP02HPGK6',
  },
  {
    secretKey: '21d43d2ae0da1d9d04cfcaac7d397a33733881081f0b2cd038062cf0ccbb752601',
    stacksAddress: 'ST11NJTTKGVT6D1HY4NJRVQWMQM7TVAR091EJ8P2Y',
  },
  {
    secretKey: 'c71700b07d520a8c9731e4d0f095aa6efb91e16e25fb27ce2b72e7b698f8127a01',
    stacksAddress: 'ST1HB1T8WRNBYB0Y3T7WXZS38NKKPTBR3EG9EPJKR',
  },
  {
    secretKey: 'e75dcb66f84287eaf347955e94fa04337298dbd95aa0dbb985771104ef1913db01',
    stacksAddress: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP',
  },
  {
    secretKey: 'ce109fee08860bb16337c76647dcbc02df0c06b455dd69bcf30af74d4eedd19301',
    stacksAddress: 'STF9B75ADQAVXQHNEQ6KGHXTG7JP305J2GRWF3A2',
  },
  {
    secretKey: '08c14a1eada0dd42b667b40f59f7c8dedb12113613448dc04980aea20b268ddb01',
    stacksAddress: 'ST18MDW2PDTBSCR1ACXYRJP2JX70FWNM6YY2VX4SS',
  },
];

interface SeededAccount {
  secretKey: string;
  stacksAddress: string;
  pubKey: string;
}

export const FAUCET_TESTNET_KEYS: SeededAccount[] = testnetAccounts.map(t => ({
  secretKey: t.secretKey,
  stacksAddress: t.stacksAddress,
  pubKey: publicKeyToHex(privateKeyToPublic(t.secretKey)),
}));

/**
 * The private keys the STX and sBTC faucets send from. Read per request rather than captured at
 * module load so `FAUCET_PRIVATE_KEY` can be set after import (as the tests do).
 */
export function getStxFaucetKeys(): string[] {
  return (ENV.FAUCET_PRIVATE_KEY ?? FAUCET_TESTNET_KEYS[0].secretKey).split(',');
}

export function clientFromNetwork(network: StacksNetwork): CoreRpcClient {
  return createCoreRpcClient({ baseUrl: network.client.baseUrl });
}

/**
 * Serialization queues, shared by every API version's faucet routes. The STX and sBTC faucets
 * derive a sender nonce per request, so two concurrent requests against the same faucet account
 * would build conflicting transactions -- these must stay process-wide singletons rather than
 * per-plugin instances, now that v1 and v3 both expose the faucets.
 */
export const btcFaucetRequestQueue = new PQueue({ concurrency: 1 });
export const stxFaucetRequestQueue = new PQueue({ concurrency: 1 });
export const sbtcFaucetRequestQueue = new PQueue({ concurrency: 1 });

export const FAUCET_DEFAULT_STX_AMOUNT = stxToMicroStx(500);
export const FAUCET_DEFAULT_WINDOW = 5 * 60 * 1000; // 5 minutes
export const FAUCET_DEFAULT_TRIGGER_COUNT = 5;

export const FAUCET_STACKING_WINDOW = 2 * 24 * 60 * 60 * 1000; // 2 days
export const FAUCET_STACKING_TRIGGER_COUNT = 1;

/**
 * v1 BTC faucet payout sizes, in BTC, selected by the `large`/`xlarge` query params. v3 sends a
 * single amount configured by `TESTNET_BTC_FAUCET_AMOUNT` instead.
 */
export const FAUCET_BTC_AMOUNT = 0.0001;
export const FAUCET_BTC_LARGE_AMOUNT = 0.01;
export const FAUCET_BTC_XLARGE_AMOUNT = 0.5;

/**
 * Resolves the client IP for faucet rate limiting, preferring the left-most `x-forwarded-for`
 * entry when the request came through a proxy.
 */
export function getRequestIp(
  forwardedFor: string | string[] | undefined,
  fallback: string
): string {
  return (
    (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor?.split(',')[0])?.trim() ??
    fallback
  );
}

/**
 * Whether `occurredAt` timestamps show at least `triggerCount` requests within `window` of `now`.
 */
export function isRateLimited(
  occurredAt: number[],
  now: number,
  window: number,
  triggerCount: number
): boolean {
  const requestsInWindow = occurredAt.map(t => now - t).filter(age => age <= window);
  return requestsInWindow.length >= triggerCount;
}

export async function calculateSTXFaucetAmount(
  network: StacksNetwork,
  stacking: boolean
): Promise<bigint> {
  if (stacking) {
    try {
      const poxInfo = await clientFromNetwork(network).request('GET', '/v2/pox');
      if (poxInfo.min_amount_ustx === undefined) {
        return FAUCET_DEFAULT_STX_AMOUNT;
      }
      let stxAmount = BigInt(poxInfo.min_amount_ustx);
      const padPercent = new BigNumber(0.2);
      const padAmount = new BigNumber(stxAmount.toString())
        .times(padPercent)
        .integerValue()
        .toString();
      stxAmount = stxAmount + BigInt(padAmount);
      return stxAmount;
    } catch (_error) {
      // ignore
    }
  }
  return FAUCET_DEFAULT_STX_AMOUNT;
}

export async function fetchNetworkChainID(network: StacksNetwork): Promise<number> {
  const rpcClient = clientFromNetwork(network);
  const info = await rpcClient.request('GET', '/v2/info');
  return info.network_id;
}

export async function buildSTXFaucetTx(
  recipient: string,
  amount: bigint,
  network: StacksNetwork,
  senderKey: string,
  nonce: bigint,
  fee?: bigint
): Promise<StacksTransactionWire> {
  try {
    const options: SignedTokenTransferOptions = {
      recipient,
      amount,
      senderKey,
      network,
      memo: 'faucet',
      nonce,
    };
    if (fee) options.fee = fee;

    // Detect possible custom network chain ID
    network.chainId = await fetchNetworkChainID(network);

    return await makeSTXTokenTransfer(options);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    if (
      fee === undefined &&
      (error as Error).message &&
      /estimating transaction fee|NoEstimateAvailable/.test(error.message)
    ) {
      return await buildSTXFaucetTx(recipient, amount, network, senderKey, nonce, 200n);
    }
    throw error;
  }
}

export async function buildSBTCFaucetTx(
  recipient: string,
  amount: bigint,
  network: StacksNetwork,
  senderKey: string,
  nonce: bigint,
  fee?: bigint
): Promise<StacksTransactionWire> {
  const [contractId, assetName] = ENV.TESTNET_SBTC_FAUCET_ASSET_IDENTIFIER.split('::') as [
    ContractIdString,
    string,
  ];
  const [contractAddress, contractName] = contractId.split('.');
  const senderAddress = getAddressFromPrivateKey(senderKey, 'testnet');
  try {
    const options: SignedContractCallOptions = {
      contractAddress,
      contractName,
      functionName: 'transfer',
      functionArgs: [uintCV(amount), principalCV(senderAddress), principalCV(recipient), noneCV()],
      senderKey,
      network,
      nonce,
      postConditions: [Pc.principal(senderAddress).willSendEq(amount).ft(contractId, assetName)],
    };
    if (fee) options.fee = fee;

    // Detect possible custom network chain ID
    network.chainId = await fetchNetworkChainID(network);

    return await makeContractCall(options);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } catch (error: any) {
    if (
      fee === undefined &&
      (error as Error).message &&
      /estimating transaction fee|NoEstimateAvailable/.test(error.message)
    ) {
      return await buildSBTCFaucetTx(recipient, amount, network, senderKey, nonce, 1000n);
    }
    throw error;
  }
}

/** A faucet transaction that was successfully built and broadcast to the Stacks node. */
export interface SentFaucetTx {
  /** `0x`-prefixed transaction id. */
  txId: string;
  /** Serialized transaction hex, as broadcast. */
  rawTx: string;
  /** The amount sent, in the asset's base units. */
  amount: bigint;
}

/**
 * Builds and broadcasts an STX faucet transfer, rotating through the configured faucet keys when
 * the node rejects a transaction for a reason another sender could resolve (a nonce conflict, too
 * much chaining, or that particular account being out of funds). Throws once every key has been
 * tried, or immediately on any other failure.
 */
export async function sendStxFaucetTx(opts: {
  db: PgStore;
  recipientAddress: string;
  /** Amount to send, in µSTX. */
  amount: bigint;
}): Promise<SentFaucetTx> {
  const { db, recipientAddress, amount: stxAmount } = opts;
  const keys = getStxFaucetKeys();
  const network = getStxFaucetNetwork();
  const rpcClient = clientFromNetwork(network);

  // Start with a random key index. We will try others in order if this one fails.
  let keyIndex = Math.round(Math.random() * (keys.length - 1));
  let keysAttempted = 0;
  let sendSuccess: { txId: string; txRaw: string } | undefined;
  do {
    keysAttempted++;
    const senderKey = keys[keyIndex];
    const senderAddress = getAddressFromPrivateKey(senderKey, 'testnet');
    logger.debug(`StxFaucet attempting faucet transaction from sender: ${senderAddress}`);
    const nonces = await db.getAddressNonces({ stxAddress: senderAddress });
    const tx = await buildSTXFaucetTx(
      recipientAddress,
      stxAmount,
      network,
      senderKey,
      BigInt(nonces.possibleNextNonce)
    );
    const rawTxHex = tx.serialize();
    try {
      const txId = await rpcClient.request('POST', '/v2/transactions', {
        body: { tx: rawTxHex },
      });
      sendSuccess = { txId: `0x${txId}`, txRaw: rawTxHex };
      logger.info(
        `StxFaucet success. Sent ${stxAmount} uSTX from ${senderAddress} to ${recipientAddress} (txId: ${sendSuccess.txId}).`
      );
    } catch (error) {
      const rejectionReason = getTxRejectionReason(error);
      if (
        rejectionReason === 'ConflictingNonceInMempool' ||
        rejectionReason === 'TooMuchChaining' ||
        rejectionReason === 'NotEnoughFunds'
      ) {
        if (keysAttempted == keys.length) {
          logger.warn(`StxFaucet attempts exhausted for all faucet keys. Last error: ${error}`);
          throw error;
        }
        // Try with the next key. Wrap around the keys array if necessary.
        keyIndex++;
        if (keyIndex >= keys.length) keyIndex = 0;
        logger.warn(
          `StxFaucet transaction failed for sender ${senderAddress}, trying with next key: ${error}`
        );
      } else {
        logger.warn(`StxFaucet unexpected error when sending transaction: ${error}`);
        throw error;
      }
    }
  } while (!sendSuccess);

  return { txId: sendSuccess.txId, rawTx: sendSuccess.txRaw, amount: stxAmount };
}

/**
 * Builds and broadcasts an sBTC faucet SIP-010 `transfer` contract call. Unlike the STX faucet,
 * this always sends from the first configured key.
 */
export async function sendSbtcFaucetTx(opts: {
  db: PgStore;
  recipientAddress: string;
}): Promise<SentFaucetTx> {
  const { db, recipientAddress } = opts;
  const senderKey = getStxFaucetKeys()[0];
  const senderAddress = getAddressFromPrivateKey(senderKey, 'testnet');
  const sbtcAmount = BigInt(ENV.TESTNET_SBTC_FAUCET_AMOUNT);
  const network = getStxFaucetNetwork();
  const rpcClient = clientFromNetwork(network);

  logger.debug(`SbtcFaucet attempting faucet transaction from sender: ${senderAddress}`);
  const nonces = await db.getAddressNonces({ stxAddress: senderAddress });
  const tx = await buildSBTCFaucetTx(
    recipientAddress,
    sbtcAmount,
    network,
    senderKey,
    BigInt(nonces.possibleNextNonce)
  );
  const rawTxHex = tx.serialize();
  const txId = await rpcClient.request('POST', '/v2/transactions', {
    body: { tx: rawTxHex },
  });
  logger.info(
    `SbtcFaucet success. Sent ${sbtcAmount} sBTC sats from ${senderAddress} to ${recipientAddress} (txId: 0x${txId}).`
  );
  return { txId: `0x${txId}`, rawTx: rawTxHex, amount: sbtcAmount };
}
