import * as express from 'express';
import * as fs from 'fs';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import { DataStore } from 'src/datastore/common';
import { ServerStatusResponse } from 'docs/generated';
import { logger } from 'src/helpers';

export function createStatusRouter(db: DataStore): RouterWithAsync {
  const router = addAsync(express.Router());

  router.get('/', (_, res) => {
    try {
      const [branch, commit, tag] = fs.readFileSync('.git-info', 'utf-8').split('\n');
      const response: ServerStatusResponse = {
        server_version: `stacks-blockchain-api ${tag} (${branch}:${commit})`,
        status: 'ready',
      };
      res.json(response);
    } catch (error) {
      logger.error(`Unable to read git info`, error);
      const response: ServerStatusResponse = {
        status: 'ready',
      };
      res.json(response);
    }
  });

  return router;
}
