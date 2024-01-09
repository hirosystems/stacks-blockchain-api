import * as express from 'express';
import { asyncHandler } from '../async-handler';
import { getPagingQueryLimit, parsePagingQueryInput, ResourceType } from '../pagination';
import { PgStore } from '../../datastore/pg-store';
import { parsePoxSyntheticEvent } from '../controllers/db-controller';
import {
  getBlockHeightQueryParam,
  getBlockParams,
  validatePrincipal,
  validateRequestHexInput,
} from '../query-helpers';
import { getETagCacheHandler, setETagCacheHeaders } from '../controllers/cache-controller';
import { PoolDelegationsResponse } from '@stacks/stacks-blockchain-api-types';

export function createPoxEventsRouter(
  db: PgStore,
  poxVersion: 'pox2' | 'pox3' | 'pox4'
): express.Router {
  const router = express.Router();
  const cacheHandler = getETagCacheHandler(db);

  const poxTable = (
    {
      pox2: 'pox2_events',
      pox3: 'pox3_events',
      pox4: 'pox4_events',
    } as const
  )[poxVersion];

  router.get(
    '/events',
    cacheHandler,
    asyncHandler(async (req, res) => {
      const limit = getPagingQueryLimit(ResourceType.Pox2Event, req.query.limit);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);

      const queryResults = await db.getPoxSyntheticEvents({
        offset,
        limit,
        poxTable,
      });
      const parsedResult = queryResults.map(r => parsePoxSyntheticEvent(r));
      const response = {
        limit,
        offset,
        results: parsedResult,
      };
      setETagCacheHeaders(res);
      res.json(response);
    })
  );

  router.get(
    '/tx/:tx_id',
    cacheHandler,
    asyncHandler(async (req, res) => {
      const { tx_id } = req.params;
      validateRequestHexInput(tx_id);
      const queryResults = await db.getPoxSyntheticEventsForTx({
        txId: tx_id,
        poxTable,
      });
      if (!queryResults.found) {
        res.status(404).json({ error: `could not find transaction by ID ${tx_id}` });
        return;
      }
      const parsedResult = queryResults.result.map(r => parsePoxSyntheticEvent(r));
      const response = {
        results: parsedResult,
      };
      setETagCacheHeaders(res);
      res.json(response);
    })
  );

  router.get(
    '/stacker/:principal',
    cacheHandler,
    asyncHandler(async (req, res) => {
      const { principal } = req.params;
      validatePrincipal(principal);
      const queryResults = await db.getPoxSyntheticEventsForStacker({
        principal,
        poxTable,
      });
      if (!queryResults.found) {
        res.status(404).json({ error: `could not find principal ${principal}` });
        return;
      }
      const parsedResult = queryResults.result.map(r => parsePoxSyntheticEvent(r));
      const response = {
        results: parsedResult,
      };
      setETagCacheHeaders(res);
      res.json(response);
    })
  );

  router.get(
    '/:pool_principal/delegations',
    cacheHandler,
    asyncHandler(async (req, res, next) => {
      // get recent asset event associated with address
      const poolPrincipal = req.params['pool_principal'];
      validatePrincipal(poolPrincipal);

      const limit = getPagingQueryLimit(ResourceType.Stacker, req.query.limit);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);
      const afterBlock = getBlockHeightQueryParam('after_block', false, req, res, next) || 0;

      const response = await db.sqlTransaction(async sql => {
        const blockParams = getBlockParams(req, res, next);
        let blockHeight: number;
        if (blockParams.blockHeight !== undefined) {
          blockHeight = blockParams.blockHeight;
        } else {
          blockHeight = await db.getMaxBlockHeight(sql, {
            includeUnanchored: blockParams.includeUnanchored ?? false,
          });
        }

        const dbBlock = await db.getBlockByHeightInternal(sql, blockHeight);
        if (!dbBlock.found) {
          const error = `no block at height: ${blockHeight}`;
          res.status(404).json({ error: error });
          throw new Error(error);
        }
        const burnBlockHeight = dbBlock.result.burn_block_height;

        const stackersQuery = await db.getPoxPoolDelegations({
          delegator: poolPrincipal,
          blockHeight,
          burnBlockHeight,
          afterBlockHeight: afterBlock,
          limit,
          offset,
          poxTable,
        });
        if (!stackersQuery.found) {
          const error = `no stackers found`;
          res.status(404).json({ error: error });
          throw new Error(error);
        }

        const response: PoolDelegationsResponse = {
          limit,
          offset,
          total: stackersQuery.result.total,
          results: stackersQuery.result.stackers,
        };
        return response;
      });
      setETagCacheHeaders(res);
      res.json(response);
    })
  );

  return router;
}
