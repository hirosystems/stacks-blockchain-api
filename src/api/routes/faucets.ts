import * as process from 'process';
import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import * as btc from 'bitcoinjs-lib';
import PQueue from 'p-queue';
import * as BN from 'bn.js';
import { BigNumber } from 'bignumber.js';
import {
  makeSTXTokenTransfer,
  SignedTokenTransferOptions,
  StacksNetwork,
} from '@blockstack/stacks-transactions';
import { makeBtcFaucetPayment, getBtcBalance } from '../../btc-faucet';
import { DataStore, DbFaucetRequestCurrency } from '../../datastore/common';
import { assertNotNullish as unwrap, logger, stxToMicroStx } from '../../helpers';
import { testnetKeys, GetStacksTestnetNetwork } from './debug';
import { StacksCoreRpcClient } from '../../core-rpc/client';

export function getStxFaucetNetwork(): StacksNetwork {
  const network = GetStacksTestnetNetwork();
  const faucetNodeHostOverride: string | undefined = process.env.STACKS_FAUCET_NODE_HOST;
  if (faucetNodeHostOverride) {
    const faucetNodePortOverride: string | undefined = process.env.STACKS_FAUCET_NODE_PORT;
    if (!faucetNodePortOverride) {
      const error = 'STACKS_FAUCET_NODE_HOST is specified but STACKS_FAUCET_NODE_PORT is missing';
      logger.error(error);
      throw new Error(error);
    }
    network.coreApiUrl = `http://${faucetNodeHostOverride}:${faucetNodePortOverride}`;
  }
  return network;
}

export function createFaucetRouter(db: DataStore): RouterWithAsync {
  const router = addAsync(express.Router());
  router.use(express.urlencoded({ extended: true }));
  router.use(express.json());

  const btcFaucetRequestQueue = new PQueue({ concurrency: 1 });

  router.postAsync('/btc', async (req, res) => {
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
  });

  router.getAsync('/btc/:address', async (req, res) => {
    const { address } = req.params;
    const balance = await getBtcBalance(btc.networks.regtest, address);
    res.json({ balance });
  });

  const stxFaucetRequestQueue = new PQueue({ concurrency: 1 });

  const FAUCET_DEFAULT_STX_AMOUNT = stxToMicroStx(500);
  const FAUCET_DEFAULT_WINDOW = 5 * 60 * 1000; // 5 minutes
  const FAUCET_DEFAULT_TRIGGER_COUNT = 5;

  const FAUCET_STACKING_WINDOW = 2 * 24 * 60 * 60 * 1000; // 2 days
  const FAUCET_STACKING_TRIGGER_COUNT = 1;

  const MAX_NONCE_INCREMENT_RETRIES = 5;

  router.postAsync('/stx', async (req, res) => {
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

      const network = getStxFaucetNetwork();
      const coreUrl = new URL(network.coreApiUrl);
      const rpcClient = new StacksCoreRpcClient({ host: coreUrl.hostname, port: coreUrl.port });

      let stxAmount = FAUCET_DEFAULT_STX_AMOUNT;
      if (isStackingReq) {
        const poxInfo = await rpcClient.getPox();
        stxAmount = BigInt(poxInfo.min_amount_ustx);
        const padPercent = new BigNumber(0.2);
        const padAmount = new BigNumber(stxAmount.toString())
          .times(padPercent)
          .integerValue()
          .toString();
        stxAmount = stxAmount + BigInt(padAmount);
      }

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

      let nextNonce: BN | undefined = undefined;
      let sendError: Error | undefined = undefined;
      let sendSuccess = false;
      for (let i = 0; i < MAX_NONCE_INCREMENT_RETRIES; i++) {
        const txOpts: SignedTokenTransferOptions = {
          recipient: address,
          amount: new BN(stxAmount.toString()),
          senderKey: privateKey,
          network: network,
          memo: 'Faucet',
        };
        if (nextNonce !== undefined) {
          txOpts.nonce = nextNonce;
        }
        const tx = await makeSTXTokenTransfer(txOpts);
        const serializedTx = tx.serialize();
        try {
          const txSendResult = await rpcClient.sendTransaction(serializedTx);
          res.json({
            success: true,
            txId: txSendResult.txId,
            txRaw: tx.serialize().toString('hex'),
          });
          sendSuccess = true;
          break;
        } catch (error) {
          if (sendError === undefined) {
            sendError = error;
          }
          if (error.message?.includes('ConflictingNonceInMempool')) {
            nextNonce = unwrap(tx.auth.spendingCondition).nonce.add(new BN(1));
          } else if (error.message?.includes('BadNonce')) {
            nextNonce = undefined;
          } else {
            throw error;
          }
        }
      }
      if (!sendSuccess && sendError) {
        throw sendError;
      }
      await db.insertFaucetRequest({
        ip: `${ip}`,
        address: address,
        currency: DbFaucetRequestCurrency.STX,
        occurred_at: now,
      });
    });
  });

  return router;
}
