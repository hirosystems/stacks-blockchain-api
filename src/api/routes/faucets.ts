import * as process from 'process';
import * as express from 'express';
import { asyncHandler } from '../async-handler';
import * as btc from 'bitcoinjs-lib';
import PQueue from 'p-queue';
import { BigNumber } from 'bignumber.js';
import {
  AnchorMode,
  makeSTXTokenTransfer,
  SignedTokenTransferOptions,
  StacksTransaction,
} from '@stacks/transactions';
import { StacksNetwork, StacksTestnet } from '@stacks/network';
import { makeBtcFaucetPayment, getBtcBalance } from '../../btc-faucet';
import { DbFaucetRequestCurrency } from '../../datastore/common';
import { intMax, logger, stxToMicroStx } from '../../helpers';
import { testnetKeys, getStacksTestnetNetwork } from './debug';
import { StacksCoreRpcClient } from '../../core-rpc/client';
import { RunFaucetResponse } from '@stacks/stacks-blockchain-api-types';
import { PgWriteStore } from '../../datastore/pg-write-store';

export function getStxFaucetNetworks(): StacksNetwork[] {
  const networks: StacksNetwork[] = [getStacksTestnetNetwork()];
  const faucetNodeHostOverride: string | undefined = process.env.STACKS_FAUCET_NODE_HOST;
  if (faucetNodeHostOverride) {
    const faucetNodePortOverride: string | undefined = process.env.STACKS_FAUCET_NODE_PORT;
    if (!faucetNodePortOverride) {
      const error = 'STACKS_FAUCET_NODE_HOST is specified but STACKS_FAUCET_NODE_PORT is missing';
      logger.error(error);
      throw new Error(error);
    }
    const network = new StacksTestnet({
      url: `http://${faucetNodeHostOverride}:${faucetNodePortOverride}`,
    });
    networks.push(network);
  }
  return networks;
}

enum TxSendResultStatus {
  Success,
  ConflictingNonce,
  Error,
}

interface TxSendResultSuccess {
  status: TxSendResultStatus.Success;
  txId: string;
}

interface TxSendResultConflictingNonce {
  status: TxSendResultStatus.ConflictingNonce;
  error: Error;
}

interface TxSendResultError {
  status: TxSendResultStatus.Error;
  error: Error;
}

type TxSendResult = TxSendResultSuccess | TxSendResultConflictingNonce | TxSendResultError;

function clientFromNetwork(network: StacksNetwork): StacksCoreRpcClient {
  const coreUrl = new URL(network.coreApiUrl);
  return new StacksCoreRpcClient({ host: coreUrl.hostname, port: coreUrl.port });
}

