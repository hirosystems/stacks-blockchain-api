import * as express from 'express';
import { PgStore } from '../../../datastore/pg-store';
import { getETagCacheHandler, setETagCacheHeaders } from '../../controllers/cache-controller';
import { asyncHandler } from '../../async-handler';
import { SmartContractsStatusResponse } from 'docs/generated';
import {
  validRequestQuery,
  CompiledSmartContractStatusParams,
  SmartContractStatusParams,
} from './schemas';

export function createV2SmartContractsRouter(db: PgStore): express.Router {
  const router = express.Router();
  const cacheHandler = getETagCacheHandler(db);

  router.get(
    '/status',
    cacheHandler,
    asyncHandler(async (req, res) => {
      if (!validRequestQuery(req, res, CompiledSmartContractStatusParams)) return;
      const query = req.query as SmartContractStatusParams;

      const response = (await db.v2.getSmartContractStatus(query)) as SmartContractsStatusResponse;
      setETagCacheHeaders(res);
      res.json(response);
    })
  );

  return router;
}
