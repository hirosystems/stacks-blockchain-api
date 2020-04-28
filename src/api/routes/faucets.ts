import * as express from 'express';
import { addAsync } from '@awaitjs/express';
import { makeBTCFaucetPayment } from '../../btc-faucet';

const router = addAsync(express.Router());

router.postAsync('/btc', async (req: express.Request, res: express.Response) => {
  const address: string = req.query.address || req.body.address;
  const tx = await makeBTCFaucetPayment(address);
  res.json({
    txId: tx.getId(),
    rawTX: tx.toHex(),
    success: true,
  });
});

export default router;
