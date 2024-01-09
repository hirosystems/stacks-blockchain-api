import * as express from 'express';
import { asyncHandler } from '../async-handler';
import {
  Microblock,
  MicroblockListResponse,
  UnanchoredTransactionListResponse,
} from '@stacks/stacks-blockchain-api-types';
import {
  getMicroblockFromDataStore,
  getMicroblocksFromDataStore,
  getUnanchoredTxsFromDataStore,
} from '../controllers/db-controller';
import { getPagingQueryLimit, parsePagingQueryInput, ResourceType } from '../pagination';
import { validateRequestHexInput } from '../query-helpers';
import { PgStore } from '../../datastore/pg-store';
import { has0xPrefix } from '@hirosystems/api-toolkit';

export function createMicroblockRouter(db: PgStore): express.Router {
  const router = express.Router();

  router.get(
    '/',
    asyncHandler(async (req, res) => {
      const limit = getPagingQueryLimit(ResourceType.Microblock, req.query.limit);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);
      const query = await getMicroblocksFromDataStore({ db, offset, limit });
      const response: MicroblockListResponse = {
        limit,
        offset,
        total: query.total,
        results: query.result,
      };

      // TODO: block schema validation
      res.json(response);
    })
  );

  router.get(
    '/:hash',
    asyncHandler(async (req, res) => {
      const { hash } = req.params;

      if (!has0xPrefix(hash)) {
        return res.redirect('/extended/v1/microblock/0x' + hash);
      }

      validateRequestHexInput(hash);

      const block = await getMicroblockFromDataStore({ db, microblockHash: hash });
      if (!block.found) {
        res.status(404).json({ error: `cannot find microblock by hash ${hash}` });
        return;
      }
      const response: Microblock = block.result;
      // TODO: block schema validation
      res.json(response);
    })
  );

  router.get(
    '/unanchored/txs',
    asyncHandler(async (req, res) => {
      // TODO: implement pagination for /unanchored/txs
      const txs = await getUnanchoredTxsFromDataStore(db);
      const response: UnanchoredTransactionListResponse = {
        total: txs.length,
        results: txs,
      };
      res.json(response);
    })
  );

  return router;
}
