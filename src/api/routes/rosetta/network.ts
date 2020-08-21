import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import { DataStore } from '../../../datastore/common';

export function createRNetworkRouter(db: DataStore): RouterWithAsync {
  const router = addAsync(express.Router());

  router.postAsync('/list', async (req, res) => {
    res.json({status: 'ready'});
  });

  router.postAsync('/status', async (req, res) => {
    res.json({status: 'ready'});
  });

  router.postAsync('/options', async (req, res) => {
    res.json({status: 'ready'});
  });

  return router;
};
