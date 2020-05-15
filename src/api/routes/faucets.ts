import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import * as btc from 'bitcoinjs-lib';
import PQueue from 'p-queue';
import { makeBtcFaucetPayment, getBtcBalance } from '../../btc-faucet';
import { DataStore, DbFaucetRequestCurrency } from '../../datastore/common';

export function createFaucetRouter(db: DataStore): RouterWithAsync {
  const router = addAsync(express.Router());
  router.use(express.urlencoded({ extended: true }));

  const faucetRequestQueue = new PQueue({ concurrency: 1 });

  router.postAsync('/btc', async (req, res) => {
    const address: string = `${req.query.address}` || `${req.body.address}`;
    const ip = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    const lastRequest = await db.getBTCFaucetRequest(address);

    // Guard condition: 6 hours between now and the last request, if any.
    // Only based on address for now, but we're keeping the IP in case
    // we want to escalate and implement a per IP policy
    const now = new Date().getTime();
    if (lastRequest.found && lastRequest.result.occurred_at) {
      const lastOccurence = new Date().setTime(parseInt(lastRequest.result.occurred_at));
      const timeInterval = now - lastOccurence;
      const sixHours = 6 * 60 * 60 * 1000;
      if (timeInterval < sixHours) {
        res.sendStatus(429);
        res.json({
          error: 'Too many requests',
          success: false,
        });
        return;
      }
    }

    const tx = await faucetRequestQueue.add(async () => {
      return await makeBtcFaucetPayment(btc.networks.regtest, address, 0.5);
    });

    await db.insertFaucetRequest({
      ip: `${ip}`,
      address: address,
      currency: DbFaucetRequestCurrency.BTC,
      occurred_at: now.toString(),
    });

    res.json({
      txid: tx.txId,
      raw_tx: tx.rawTx,
      success: true,
    });
  });

  router.getAsync('/btc/:address', async (req, res) => {
    const { address } = req.params;
    const balance = await getBtcBalance(btc.networks.regtest, address);
    res.json({ balance });
  });

  return router;
}
