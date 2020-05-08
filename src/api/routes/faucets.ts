import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import * as btc from 'bitcoinjs-lib';
import PQueue from 'p-queue';
import { makeBtcFaucetPayment, getBtcBalance } from '../../btc-faucet';

export function createFaucetRouter(): RouterWithAsync {
  const router = addAsync(express.Router());

  const faucetRequestQueue = new PQueue({ concurrency: 1 });

  router.postAsync('/btc', async (req, res) => {
    const address: string = req.query.address || req.body.address;
    const tx = await faucetRequestQueue.add(async () => {
      return await makeBtcFaucetPayment(btc.networks.regtest, address, 0.5);
    });
    res.json({
      txId: tx.txId,
      rawTX: tx.rawTx,
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
