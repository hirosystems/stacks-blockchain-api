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
import { parseLimitQuery, parsePagingQueryInput } from '../pagination';
import { PgStore } from '../../datastore/pg-store';

const MAX_EVENTS_PER_REQUEST = 250;

const parseQueryLimit = parseLimitQuery({
  maxItems: MAX_EVENTS_PER_REQUEST,
  errorMsg: '`limit` must be equal to or less than ' + MAX_EVENTS_PER_REQUEST,
});

export function createPox2EventsRouter(db: PgStore): express.Router {
  const router = express.Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const limit = parseQueryLimit(req.query.limit ?? 96);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);

      const queryResults = await db.getPox2Events({ offset, limit });
      const response = {
        limit,
        offset,
        results: queryResults,
      };
      res.json(response);
    })
  );

  return router;
}
