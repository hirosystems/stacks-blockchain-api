import * as express from 'express';
import { asyncHandler } from '../async-handler';
import { DataStore, DbTx, DbMempoolTx, DbEventTypeId } from '../../datastore/common';
import {
  getTxFromDataStore,
  parseTxTypeStrings,
  parseDbMempoolTx,
  searchTx,
  searchTxs,
  parseDbTx,
  parseDbEvent,
} from '../controllers/db-controller';
import {
  waiter,
  has0xPrefix,
  logError,
  isProdEnv,
  isValidC32Address,
  bufferToHexPrefixString,
  isValidPrincipal,
  hexToBuffer,
  parseEventTypeStrings,
} from '../../helpers';
import { InvalidRequestError, InvalidRequestErrorType } from '../../errors';
import {
  isUnanchoredRequest,
  getBlockHeightPathParam,
  validateRequestHexInput,
} from '../query-helpers';
import { parseLimitQuery, parsePagingQueryInput } from '../pagination';
import { validate } from '../validate';
import {
  TransactionType,
  TransactionResults,
  MempoolTransactionListResponse,
  GetRawTransactionResult,
  Transaction,
} from '@stacks/stacks-blockchain-api-types';
import { getChainTipCacheHandler, setChainTipCacheHeaders } from '../controllers/cache-controller';

const MAX_TXS_PER_REQUEST = 200;
const parseTxQueryLimit = parseLimitQuery({
  maxItems: MAX_TXS_PER_REQUEST,
  errorMsg: '`limit` must be equal to or less than ' + MAX_TXS_PER_REQUEST,
});

const MAX_MEMPOOL_TXS_PER_REQUEST = 200;
const parseMempoolTxQueryLimit = parseLimitQuery({
  maxItems: MAX_MEMPOOL_TXS_PER_REQUEST,
  errorMsg: '`limit` must be equal to or less than ' + MAX_MEMPOOL_TXS_PER_REQUEST,
});

const MAX_EVENTS_PER_REQUEST = 200;
const parseTxQueryEventsLimit = parseLimitQuery({
  maxItems: MAX_EVENTS_PER_REQUEST,
  errorMsg: '`event_limit` must be equal to or less than ' + MAX_EVENTS_PER_REQUEST,
});

export function createEventsRouter(db: DataStore): express.Router {
  const router = express.Router();
  router.use(express.json());
  router.get(
    '/address/:principal',
    asyncHandler(async (req, res, next) => {
      const { principal } = req.params;
      const limit = parseTxQueryLimit(req.query.limit ?? 96);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);

      const typeQuery = req.query.type;
      console.log('type query', typeQuery);
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
      console.log('event type id', eventTypeFilter);

      // const includeUnanchored = isUnanchoredRequest(req, res, next);
      const { results } = await db.getAddressEvents({
        principal,
        eventTypeFilter,
        offset,
        limit,
        // includeUnanchored,
      });

      // const response: TransactionResults = { limit, offset, total, results };
      const response = { limit, offset, events: results.map(e => parseDbEvent(e)) };
      // if (!isProdEnv) {
      //   const schemaPath =
      //     '@stacks/stacks-blockchain-api-types/api/transaction/get-transactions.schema.json';
      //   await validate(schemaPath, response);
      // }
      // setChainTipCacheHeaders(res);
      res.status(200).json(response);
    })
  );

  // router.get(
  //   '/tx/:tx_id',
  //   asyncHandler(async (req, res, next) => {
  //     const { tx_id } = req.params;
  //     if (!has0xPrefix(tx_id)) {
  //       return res.redirect('/extended/v1/events/tx/0x' + tx_id);
  //     }

  //     // const eventLimit = parseTxQueryEventsLimit(req.query['event_limit'] ?? 96);
  //     // const eventOffset = parsePagingQueryInput(req.query['event_offset'] ?? 0);
  //     const limit = parseTxQueryLimit(req.query.limit ?? 96);
  //     const offset = parsePagingQueryInput(req.query.offset ?? 0);
  //     // const includeUnanchored = isUnanchoredRequest(req, res, next);
  //     validateRequestHexInput(tx_id);

  //     const txQuery = await db.getTxEvents({
  //       txId: tx_id,
  //       limit,
  //       offset,
  //       // includeUnanchored,
  //     });
  //     if (!txQuery.found) {
  //       res.status(404).json({ error: `could not find transaction by ID ${tx_id}` });
  //       return;
  //     }
  //     res.json(txQuery.result);
  //   })
  // );

  return router;
}
