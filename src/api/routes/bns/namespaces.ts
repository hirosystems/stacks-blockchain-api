import * as express from 'express';
import { asyncHandler } from '../../async-handler';
import { DataStore } from '../../../datastore/common';
import { parsePagingQueryInput } from '../../../api/pagination';
import { isUnanchoredRequest } from '../../query-helpers';
import { BnsErrors } from '../../../bns-constants';
import { BnsGetAllNamespacesResponse } from '@stacks/stacks-blockchain-api-types';

export function createBnsNamespacesRouter(db: DataStore): express.Router {
  const router = express.Router();

  router.get(
    '/',
    asyncHandler(async (req, res, next) => {
      const includeUnanchored = isUnanchoredRequest(req, res, next);
      const { results } = await db.getNamespaceList({ includeUnanchored });
      const response: BnsGetAllNamespacesResponse = {
        namespaces: results,
      };
      res.json(response);
      return;
    })
  );

  router.get(
    '/:tld/names',
    asyncHandler(async (req, res, next) => {
      const { tld } = req.params;
      const page = parsePagingQueryInput(req.query.page ?? 0);
      const includeUnanchored = isUnanchoredRequest(req, res, next);
      const response = await db.getNamespace({ namespace: tld, includeUnanchored });
      if (!response.found) {
        res.status(404).json(BnsErrors.NoSuchNamespace);
      } else {
        const { results } = await db.getNamespaceNamesList({
          namespace: tld,
          page,
          includeUnanchored,
        });
        if (results.length === 0 && req.query.page) {
          res.status(400).json(BnsErrors.InvalidPageNumber);
        }
        res.json(results);
      }
    })
  );

  return router;
}
