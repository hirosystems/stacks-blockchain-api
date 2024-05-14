import * as express from 'express';
import { getETagCacheHandler, setETagCacheHeaders } from '../../controllers/cache-controller';
import { asyncHandler } from '../../async-handler';
import { PgStore } from '../../../datastore/pg-store';
import {
  CompiledPoxCyclePaginationQueryParams,
  CompiledPoxCycleParams,
  CompiledPoxCycleSignerParams,
  CompiledPoxSignerPaginationQueryParams,
  PoxCyclePaginationQueryParams,
  PoxCycleParams,
  PoxCycleSignerParams,
  PoxSignerPaginationQueryParams,
  validRequestParams,
  validRequestQuery,
} from './schemas';
import {
  PoxCycleListResponse,
  PoxCycleSignerStackersListResponse,
  PoxCycleSignersListResponse,
  PoxSigner,
} from '@stacks/stacks-blockchain-api-types';
import { parseDbPoxCycle, parseDbPoxSigner, parseDbPoxSignerStacker } from './helpers';
import { InvalidRequestError } from '../../../errors';
import { ChainID, getChainIDNetwork } from '../../../helpers';

export function createPoxRouter(db: PgStore, chainId: ChainID): express.Router {
  const router = express.Router();
  const cacheHandler = getETagCacheHandler(db);
  const isMainnet = getChainIDNetwork(chainId) === 'mainnet';

  router.get(
    '/cycles',
    cacheHandler,
    asyncHandler(async (req, res, next) => {
      if (!validRequestQuery(req, res, CompiledPoxCyclePaginationQueryParams)) return;
      const query = req.query as PoxCyclePaginationQueryParams;

      const cycles = await db.v2.getPoxCycles(query);
      const response: PoxCycleListResponse = {
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

  router.get(
    '/cycles/:cycle_number/signers',
    cacheHandler,
    asyncHandler(async (req, res, next) => {
      if (
        !validRequestParams(req, res, CompiledPoxCycleParams) ||
        !validRequestQuery(req, res, CompiledPoxSignerPaginationQueryParams)
      )
        return;
      const params = req.params as PoxCycleParams;
      const query = req.query as PoxSignerPaginationQueryParams;

      try {
        const { limit, offset, results, total } = await db.v2.getPoxCycleSigners({
          ...params,
          ...query,
        });
        const response: PoxCycleSignersListResponse = {
          limit,
          offset,
          total,
          results: results.map(r => parseDbPoxSigner(r, isMainnet)),
        };
        setETagCacheHeaders(res);
        res.json(response);
      } catch (error) {
        if (error instanceof InvalidRequestError) {
          res.status(404).json({ errors: error.message });
          return;
        }
        throw error;
      }
    })
  );

  router.get(
    '/cycles/:cycle_number/signers/:signer_key',
    cacheHandler,
    asyncHandler(async (req, res, next) => {
      if (!validRequestParams(req, res, CompiledPoxCycleSignerParams)) return;
      const params = req.params as PoxCycleSignerParams;

      try {
        const signer = await db.v2.getPoxCycleSigner(params);
        if (!signer) {
          res.status(404).json({ error: `Not found` });
          return;
        }
        const response: PoxSigner = parseDbPoxSigner(signer, isMainnet);
        setETagCacheHeaders(res);
        res.json(response);
      } catch (error) {
        if (error instanceof InvalidRequestError) {
          res.status(404).json({ errors: error.message });
          return;
        }
        throw error;
      }
    })
  );

  router.get(
    '/cycles/:cycle_number/signers/:signer_key/stackers',
    cacheHandler,
    asyncHandler(async (req, res, next) => {
      if (
        !validRequestParams(req, res, CompiledPoxCycleSignerParams) ||
        !validRequestQuery(req, res, CompiledPoxSignerPaginationQueryParams)
      )
        return;
      const params = req.params as PoxCycleSignerParams;
      const query = req.query as PoxSignerPaginationQueryParams;

      try {
        const { limit, offset, results, total } = await db.v2.getPoxCycleSignerStackers({
          ...params,
          ...query,
        });
        const response: PoxCycleSignerStackersListResponse = {
          limit,
          offset,
          total,
          results: results.map(r => parseDbPoxSignerStacker(r)),
        };
        setETagCacheHeaders(res);
        res.json(response);
      } catch (error) {
        if (error instanceof InvalidRequestError) {
          res.status(404).json({ errors: error.message });
          return;
        }
        throw error;
      }
    })
  );

  return router;
}
