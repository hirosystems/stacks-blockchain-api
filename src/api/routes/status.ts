import * as express from 'express';
import * as fs from 'fs';
import { DataStore } from '../../datastore/common';
import { ServerStatusResponse } from '@stacks/stacks-blockchain-api-types';
import { logger } from '../../helpers';

export function createStatusRouter(_: DataStore): express.Router {
  const router = express.Router();

  const statusHandler = (_: Request, res: any) => {
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
  };
  router.get('/', statusHandler);
  router.post('/', statusHandler);

  return router;
}
