import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import * as btc from 'bitcoinjs-lib';
import PQueue from 'p-queue';
import { makeBtcFaucetPayment, getBtcBalance } from '../../btc-faucet';
import { DataStore, DbFaucetRequestCurrency } from '../../datastore/common';
import { logger } from '../../helpers';

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

  return router;
}
