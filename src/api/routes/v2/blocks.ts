import * as express from 'express';
import { PgStore } from '../../../datastore/pg-store';
import {
  getETagCacheHandler,
  setETagCacheHeaders,
} from '../../../api/controllers/cache-controller';
import { asyncHandler } from '../../async-handler';
import { BlockListResponse } from 'docs/generated';
import { getBlocksWithMetadata } from '../../../api/controllers/db-controller';
import { BlockLimitParam, BlocksQueryParams, CompiledBlocksQueryParams } from './schemas';

export function createV2BlocksRouter(db: PgStore): express.Router {
  const router = express.Router();
  const cacheHandler = getETagCacheHandler(db);

  router.get(
    '/',
    cacheHandler,
    asyncHandler(async (req, res) => {
      if (!CompiledBlocksQueryParams.Check(req.query)) {
        res.status(400).json({ errors: [CompiledBlocksQueryParams.Errors(req.query)] });
        return;
      }
      const query = req.query as BlocksQueryParams;

      const { results, total } = await getBlocksWithMetadata(db, query);
      const response: BlockListResponse = {
        limit: query.limit ?? BlockLimitParam.default,
        offset: query.offset ?? 0,
        total,
        results,
      };
      setETagCacheHeaders(res);
      res.json(response);
    })
  );
  return router;
}
