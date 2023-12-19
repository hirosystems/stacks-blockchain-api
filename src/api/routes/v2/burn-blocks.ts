import * as express from 'express';
import { BurnBlockListResponse } from '@stacks/stacks-blockchain-api-types';
import { getETagCacheHandler, setETagCacheHeaders } from '../../controllers/cache-controller';
import { asyncHandler } from '../../async-handler';
import { PgStore } from '../../../datastore/pg-store';
import { parseDbBurnBlock } from './helpers';
import {
  BlockPaginationQueryParams,
  BlockParams,
  CompiledBlockPaginationQueryParams,
  CompiledBlockParams,
  validRequestParams,
  validRequestQuery,
} from './schemas';

export function createV2BurnBlocksRouter(db: PgStore): express.Router {
  const router = express.Router();
  const cacheHandler = getETagCacheHandler(db);

  router.get(
    '/',
    cacheHandler,
    asyncHandler(async (req, res) => {
      if (!validRequestQuery(req, res, CompiledBlockPaginationQueryParams)) return;
      const query = req.query as BlockPaginationQueryParams;

      const { limit, offset, results, total } = await db.getBurnBlocks(query);
      const response: BurnBlockListResponse = {
        limit,
        offset,
        total,
        results: results.map(r => parseDbBurnBlock(r)),
      };
      setETagCacheHeaders(res);
      res.json(response);
    })
  );

  router.get(
    '/:height_or_hash',
    cacheHandler,
    asyncHandler(async (req, res) => {
      if (!validRequestParams(req, res, CompiledBlockParams)) return;
      const params = req.params as BlockParams;

      const block = await db.getBurnBlock(params);
      if (!block) {
        res.status(404).json({ errors: 'Not found' });
        return;
      }
      setETagCacheHeaders(res);
      res.json(parseDbBurnBlock(block));
    })
  );

  return router;
}
