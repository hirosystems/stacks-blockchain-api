import * as express from 'express';
import { PgStore } from '../../../datastore/pg-store';
import { getETagCacheHandler, setETagCacheHeaders } from '../../controllers/cache-controller';
import { asyncHandler } from '../../async-handler';
import {
  validRequestQuery,
  CompiledSmartContractStatusParams,
  SmartContractStatusParams,
} from './schemas';
import { parseDbSmartContractStatusArray } from './helpers';

export function createV2SmartContractsRouter(db: PgStore): express.Router {
  const router = express.Router();
  const cacheHandler = getETagCacheHandler(db);

  router.get(
    '/status',
    cacheHandler,
    asyncHandler(async (req, res) => {
      if (!validRequestQuery(req, res, CompiledSmartContractStatusParams)) return;
      const query = req.query as SmartContractStatusParams;

      const result = await db.v2.getSmartContractStatus(query);
      setETagCacheHeaders(res);
      res.json(parseDbSmartContractStatusArray(query, result));
    })
  );

  return router;
}
