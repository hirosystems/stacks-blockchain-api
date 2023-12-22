import * as express from 'express';
import { PgStore } from '../../../datastore/pg-store';
import {
  getETagCacheHandler,
  setETagCacheHeaders,
} from '../../../api/controllers/cache-controller';
import { asyncHandler } from '../../async-handler';
import { NakamotoBlockListResponse, TransactionResults } from 'docs/generated';
import {
  BlockParams,
  CompiledBlockParams,
  CompiledTransactionPaginationQueryParams,
  TransactionPaginationQueryParams,
  validRequestQuery,
  validRequestParams,
  CompiledBlockPaginationQueryParams,
  BlockPaginationQueryParams,
} from './schemas';
import { parseDbNakamotoBlock } from './helpers';
import { InvalidRequestError } from '../../../errors';
import { parseDbTx } from '../../../api/controllers/db-controller';

export function createV2BlocksRouter(db: PgStore): express.Router {
  const router = express.Router();
  const cacheHandler = getETagCacheHandler(db);

  router.get(
    '/',
    cacheHandler,
    asyncHandler(async (req, res) => {
      if (!validRequestQuery(req, res, CompiledBlockPaginationQueryParams)) return;
      const query = req.query as BlockPaginationQueryParams;

      const { limit, offset, results, total } = await db.v2.getBlocks(query);
      const response: NakamotoBlockListResponse = {
        limit,
        offset,
        total,
        results: results.map(r => parseDbNakamotoBlock(r)),
      };
      setETagCacheHeaders(res);
      res.json(response);
    })
  );

  router.get(
    '/:height_or_hash',
    cacheHandler,
    asyncHandler(async (req, res) => {
      if (!validRequestParams(req, res, CompiledBlockParams)) return;
      const params = req.params as BlockParams;

      const block = await db.v2.getBlock(params);
      if (!block) {
        res.status(404).json({ errors: 'Not found' });
        return;
      }
      setETagCacheHeaders(res);
      res.json(parseDbNakamotoBlock(block));
    })
  );

  router.get(
    '/:height_or_hash/transactions',
    cacheHandler,
    asyncHandler(async (req, res) => {
      if (
        !validRequestParams(req, res, CompiledBlockParams) ||
        !validRequestQuery(req, res, CompiledTransactionPaginationQueryParams)
      )
        return;
      const params = req.params as BlockParams;
      const query = req.query as TransactionPaginationQueryParams;

      try {
        const { limit, offset, results, total } = await db.v2.getBlockTransactions({
          ...params,
          ...query,
        });
        const response: TransactionResults = {
          limit,
          offset,
          total,
          results: results.map(r => parseDbTx(r)),
        };
        setETagCacheHeaders(res);
        res.json(response);
      } catch (error) {
        if (error instanceof InvalidRequestError) {
          res.status(404).json({ errors: error.message });
          return;
        }
        throw error;
      }
    })
  );

  return router;
}