export function createFaucetRouter(db: PgWriteStore): express.Router {
  const router = express.Router();
  router.use(express.urlencoded({ extended: true }));
  router.use(express.json());

  const btcFaucetRequestQueue = new PQueue({ concurrency: 1 });

  router.post(
    '/btc',
    asyncHandler(async (req, res) => {
      await btcFaucetRequestQueue.add(async () => {
        const address: string = req.query.address || req.body.address;
        const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;

        // Guard condition: requests are limited to 5 times per 5 minutes.
        // Only based on address for now, but we're keeping the IP in case
        // we want to escalate and implement a per IP policy
        const lastRequests = await db.getBTCFaucetRequests(address);
        const now = Date.now();
        const window = 5 * 60 * 1000; // 5 minutes
        const requestsInWindow = lastRequests.results
          .map(r => now - r.occurred_at)
          .filter(r => r <= window);
        if (requestsInWindow.length >= 5) {
          logger.warn(`BTC faucet rate limit hit for address ${address}`);
          res.status(429).json({
            error: 'Too many requests',
            success: false,
          });
          return;
        }

        const tx = await makeBtcFaucetPayment(btc.networks.regtest, address, 0.5);
        await db.insertFaucetRequest({
          ip: `${ip}`,
          address: address,
          currency: DbFaucetRequestCurrency.BTC,
          occurred_at: now,
        });

        res.json({
          txid: tx.txId,
          raw_tx: tx.rawTx,
          success: true,
        });
      });
    })
  );

  router.get(
    '/btc/:address',
    asyncHandler(async (req, res) => {
      const { address } = req.params;
      const balance = await getBtcBalance(btc.networks.regtest, address);
      res.json({ balance });
    })
  );

  const stxFaucetRequestQueue = new PQueue({ concurrency: 1 });

  const FAUCET_DEFAULT_STX_AMOUNT = stxToMicroStx(500);
  const FAUCET_DEFAULT_WINDOW = 5 * 60 * 1000; // 5 minutes
  const FAUCET_DEFAULT_TRIGGER_COUNT = 5;

  const FAUCET_STACKING_WINDOW = 2 * 24 * 60 * 60 * 1000; // 2 days
  const FAUCET_STACKING_TRIGGER_COUNT = 1;

  router.post(
    '/stx',
    asyncHandler(async (req, res) => {
      await stxFaucetRequestQueue.add(async () => {
        const address: string = req.query.address || req.body.address;
        const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        const lastRequests = await db.getSTXFaucetRequests(address);

        const privateKey = process.env.FAUCET_PRIVATE_KEY || testnetKeys[0].secretKey;

        const isStackingReq =
          req.query['stacking'] === 'true' || [true, 'true'].includes(req.body['stacking']);

        // Guard condition: requests are limited to x times per y minutes.
        // Only based on address for now, but we're keeping the IP in case
        // we want to escalate and implement a per IP policy
        const now = Date.now();
        const [window, triggerCount] = isStackingReq
          ? [FAUCET_STACKING_WINDOW, FAUCET_STACKING_TRIGGER_COUNT]
          : [FAUCET_DEFAULT_WINDOW, FAUCET_DEFAULT_TRIGGER_COUNT];

        const requestsInWindow = lastRequests.results
          .map(r => now - r.occurred_at)
          .filter(r => r <= window);
        if (requestsInWindow.length >= triggerCount) {
          logger.warn(`STX faucet rate limit hit for address ${address}`);
          res.status(429).json({
            error: 'Too many requests',
            success: false,
          });
          return;
        }

        const networks = getStxFaucetNetworks();

        const stxAmounts: bigint[] = [];
        for (const network of networks) {
          try {
            let stxAmount = FAUCET_DEFAULT_STX_AMOUNT;
            if (isStackingReq) {
              const poxInfo = await clientFromNetwork(network).getPox();
              stxAmount = BigInt(poxInfo.min_amount_ustx);
              const padPercent = new BigNumber(0.2);
              const padAmount = new BigNumber(stxAmount.toString())
                .times(padPercent)
                .integerValue()
                .toString();
              stxAmount = stxAmount + BigInt(padAmount);
            }
            stxAmounts.push(stxAmount);
          } catch (error) {
            // ignore
          }
        }
        const stxAmount = intMax(stxAmounts);

        const generateTx = async (
          network: StacksNetwork,
          nonce?: bigint,
          fee?: bigint
        ): Promise<StacksTransaction> => {
          const txOpts: SignedTokenTransferOptions = {
            recipient: address,
            amount: stxAmount,
            senderKey: privateKey,
            network: network,
            memo: 'Faucet',
            anchorMode: AnchorMode.Any,
          };
          if (fee !== undefined) {
            txOpts.fee = fee;
          }
          if (nonce !== undefined) {
            txOpts.nonce = nonce;
          }
          try {
            return await makeSTXTokenTransfer(txOpts);
          } catch (error: any) {
            if (fee === undefined && (error as Error).message?.includes('NoEstimateAvailable')) {
              const defaultFee = 200n;
              return await generateTx(network, nonce, defaultFee);
            }
            throw error;
          }
        };

        const nonces: bigint[] = [];
        const fees: bigint[] = [];
        let txGenFetchError: Error | undefined;
        for (const network of networks) {
          try {
            const tx = await generateTx(network);
            nonces.push(tx.auth.spendingCondition?.nonce ?? BigInt(0));
            fees.push(tx.auth.spendingCondition.fee);
          } catch (error: any) {
            txGenFetchError = error;
          }
        }
        if (nonces.length === 0) {
          throw txGenFetchError;
        }
        let nextNonce = intMax(nonces);
        const fee = intMax(fees);

        const sendTxResults: TxSendResult[] = [];
        let retrySend = false;
        let sendSuccess: { txId: string; txRaw: string } | undefined;
        let lastSendError: Error | undefined;
        do {
          const tx = await generateTx(networks[0], nextNonce, fee);
          const rawTx = Buffer.from(tx.serialize());
          for (const network of networks) {
            const rpcClient = clientFromNetwork(network);
            try {
              const res = await rpcClient.sendTransaction(rawTx);
              sendSuccess = { txId: res.txId, txRaw: rawTx.toString('hex') };
              sendTxResults.push({
                status: TxSendResultStatus.Success,
                txId: res.txId,
              });
            } catch (error: any) {
              lastSendError = error;
              if (error.message?.includes('ConflictingNonceInMempool')) {
                sendTxResults.push({
                  status: TxSendResultStatus.ConflictingNonce,
                  error,
                });
              } else {
                sendTxResults.push({
                  status: TxSendResultStatus.Error,
                  error,
                });
              }
            }
          }
          if (sendTxResults.every(res => res.status === TxSendResultStatus.Success)) {
            retrySend = false;
          } else if (
            sendTxResults.every(res => res.status === TxSendResultStatus.ConflictingNonce)
          ) {
            retrySend = true;
            sendTxResults.length = 0;
            nextNonce = nextNonce + 1n;
          } else {
            retrySend = false;
          }
        } while (retrySend);

        if (!sendSuccess) {
          if (lastSendError) {
            throw lastSendError;
          } else {
            throw new Error(`Unexpected failure to send or capture error`);
          }
        } else {
          const response: RunFaucetResponse = {
            success: true,
            txId: sendSuccess.txId,
            txRaw: sendSuccess.txRaw,
          };
          res.json(response);
        }

        await db.insertFaucetRequest({
          ip: `${ip}`,
          address: address,
          currency: DbFaucetRequestCurrency.STX,
          occurred_at: now,
        });
      });
    })
  );

  return router;
}
