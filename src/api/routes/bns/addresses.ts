import * as express from 'express';
import { asyncHandler } from '../../async-handler';
import { DataStore } from '../../../datastore/common';
import { isUnanchoredRequest } from '../../query-helpers';

const SUPPORTED_BLOCKCHAINS = ['stacks'];

export function createBnsAddressesRouter(db: DataStore): express.Router {
  const router = express.Router();
  router.get(
    '/:blockchain/:address',
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
      });
      if (namesByAddress.found) {
        res.json({ names: namesByAddress.result });
      } else {
        res.json({ names: [] });
      }
    })
  );

  return router;
}
