import * as express from 'express';
import { addAsync } from '@awaitjs/express';
import { DataStore } from '../../datastore/common';
import { getTxFromDataStore } from '../controllers/db-controller';

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
    const txResponse = await getTxFromDataStore(tx_id, db);
    res.json(txResponse);
  });

  return router;
}
