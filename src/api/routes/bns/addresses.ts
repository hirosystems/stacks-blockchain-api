import * as express from 'express';
import { asyncHandler } from '../../async-handler';
import { DataStore } from '../../../datastore/common';
import { isUnanchoredRequest } from '../../query-helpers';
import { ChainID } from '@stacks/transactions';
import {
  getETagCacheHandler,
  setETagCacheHeaders,
} from '../../../api/controllers/cache-controller';

const SUPPORTED_BLOCKCHAINS = ['stacks'];

export function createBnsAddressesRouter(db: DataStore, chainId: ChainID): express.Router {
  const router = express.Router();
  const cacheHandler = getETagCacheHandler(db);

  router.get(
    '/:blockchain/:address',
    cacheHandler,
    asyncHandler(async (req, res, next) => {
      // Retrieves a list of names owned by the address provided.
      const { blockchain, address } = req.params;
      if (!SUPPORTED_BLOCKCHAINS.includes(blockchain)) {
        res.status(404).json({ error: 'Unsupported blockchain' });
        return;
      }
      const includeUnanchored = isUnanchoredRequest(req, res, next);
      const namesByAddress = await db.getNamesByAddressList({
        address: address,
        includeUnanchored,
        chainId,
      });
      setETagCacheHeaders(res);
      if (namesByAddress.found) {
        res.json({ names: namesByAddress.result });
      } else {
        res.json({ names: [] });
      }
    })
  );

  return router;
}
