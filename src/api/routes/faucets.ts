import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import * as btc from 'bitcoinjs-lib';
import PQueue from 'p-queue';
import { makeBTCFaucetPayment } from '../../btc-faucet';

export function createFaucetRouter(): RouterWithAsync {
  const router = addAsync(express.Router());

  const faucetRequestQueue = new PQueue({ concurrency: 1 });

  router.postAsync('/btc', async (req: express.Request, res: express.Response) => {
    const address: string = req.query.address || req.body.address;
    const tx = await faucetRequestQueue.add(async () => {
      return await makeBTCFaucetPayment(btc.networks.regtest, address, 0.5);
    });
    res.json({
      txId: tx.txId,
      rawTX: tx.rawTx,
      success: true,
    });
  });

  return router;
}
