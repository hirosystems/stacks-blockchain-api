import * as express from 'express';
import { ServerStatusResponse } from '@stacks/stacks-blockchain-api-types';
import { getETagCacheHandler, setETagCacheHeaders } from '../controllers/cache-controller';
import { PgStore } from '../../datastore/pg-store';
import { SERVER_VERSION } from '@hirosystems/api-toolkit';

export function createStatusRouter(db: PgStore): express.Router {
  const router = express.Router();
  const cacheHandler = getETagCacheHandler(db);
  const statusHandler = async (_: Request, res: any) => {
    try {
      const response: ServerStatusResponse = {
        server_version: `stacks-blockchain-api ${SERVER_VERSION.tag} (${SERVER_VERSION.branch}:${SERVER_VERSION.commit})`,
        status: 'ready',
      };
      const poxForceUnlockHeights = await db.getPoxForceUnlockHeights();
      if (poxForceUnlockHeights.found) {
        response.pox_v1_unlock_height = poxForceUnlockHeights.result.pox1UnlockHeight as number;
        response.pox_v2_unlock_height = poxForceUnlockHeights.result.pox2UnlockHeight as number;
        response.pox_v3_unlock_height = poxForceUnlockHeights.result.pox3UnlockHeight as number;
      }
      const chainTip = await db.getChainTip(db.sql);
      if (chainTip.block_height > 0) {
        response.chain_tip = {
          block_height: chainTip.block_height,
          block_hash: chainTip.block_hash,
          index_block_hash: chainTip.index_block_hash,
          microblock_hash: chainTip.microblock_hash,
          microblock_sequence: chainTip.microblock_sequence,
          burn_block_height: chainTip.burn_block_height,
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
