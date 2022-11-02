import * as express from 'express';
import { asyncHandler } from '../async-handler';
import { getPagingQueryLimit, parsePagingQueryInput, ResourceType } from '../pagination';
import { parseDbEvent } from '../controllers/db-controller';
import { parseTraitAbi } from '../query-helpers';
import { PgStore } from '../../datastore/pg-store';

export function createContractRouter(db: PgStore): express.Router {
  const router = express.Router();

  router.get(
    '/by_trait',
    asyncHandler(async (req, res, next) => {
      const trait_abi = parseTraitAbi(req, res, next);
      const limit = getPagingQueryLimit(ResourceType.Contract, req.query.limit);
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
      const limit = getPagingQueryLimit(ResourceType.Contract, req.query.limit);
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
