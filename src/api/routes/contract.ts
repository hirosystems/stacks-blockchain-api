import * as express from 'express';
import { asyncHandler } from '../async-handler';
import { DataStore } from '../../datastore/common';
import { parseLimitQuery, parsePagingQueryInput } from '../pagination';
import { parseDbEvent } from '../controllers/db-controller';
import { ClarityAbi, ClarityAbiTypeId } from '@stacks/transactions';
import { parseTraitAbi } from '../query-helpers';

const MAX_EVENTS_PER_REQUEST = 50;
const parseContractEventsQueryLimit = parseLimitQuery({
  maxItems: MAX_EVENTS_PER_REQUEST,
  errorMsg: '`limit` must be equal to or less than ' + MAX_EVENTS_PER_REQUEST,
});

export function createContractRouter(db: DataStore): express.Router {
  const router = express.Router();

  router.get(
    '/by_trait',
    asyncHandler(async (req, res, next) => {
      const trait_abi = parseTraitAbi(req, res, next);
      const limit = parseContractEventsQueryLimit(req.query.limit ?? 20);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);
      const smartContracts = await db.getSmartContractByTrait({
        trait: trait_abi,
        limit,
        offset,
      });
      if (!smartContracts.found) {
        res.status(404).json({ error: `cannot find contract for this trait` });
        return;
      }
      const contractResults = smartContracts.result.map(contract => ({
        ...contract,
        abi: contract.abi,
      }));
      res.json({ limit, offset, results: contractResults });
    })
  );

  router.get(
    '/:contract_id',
    asyncHandler(async (req, res) => {
      const { contract_id } = req.params;
      const contractQuery = await db.getSmartContract(contract_id);
      if (!contractQuery.found) {
        res.status(404).json({ error: `cannot find contract by ID ${contract_id}` });
        return;
      }
      const contractResult = {
        ...contractQuery.result,
        abi: contractQuery.result.abi,
      };
      res.json(contractResult);
    })
  );

  router.get(
    '/:contract_id/events',
    asyncHandler(async (req, res) => {
      const { contract_id } = req.params;
      const limit = parseContractEventsQueryLimit(req.query.limit ?? 20);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);
      const eventsQuery = await db.getSmartContractEvents({
        contractId: contract_id,
        limit,
        offset,
      });
      if (!eventsQuery.found) {
        res.status(404).json({ error: `cannot find events for contract by ID: ${contract_id}` });
        return;
      }
      const parsedEvents = eventsQuery.result.map(event => parseDbEvent(event));
      res.json({ limit, offset, results: parsedEvents });
    })
  );

  return router;
}
