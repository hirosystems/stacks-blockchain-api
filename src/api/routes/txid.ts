import * as express from 'express';
import { addAsync } from '@awaitjs/express';
import { DataStore } from 'datastore/common';

const router = addAsync(express.Router());

router.getAsync('/', async (req, res) => {
  const db: DataStore = req.app.get('db');
  try {
    const transactions = await db.getTxList();
    return res.json(transactions);
  } catch (e) {
    res.sendStatus(500);
  }
});

router.getAsync('/:txid', async (req, res) => {
  const db: DataStore = req.app.get('db');
  const { txid } = req.params;
  try {
    const tx = await db.getTx(txid);
    res.json(tx);
  } catch (e) {
    res.sendStatus(404);
  }
});

export const txidRouter = router;
