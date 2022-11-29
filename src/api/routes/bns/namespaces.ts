import * as express from 'express';
import { asyncHandler } from '../../async-handler';
import { PgStore } from '../../../datastore/pg-store';
import { parsePagingQueryInput } from '../../../api/pagination';
import { isUnanchoredRequest } from '../../query-helpers';
import { BnsErrors } from '../../../event-stream/bns/bns-constants';
import { BnsGetAllNamespacesResponse } from '@stacks/stacks-blockchain-api-types';
import {
  getETagCacheHandler,
  setETagCacheHeaders,
} from '../../../api/controllers/cache-controller';

export function createBnsNamespacesRouter(db: PgStore): express.Router {
  const router = express.Router();
  const cacheHandler = getETagCacheHandler(db);

  router.get(
    '/',
    cacheHandler,
    asyncHandler(async (req, res, next) => {
      const includeUnanchored = isUnanchoredRequest(req, res, next);
      const { results } = await db.getNamespaceList({ includeUnanchored });
      const response: BnsGetAllNamespacesResponse = {
        namespaces: results,
      };
      setETagCacheHeaders(res);
      res.json(response);
      return;
    })
  );

  router.get(
    '/:tld/names',
    cacheHandler,
    asyncHandler(async (req, res, next) => {
      const { tld } = req.params;
      const page = parsePagingQueryInput(req.query.page ?? 0);
      const includeUnanchored = isUnanchoredRequest(req, res, next);
      await db
        .sqlTransaction(async sql => {
          const response = await db.getNamespace({ namespace: tld, includeUnanchored });
          if (!response.found) {
            throw BnsErrors.NoSuchNamespace;
          } else {
            const { results } = await db.getNamespaceNamesList({
              namespace: tld,
              page,
              includeUnanchored,
            });
            if (results.length === 0 && req.query.page) {
              throw BnsErrors.InvalidPageNumber;
            } else {
              return results;
            }
          }
        })
        .then(results => {
          setETagCacheHeaders(res);
          res.json(results);
        })
        .catch(error => {
          res.status(400).json(error);
        });
    })
  );

  return router;
}
