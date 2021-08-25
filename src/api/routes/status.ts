import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import { DataStore } from 'src/datastore/common';
import GitInfo from '../../git-info';

export function createStatusRouter(db: DataStore): RouterWithAsync {
  const router = addAsync(express.Router());

  router.get('/', (req, res) =>
    res.status(200).json({
      server_version: `stacks-blockchain-api ${GitInfo.tag} (${GitInfo.branch}:${GitInfo.commit})`,
      status: 'ready',
    })
  );

  return router;
}
