import * as express from 'express';
import { PgStore } from '../../../datastore/pg-store';
import {
  getETagCacheHandler,
  setETagCacheHeaders,
} from '../../../api/controllers/cache-controller';
import { asyncHandler } from '../../async-handler';
import { NakamotoBlockListResponse } from 'docs/generated';
import {
  BlocksQueryParams,
  BurnBlockParams,
  CompiledBlocksQueryParams,
  CompiledBurnBlockParams,
} from './schemas';
import { parseDbNakamotoBlock, validRequestParams, validRequestQuery } from './helpers';

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

  router.get(
    '/:height_or_hash',
    cacheHandler,
    asyncHandler(async (req, res) => {
      if (!validRequestParams(req, res, CompiledBurnBlockParams)) return;
      const params = req.params as BurnBlockParams;

      const block = await db.getV2Block(params);
      if (!block) {
        res.status(404).json({ errors: 'Not found' });
        return;
      }
      setETagCacheHeaders(res);
      res.json(parseDbNakamotoBlock(block));
    })
  );

  return router;
}
