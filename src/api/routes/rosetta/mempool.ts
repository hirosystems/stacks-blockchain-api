import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import { DataStore } from '../../../datastore/common';

export function createRMempoolRouter(db: DataStore): RouterWithAsync {
  const router = addAsync(express.Router());

  router.postAsync('/', async (req, res) => {
    res.json({status: 'ready'});
  });

  router.postAsync('/transaction', async (req, res) => {
    res.json({status: 'ready'});
  });

  return router;
};
