import * as express from 'express';
import { PgStore } from '../../../datastore/pg-store';
import {
  getETagCacheHandler,
  setETagCacheHeaders,
} from '../../../api/controllers/cache-controller';
import { asyncHandler } from '../../async-handler';
import { NakamotoBlockListResponse } from 'docs/generated';
import { BlockLimitParamSchema, BlocksQueryParams, CompiledBlocksQueryParams } from './schemas';
import { parseDbNakamotoBlock, validRequestQuery } from './helpers';

export function createV2BlocksRouter(db: PgStore): express.Router {
  const router = express.Router();
  const cacheHandler = getETagCacheHandler(db);

  router.get(
    '/',
    cacheHandler,
    asyncHandler(async (req, res) => {
      if (!validRequestQuery(req, res, CompiledBlocksQueryParams)) return;
      const query = req.query as BlocksQueryParams;

      const { limit, offset, results, total } = await db.getV2Blocks(query);
      const response: NakamotoBlockListResponse = {
        limit,
        offset,
        total,
        results: results.map(r => parseDbNakamotoBlock(r)),
      };
      setETagCacheHeaders(res);
      res.json(response);
    })
  );
  return router;
}
