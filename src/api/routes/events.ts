import * as express from 'express';
import { asyncHandler } from '../async-handler';
import { DataStore, DbEventTypeId } from '../../datastore/common';
import { parseDbEvent } from '../controllers/db-controller';
import { has0xPrefix, parseEventTypeStrings } from '../../helpers';
import { validateRequestHexInput } from '../query-helpers';
import { parseLimitQuery, parsePagingQueryInput } from '../pagination';

const MAX_EVENTS_PER_REQUEST = 200;
const parseEventsQueryLimit = parseLimitQuery({
  maxItems: MAX_EVENTS_PER_REQUEST,
  errorMsg: '`limit` must be equal to or less than ' + MAX_EVENTS_PER_REQUEST,
});

function createTypeFilter(typeQuery: any): DbEventTypeId[] {
  let eventTypeFilter: DbEventTypeId[];
  if (Array.isArray(typeQuery)) {
    eventTypeFilter = parseEventTypeStrings(typeQuery as string[]);
  } else if (typeof typeQuery === 'string') {
    eventTypeFilter = parseEventTypeStrings([typeQuery]);
  } else if (typeQuery) {
    throw new Error(`Unexpected event type query value: ${JSON.stringify(typeQuery)}`);
  } else {
    eventTypeFilter = [
      DbEventTypeId.SmartContractLog,
      DbEventTypeId.StxAsset,
      DbEventTypeId.FungibleTokenAsset,
      DbEventTypeId.NonFungibleTokenAsset,
      DbEventTypeId.StxLock,
    ]; //no filter provided , return all types of events
  }
  return eventTypeFilter;
}

export function createEventsRouter(db: DataStore): express.Router {
  const router = express.Router();
  router.use(express.json());
  router.get(
    '/address/:principal',
    asyncHandler(async (req, res, next) => {
      const { principal } = req.params;
      const limit = parseEventsQueryLimit(req.query.limit ?? 96);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);

      const typeQuery = req.query.type;
      try {
        const eventTypeFilter = createTypeFilter(typeQuery);
        const { results } = await db.getFilteredAddressEvents({
          principal,
          eventTypeFilter,
          offset,
          limit,
        });
        const response = { limit, offset, events: results.map(e => parseDbEvent(e)) };

        res.status(200).json(response);
      } catch (error) {
        res.status(400).json({ error: error });
      }
    })
  );

  router.get(
    '/tx/:tx_id',
    asyncHandler(async (req, res, next) => {
      const { tx_id } = req.params;
      if (!has0xPrefix(tx_id)) {
        return res.redirect('/extended/v1/events/tx/0x' + tx_id);
      }

      const limit = parseEventsQueryLimit(req.query.limit ?? 96);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);
      validateRequestHexInput(tx_id);

      const typeQuery = req.query.type;
      try {
        const eventTypeFilter = createTypeFilter(typeQuery);
        const { results } = await db.getFilteredTxEvents({
          txId: tx_id,
          eventTypeFilter,
          offset,
          limit,
        });
        const response = { limit, offset, events: results.map(e => parseDbEvent(e)) };

        res.status(200).json(response);
      } catch (error) {
        res.status(400).json({ error: error });
      }
    })
  );

  return router;
}
