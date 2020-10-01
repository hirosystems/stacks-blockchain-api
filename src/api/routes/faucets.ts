import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import * as btc from 'bitcoinjs-lib';
import PQueue from 'p-queue';
import * as BN from 'bn.js';
import { makeSTXTokenTransfer } from '@blockstack/stacks-transactions';
import { makeBtcFaucetPayment, getBtcBalance } from '../../btc-faucet';
import { DataStore, DbFaucetRequestCurrency } from '../../datastore/common';
import { logger } from '../../helpers';
import { testnetKeys, GetStacksTestnetNetwork } from './debug';
import { StacksCoreRpcClient } from '../../core-rpc/client';

export function createFaucetRouter(db: DataStore): RouterWithAsync {
  const router = addAsync(express.Router());
  router.use(express.urlencoded({ extended: true }));

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

  router.postAsync('/stx', async (req, res) => {
    await stxFaucetRequestQueue.add(async () => {
      const address: string = req.query.address || req.body.address;
      const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
      const lastRequests = await db.getSTXFaucetRequests(address);

      const privateKey = process.env.FAUCET_PRIVATE_KEY || testnetKeys[0].secretKey;

      // Guard condition: requests are limited to 5 times per 5 minutes.
      // Only based on address for now, but we're keeping the IP in case
      // we want to escalate and implement a per IP policy
      const now = Date.now();
      const window = 60 * 60 * 1000; // 60 minutes
      const requestsInWindow = lastRequests.results
        .map(r => now - r.occurred_at)
        .filter(r => r <= window);
      if (requestsInWindow.length >= 5) {
        logger.warn(`STX faucet rate limit hit for address ${address}`);
        res.status(429).json({
          error: 'Too many requests',
          success: false,
        });
        return;
      }

      const stxAmount = 3_000_000_000_000; // Minimum required for stacking
      const tx = await makeSTXTokenTransfer({
        recipient: address,
        amount: new BN(stxAmount),
        senderKey: privateKey,
        network: GetStacksTestnetNetwork(),
        memo: 'Faucet',
      });

      await db.insertFaucetRequest({
        ip: `${ip}`,
        address: address,
        currency: DbFaucetRequestCurrency.STX,
        occurred_at: now,
      });

      const hex = tx.serialize().toString('hex');
      const serializedTx = tx.serialize();
      const { txId } = await new StacksCoreRpcClient().sendTransaction(serializedTx);

      res.json({
        success: true,
        txId,
        txRaw: hex,
      });
    });
  });

  return router;
}
