import * as express from 'express';
import { asyncHandler } from '../async-handler';
import { getPagingQueryLimit, parsePagingQueryInput, ResourceType } from '../pagination';
import { PgStore } from '../../datastore/pg-store';
import { parsePoxSyntheticEvent } from '../controllers/db-controller';
import { validatePrincipal, validateRequestHexInput } from '../query-helpers';

export function createPoxEventsRouter(
  db: PgStore,
  poxVersion: 'pox2' | 'pox3' | 'pox4'
): express.Router {
  const router = express.Router();

  const poxTable = (
    {
      pox2: 'pox2_events',
      pox3: 'pox3_events',
      pox4: 'pox4_events',
    } as const
  )[poxVersion];

  router.get(
    '/events',
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
      res.json(response);
    })
  );

  router.get(
    '/tx/:tx_id',
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
      res.json(response);
    })
  );

  router.get(
    '/stacker/:principal',
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
      res.json(response);
    })
  );

  return router;
}
