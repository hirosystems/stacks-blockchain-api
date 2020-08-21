import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import { DataStore } from '../../../datastore/common';

export function createRAccountRouter(db: DataStore): RouterWithAsync {
  const router = addAsync(express.Router());
  router.use(express.json());

  router.postAsync('/balance', async (req, res) => {
    res.json({status: 'ready'});
  });

  return router;
};
