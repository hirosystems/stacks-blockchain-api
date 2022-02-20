import * as express from 'express';
import * as fs from 'fs';
import { DataStore } from '../../datastore/common';
import { ServerStatusResponse } from '@stacks/stacks-blockchain-api-types';
import { logger } from '../../helpers';
import { getChainTipCacheHandler, setChainTipCacheHeaders } from '../controllers/cache-controller';

export function createStatusRouter(db: DataStore): express.Router {
  const router = express.Router();
  const cacheHandler = getChainTipCacheHandler(db);
  const statusHandler = async (_: Request, res: any) => {
    try {
      const [branch, commit, tag] = fs.readFileSync('.git-info', 'utf-8').split('\n');
      const response: ServerStatusResponse = {
        server_version: `stacks-blockchain-api ${tag} (${branch}:${commit})`,
        status: 'ready',
      };
      const chainTip = await db.getUnanchoredChainTip();
      if (chainTip.found) {
        response.chain_tip = {
          block_height: chainTip.result.blockHeight,
          block_hash: chainTip.result.blockHash,
          index_block_hash: chainTip.result.indexBlockHash,
          microblock_hash: chainTip.result.microblockHash,
          microblock_sequence: chainTip.result.microblockSequence,
        };
      }
      setChainTipCacheHeaders(res);
      res.json(response);
    } catch (error) {
      logger.error(`Unable to read git info`, error);
      const response: ServerStatusResponse = {
        status: 'ready',
      };
      res.json(response);
    }
  };
  router.get('/', cacheHandler, statusHandler);
  router.post('/', cacheHandler, statusHandler);

  return router;
}
