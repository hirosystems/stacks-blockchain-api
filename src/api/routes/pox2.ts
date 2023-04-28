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
import { validatePrincipal, validateRequestHexInput } from '../query-helpers';

export function createPox2EventsRouter(db: PgStore): express.Router {
  const router = express.Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const limit = getPagingQueryLimit(ResourceType.Pox2Event, req.query.limit);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);

      const queryResults = await db.getPox2Events({ offset, limit });
      const parsedResult = queryResults.map(r => parsePox2Event(r));
      const response = {
        limit,
        offset,
        results: parsedResult,
      };
      res.json(response);
    })
  );

  // TODO: this should probably be a tx route e.g. /extended/v1/tx/:tx_id/pox2_events
  router.get(
    '/tx/:tx_id',
    asyncHandler(async (req, res) => {
      const { tx_id } = req.params;
      validateRequestHexInput(tx_id);
      const queryResults = await db.getPox2EventsForTx({ txId: tx_id });
      if (!queryResults.found) {
        res.status(404).json({ error: `could not find transaction by ID ${tx_id}` });
        return;
      }
      const parsedResult = queryResults.result.map(r => parsePox2Event(r));
      const response = {
        results: parsedResult,
      };
      res.json(response);
    })
  );

  // TODO: this should probably be an account route e.g. /extended/v1/address/:stx_address/pox2_events
  router.get(
    '/stacker/:principal',
    asyncHandler(async (req, res) => {
      const { principal } = req.params;
      validatePrincipal(principal);
      const queryResults = await db.getPox2EventsForStacker({ principal });
      if (!queryResults.found) {
        res.status(404).json({ error: `could not find principal ${principal}` });
        return;
      }
      const parsedResult = queryResults.result.map(r => parsePox2Event(r));
      const response = {
        results: parsedResult,
      };
      res.json(response);
    })
  );

  return router;
}
