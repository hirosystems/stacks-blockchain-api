import * as express from 'express';
import { BurnBlockListResponse } from '@stacks/stacks-blockchain-api-types';
import { getBurnBlocksFromDataStore } from '../controllers/db-controller';
import { getPagingQueryLimit, parsePagingQueryInput, ResourceType } from '../pagination';
import { getBlockHashQueryParam, getBlockHeightQueryParam } from '../query-helpers';
import { getETagCacheHandler, setETagCacheHeaders } from '../controllers/cache-controller';
import { asyncHandler } from '../async-handler';
import { PgStore } from '../../datastore/pg-store';

export function createBurnBlockRouter(db: PgStore): express.Router {
  const router = express.Router();
  const cacheHandler = getETagCacheHandler(db);
  router.get(
    '/',
    cacheHandler,
    asyncHandler(async (req, res, next) => {
      const limit = getPagingQueryLimit(ResourceType.BurnBlock, req.query.limit);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);
      const height =
        getBlockHeightQueryParam('height', false, req, res, next) ??
        getBlockHeightQueryParam('block_height', false, req, res, next);

      let hash = req.query.hash === 'latest' ? 'latest' : null;
      if (!hash) {
        hash = getBlockHashQueryParam('hash', false, req, res, next);
      }

      const { results, total } = await getBurnBlocksFromDataStore({
        offset,
        limit,
        db,
        height,
        hash,
      });
      setETagCacheHeaders(res);
      const response: BurnBlockListResponse = { limit, offset, total, results };
      res.json(response);
    })
  );

  return router;
}
