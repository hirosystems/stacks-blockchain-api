import * as express from 'express';
import { asyncHandler } from '../async-handler';
import {
  BurnchainReward,
  BurnchainRewardListResponse,
  BurnchainRewardSlotHolder,
  BurnchainRewardSlotHolderListResponse,
  BurnchainRewardsTotal,
} from '@stacks/stacks-blockchain-api-types';

import { isValidBitcoinAddress, tryConvertC32ToBtc } from '../../helpers';
import { InvalidRequestError, InvalidRequestErrorType } from '../../errors';
import { getPagingQueryLimit, parsePagingQueryInput, ResourceType } from '../pagination';
import { PgStore } from '../../datastore/pg-store';
import { parsePox2Event } from '../controllers/db-controller';
import { getBlockParams, validatePrincipal, validateRequestHexInput } from '../query-helpers';
import { getETagCacheHandler, setETagCacheHeaders } from '../controllers/cache-controller';

export function createStackingRouter(db: PgStore): express.Router {
  const router = express.Router();
  const cacheHandler = getETagCacheHandler(db);

  router.get(
    '/:delegator/stackers',
    cacheHandler,
    asyncHandler(async (req, res, next) => {
      // get recent asset event associated with address
      const delegator = req.params['delegator'];
      validatePrincipal(delegator);
      const limit = getPagingQueryLimit(ResourceType.Stacker, req.query.limit);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);

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

        const stackersQuery = await db.getPox2StackersForDelegator({
          delegator,
          blockHeight,
          burnBlockHeight,
          limit,
          offset,
        });
        if (!stackersQuery.found) {
          const error = `no stackers found`;
          res.status(404).json({ error: error });
          throw new Error(error);
        }
        // const results = assetEvents.map(event => parseDbEvent(event));
        // const response: AddressAssetEvents = { limit, offset, total, results };
        const response = {
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
