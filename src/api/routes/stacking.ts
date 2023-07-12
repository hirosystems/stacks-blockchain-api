import * as express from 'express';
import { asyncHandler } from '../async-handler';
import { PoolDelegationsResponse } from '@stacks/stacks-blockchain-api-types';
import { getPagingQueryLimit, parsePagingQueryInput, ResourceType } from '../pagination';
import { PgStore } from '../../datastore/pg-store';
import { getBlockHeightQueryParam, getBlockParams, validatePrincipal } from '../query-helpers';
import { getETagCacheHandler, setETagCacheHeaders } from '../controllers/cache-controller';

export function createStackingRouter(db: PgStore): express.Router {
  const router = express.Router();
  const cacheHandler = getETagCacheHandler(db);

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

        const stackersQuery = await db.getPox3PoolDelegations({
          delegator: poolPrincipal,
          blockHeight,
          burnBlockHeight,
          afterBlockHeight: afterBlock,
          limit,
          offset,
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
