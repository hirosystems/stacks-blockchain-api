import * as express from 'express';
import { PgStore } from '../../../datastore/pg-store';
import {
  getETagCacheHandler,
  setETagCacheHeaders,
} from '../../../api/controllers/cache-controller';
import { asyncHandler } from '../../async-handler';
import {
  AddressParams,
  CompiledAddressParams,
  CompiledTransactionPaginationQueryParams,
  TransactionPaginationQueryParams,
  validRequestParams,
  validRequestQuery,
} from './schemas';
import { parseDbTxWithAccountTransferSummary } from './helpers';
import { AddressTransactionsWithTransferSummaryListResponse } from '../../../../docs/generated';
import { InvalidRequestError } from '../../../errors';

export function createV2AddressesRouter(db: PgStore): express.Router {
  const router = express.Router();
  const cacheHandler = getETagCacheHandler(db);

  router.get(
    '/:address/transactions',
    cacheHandler,
    asyncHandler(async (req, res) => {
      if (
        !validRequestParams(req, res, CompiledAddressParams) ||
        !validRequestQuery(req, res, CompiledTransactionPaginationQueryParams)
      )
        return;
      const params = req.params as AddressParams;
      const query = req.query as TransactionPaginationQueryParams;

      try {
        const { limit, offset, results, total } = await db.v2.getAddressTransactions({
          ...params,
          ...query,
        });
        const response: AddressTransactionsWithTransferSummaryListResponse = {
          limit,
          offset,
          total,
          results: results.map(r => parseDbTxWithAccountTransferSummary(r)),
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
