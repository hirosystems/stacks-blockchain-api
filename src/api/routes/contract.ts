import * as express from 'express';
import { addAsync, RouterWithAsync } from '@awaitjs/express';
import { DataStore } from '../../datastore/common';
import { parseLimitQuery, parsePagingQueryInput } from '../pagination';
import { parseDbEvent } from '../controllers/db-controller';

const MAX_EVENTS_PER_REQUEST = 50;
const parseContractEventsQueryLimit = parseLimitQuery({
  maxItems: MAX_EVENTS_PER_REQUEST,
  errorMsg: '`limit` must be equal to or less than ' + MAX_EVENTS_PER_REQUEST,
});

export function createContractRouter(db: DataStore): RouterWithAsync {
  const router = addAsync(express.Router());
  router.getAsync('/:contract_id', async (req, res) => {
    const { contract_id } = req.params;
    const contractQuery = await db.getSmartContract(contract_id);
    if (!contractQuery.found) {
      res.status(404).json({ error: `cannot find contract by ID ${contract_id}` });
      return;
    }
    res.json(contractQuery.result);
  });

  router.getAsync('/:contract_id/events', async (req, res) => {
    const { contract_id } = req.params;
    const limit = parseContractEventsQueryLimit(req.query.limit ?? 20);
    const offset = parsePagingQueryInput(req.query.offset ?? 0);
    const eventsQuery = await db.getSmartContractEvents({ contractId: contract_id, limit, offset });
    if (!eventsQuery.found) {
      res.status(404).json({ error: `cannot find events for contract by ID: ${contract_id}` });
      return;
    }
    const parsedEvents = eventsQuery.result.map(event => parseDbEvent(event));
    res.json({ limit, offset, results: parsedEvents });
  });

  return router;
}
