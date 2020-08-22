import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import { DataStore } from '../../../datastore/common';

export function createRMempoolRouter(db: DataStore): RouterWithAsync {
  const router = addAsync(express.Router());

  router.post('/', (req, res) => {
    res.json({ status: 'ready' });
  });

  router.post('/transaction', (req, res) => {
    res.json({ status: 'ready' });
  });

  return router;
}
