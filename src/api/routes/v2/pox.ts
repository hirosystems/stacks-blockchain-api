import * as express from 'express';
import { handleBadRequest } from '../../query-helpers';
import { getETagCacheHandler, setETagCacheHeaders } from '../../controllers/cache-controller';
import { asyncHandler } from '../../async-handler';
import { PgStore } from '../../../datastore/pg-store';
import {
  CompiledPoxCyclePaginationQueryParams,
  CompiledPoxCycleParams,
  PoxCyclePaginationQueryParams,
  PoxCycleParams,
  validRequestParams,
  validRequestQuery,
} from './schemas';
import { PoXCycleListResponse } from 'docs/generated';
import { parseDbPoxCycle } from './helpers';

export function createPoxRouter(db: PgStore): express.Router {
  const router = express.Router();
  const cacheHandler = getETagCacheHandler(db);
  /*
    /extended/v2/pox/cycles
    /extended/v2/pox/cycles/:number
    /extended/v2/pox/cycles/next
    /extended/v2/pox/cycles/:number/signers
    /extended/v2/pox/cycles/:number/signers/:key/stackers
    /extended/v2/pox/cycles/:number/signers/:key/stackers/:address/delegates     *pools only

    /extended/v2/pox/signers/:key
    /extended/v2/pox/stackers/:address
    */
  router.get(
    '/cycles',
    cacheHandler,
    asyncHandler(async (req, res, next) => {
      if (!validRequestQuery(req, res, CompiledPoxCyclePaginationQueryParams)) return;
      const query = req.query as PoxCyclePaginationQueryParams;

      const cycles = await db.v2.getPoxCycles(query);
      const response: PoXCycleListResponse = {
        limit: cycles.limit,
        offset: cycles.offset,
        total: cycles.total,
        results: cycles.results.map(c => parseDbPoxCycle(c)),
      };
      setETagCacheHeaders(res);
      res.json(response);
    })
  );

  router.get(
    '/cycles/:cycle_number',
    cacheHandler,
    asyncHandler(async (req, res, next) => {
      if (!validRequestParams(req, res, CompiledPoxCycleParams)) return;
      const params = req.params as PoxCycleParams;

      const cycle = await db.v2.getPoxCycle(params);
      if (!cycle) {
        res.status(404).json({ error: `Not found` });
        return;
      }
      setETagCacheHeaders(res);
      res.json(parseDbPoxCycle(cycle));
    })
  );

  return router;
}
