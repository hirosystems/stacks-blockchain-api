import * as express from 'express';
import { addAsync } from '@awaitjs/express';
import { DataStore } from '../../datastore/common';

export function createTxRouter(): express.Router {
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

  router.getAsync('/:tx_id', async (req, res) => {
    const db: DataStore = req.app.get('db');
    const { tx_id } = req.params;
    try {
      const tx = await db.getTx(tx_id);
      res.json(tx);
    } catch (e) {
      res.sendStatus(404);
    }
  });

  return router;
}
