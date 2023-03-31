import * as express from 'express';
import { asyncHandler } from '../async-handler';
import { getPagingQueryLimit, parsePagingQueryInput, ResourceType } from '../pagination';
import { parseDbEvent } from '../controllers/db-controller';
import { parseTraitAbi, validateJsonPathQuery } from '../query-helpers';
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
    asyncHandler(async (req, res, next) => {
      const { contract_id } = req.params;
      const limit = getPagingQueryLimit(ResourceType.Contract, req.query.limit);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);

      /*
      const filterPath = validateJsonPathQuery(req, res, next, 'filter_path', {
        paramRequired: false,
        maxCharLength: 200,
        maxOperations: 6,
      });
      */

      const filterPath = (req.query['filter_path'] ?? null) as string | null;
      const maxFilterPathCharLength = 200;
      if (filterPath && filterPath.length > maxFilterPathCharLength) {
        res.status(400).json({
          error: `'filter_path' query param value exceeds ${maxFilterPathCharLength} character limit`,
        });
        return;
      }

      const containsJsonQuery = req.query['contains'];
      if (containsJsonQuery && typeof containsJsonQuery !== 'string') {
        res.status(400).json({ error: `'contains' query param must be a string` });
        return;
      }
      let containsJson: any | undefined;
      const maxContainsJsonCharLength = 200;
      if (containsJsonQuery) {
        if (containsJsonQuery.length > maxContainsJsonCharLength) {
          res.status(400).json({
            error: `'contains' query param value exceeds ${maxContainsJsonCharLength} character limit`,
          });
          return;
        }
        try {
          containsJson = JSON.parse(containsJsonQuery);
        } catch (error) {
          res.status(400).json({ error: `'contains' query param value must be valid JSON` });
          return;
        }
      }

      const eventsQuery = await db.getSmartContractEvents({
        contractId: contract_id,
        limit,
        offset,
        filterPath,
        containsJson,
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
