import * as express from 'express';
import * as fs from 'fs';
import { ServerStatusResponse } from '@stacks/stacks-blockchain-api-types';
import { logger } from '../../helpers';
import { getETagCacheHandler, setETagCacheHeaders } from '../controllers/cache-controller';
import { PgStore } from '../../datastore/pg-store';
import { API_VERSION } from '../init';

export function createStatusRouter(db: PgStore): express.Router {
  const router = express.Router();
  const cacheHandler = getETagCacheHandler(db);
  const statusHandler = async (_: Request, res: any) => {
    try {
      const response: ServerStatusResponse = {
        server_version: `stacks-blockchain-api ${API_VERSION.tag} (${API_VERSION.branch}:${API_VERSION.commit})`,
        status: 'ready',
      };
      const pox1UnlockHeight = await db.getPox1UnlockHeight();
      if (pox1UnlockHeight.found) {
        response.pox_v1_unlock_height = pox1UnlockHeight.result;
      } else {
        response.pox_v1_unlock_height = null as any;
      }
      const chainTip = await db.getUnanchoredChainTip();
      if (chainTip.found) {
        response.chain_tip = {
          block_height: chainTip.result.blockHeight,
          block_hash: chainTip.result.blockHash,
          index_block_hash: chainTip.result.indexBlockHash,
          microblock_hash: chainTip.result.microblockHash,
          microblock_sequence: chainTip.result.microblockSequence,
          burn_block_height: chainTip.result.burnBlockHeight,
        };
      }
      setETagCacheHeaders(res);
      res.json(response);
    } catch (error) {
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
