import * as express from 'express';
import { asyncHandler } from '../async-handler';
import {
  parseTxTypeStrings,
  parseDbMempoolTx,
  searchTx,
  searchTxs,
  parseDbTx,
  parseDbEvent,
} from '../controllers/db-controller';
import { isValidC32Address, isValidPrincipal } from '../../helpers';
import { InvalidRequestError, InvalidRequestErrorType } from '../../errors';
import {
  isUnanchoredRequest,
  getBlockHeightPathParam,
  validateRequestHexInput,
  parseAddressOrTxId,
  parseEventTypeFilter,
  MempoolOrderByParam,
  OrderParam,
} from '../query-helpers';
import { getPagingQueryLimit, parsePagingQueryInput, ResourceType } from '../pagination';
import { validate } from '../validate';
import {
  TransactionType,
  TransactionResults,
  MempoolTransactionListResponse,
  GetRawTransactionResult,
} from '@stacks/stacks-blockchain-api-types';
import {
  ETagType,
  getETagCacheHandler,
  setETagCacheHeaders,
} from '../controllers/cache-controller';
import { PgStore } from '../../datastore/pg-store';
import { has0xPrefix, isProdEnv } from '@hirosystems/api-toolkit';

export function createTxRouter(db: PgStore): express.Router {
  const router = express.Router();

  const cacheHandler = getETagCacheHandler(db);
  const mempoolCacheHandler = getETagCacheHandler(db, ETagType.mempool);
  const txCacheHandler = getETagCacheHandler(db, ETagType.transaction);

  router.get(
    '/',
    cacheHandler,
    asyncHandler(async (req, res, next) => {
      const limit = getPagingQueryLimit(ResourceType.Tx, req.query.limit);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);

      const typeQuery = req.query.type;
      let txTypeFilter: TransactionType[];
      if (Array.isArray(typeQuery)) {
        txTypeFilter = parseTxTypeStrings(typeQuery as string[]);
      } else if (typeof typeQuery === 'string') {
        if (typeQuery.includes(',')) {
          txTypeFilter = parseTxTypeStrings(typeQuery.split(','));
        } else {
          txTypeFilter = parseTxTypeStrings([typeQuery]);
        }
      } else if (typeQuery) {
        throw new Error(`Unexpected tx type query value: ${JSON.stringify(typeQuery)}`);
      } else {
        txTypeFilter = [];
      }

      const includeUnanchored = isUnanchoredRequest(req, res, next);
      const { results: txResults, total } = await db.getTxList({
        offset,
        limit,
        txTypeFilter,
        includeUnanchored,
      });
      const results = txResults.map(tx => parseDbTx(tx));
      const response: TransactionResults = { limit, offset, total, results };
      if (!isProdEnv) {
        const schemaPath =
          '@stacks/stacks-blockchain-api-types/api/transaction/get-transactions.schema.json';
        await validate(schemaPath, response);
      }
      setETagCacheHeaders(res);
      res.json(response);
    })
  );

  router.get(
    '/multiple',
    asyncHandler(async (req, res, next) => {
      if (typeof req.query.tx_id === 'string') {
        // check if tx_id is a comma-seperated list of tx_ids
        if (req.query.tx_id.includes(',')) {
          req.query.tx_id = req.query.tx_id.split(',');
        } else {
          // in case req.query.tx_id is a single tx_id string and not an array
          req.query.tx_id = [req.query.tx_id];
        }
      }
      const txList: string[] = req.query.tx_id as string[];

      const eventLimit = getPagingQueryLimit(ResourceType.Tx, req.query['event_limit']);
      const eventOffset = parsePagingQueryInput(req.query['event_offset'] ?? 0);
      const includeUnanchored = isUnanchoredRequest(req, res, next);
      txList.forEach(tx => validateRequestHexInput(tx));
      const txQuery = await searchTxs(db, {
        txIds: txList,
        eventLimit,
        eventOffset,
        includeUnanchored,
      });
      // TODO: this validation needs fixed now that the mempool-tx and mined-tx types no longer overlap
      /*
    const schemaPath = require.resolve(
      '@stacks/stacks-blockchain-api-types/entities/transactions/transaction.schema.json'
    );
    await validate(schemaPath, txQuery.result);
    */
      res.json(txQuery);
    })
  );

  router.get(
    '/mempool',
    mempoolCacheHandler,
    asyncHandler(async (req, res, next) => {
      const limit = getPagingQueryLimit(ResourceType.Tx, req.query.limit);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);

      let addrParams: (string | undefined)[];
      try {
        addrParams = ['sender_address', 'recipient_address', 'address'].map(p => {
          const addr: string | undefined = req.query[p] as string;
          if (!addr) {
            return undefined;
          }
          switch (p) {
            case 'sender_address':
              if (!isValidC32Address(addr)) {
                throw new Error(
                  `Invalid query parameter for "${p}": "${addr}" is not a valid STX address`
                );
              }
              break;
            case 'recipient_address':
            case 'address':
              if (!(isValidC32Address(addr) || isValidPrincipal(addr))) {
                throw new Error(
                  `Invalid query parameter for "${p}": "${addr}" is not a valid STX address or principal`
                );
              }
              break;
          }
          return addr;
        });
      } catch (error) {
        throw new InvalidRequestError(`${error}`, InvalidRequestErrorType.invalid_param);
      }

      const includeUnanchored = isUnanchoredRequest(req, res, next);
      const [senderAddress, recipientAddress, address] = addrParams;
      if (address && (recipientAddress || senderAddress)) {
        throw new InvalidRequestError(
          'The "address" filter cannot be specified with other address filters',
          InvalidRequestErrorType.invalid_param
        );
      }

      const orderBy = req.query.order_by;
      if (
        orderBy !== undefined &&
        orderBy != MempoolOrderByParam.fee &&
        orderBy != MempoolOrderByParam.age &&
        orderBy != MempoolOrderByParam.size
      ) {
        throw new InvalidRequestError(
          `The "order_by" param can only be 'fee', 'age', or 'size'`,
          InvalidRequestErrorType.invalid_param
        );
      }
      const order = req.query.order;
      if (order !== undefined && order != OrderParam.asc && order != OrderParam.desc) {
        throw new InvalidRequestError(
          `The "order" param can only be 'asc' or 'desc'`,
          InvalidRequestErrorType.invalid_param
        );
      }

      const { results: txResults, total } = await db.getMempoolTxList({
        offset,
        limit,
        includeUnanchored,
        orderBy,
        order,
        senderAddress,
        recipientAddress,
        address,
      });

      const results = txResults.map(tx => parseDbMempoolTx(tx));
      const response: MempoolTransactionListResponse = { limit, offset, total, results };
      setETagCacheHeaders(res, ETagType.mempool);
      res.json(response);
    })
  );

  router.get(
    '/mempool/dropped',
    mempoolCacheHandler,
    asyncHandler(async (req, res) => {
      const limit = getPagingQueryLimit(ResourceType.Tx, req.query.limit);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);
      const { results: txResults, total } = await db.getDroppedTxs({
        offset,
        limit,
      });
      const results = txResults.map(tx => parseDbMempoolTx(tx));
      const response: MempoolTransactionListResponse = { limit, offset, total, results };
      setETagCacheHeaders(res, ETagType.mempool);
      res.json(response);
    })
  );

  router.get(
    '/mempool/stats',
    mempoolCacheHandler,
    asyncHandler(async (req, res) => {
      const queryResult = await db.getMempoolStats({ lastBlockCount: undefined });
      setETagCacheHeaders(res, ETagType.mempool);
      res.json(queryResult);
    })
  );

  router.get(
    '/events',
    cacheHandler,
    asyncHandler(async (req, res, next) => {
      const limit = getPagingQueryLimit(ResourceType.Tx, req.query['limit'], 100);
      const offset = parsePagingQueryInput(req.query['offset'] ?? 0);

      const principalOrTxId = parseAddressOrTxId(req, res, next);
      const eventTypeFilter = parseEventTypeFilter(req, res, next);

      const { results } = await db.getTransactionEvents({
        addressOrTxId: principalOrTxId,
        eventTypeFilter,
        offset,
        limit,
      });
      const response = { limit, offset, events: results.map(e => parseDbEvent(e)) };
      setETagCacheHeaders(res);
      res.status(200).json(response);
    })
  );

  router.get(
    '/:tx_id',
    txCacheHandler,
    asyncHandler(async (req, res, next) => {
      const { tx_id } = req.params;
      if (!has0xPrefix(tx_id)) {
        const baseURL = req.protocol + '://' + req.headers.host + '/';
        const url = new URL(req.url, baseURL);
        return res.redirect('/extended/v1/tx/0x' + tx_id + url.search);
      }

      const eventLimit = getPagingQueryLimit(ResourceType.Tx, req.query['event_limit'], 100);
      const eventOffset = parsePagingQueryInput(req.query['event_offset'] ?? 0);
      const includeUnanchored = isUnanchoredRequest(req, res, next);
      validateRequestHexInput(tx_id);

      const txQuery = await searchTx(db, {
        txId: tx_id,
        eventLimit,
        eventOffset,
        includeUnanchored,
      });
      if (!txQuery.found) {
        res.status(404).json({ error: `could not find transaction by ID ${tx_id}` });
        return;
      }
      setETagCacheHeaders(res, ETagType.transaction);
      res.json(txQuery.result);
    })
  );

  router.get(
    '/:tx_id/raw',
    txCacheHandler,
    asyncHandler(async (req, res) => {
      const { tx_id } = req.params;
      if (!has0xPrefix(tx_id)) {
        return res.redirect('/extended/v1/tx/0x' + tx_id + '/raw');
      }
      validateRequestHexInput(tx_id);

      const rawTxQuery = await db.getRawTx(tx_id);

      if (rawTxQuery.found) {
        const response: GetRawTransactionResult = {
          raw_tx: rawTxQuery.result.raw_tx,
        };
        setETagCacheHeaders(res, ETagType.transaction);
        res.json(response);
      } else {
        res.status(404).json({ error: `could not find transaction by ID ${tx_id}` });
      }
    })
  );

  router.get(
    '/block/:block_hash',
    cacheHandler,
    asyncHandler(async (req, res) => {
      const { block_hash } = req.params;

      const limit = getPagingQueryLimit(ResourceType.Tx, req.query['limit'], 200);
      const offset = parsePagingQueryInput(req.query['offset'] ?? 0);
      validateRequestHexInput(block_hash);
      const result = await db.getTxsFromBlock({ hash: block_hash }, limit, offset);
      if (!result.found) {
        res.status(404).json({ error: `no block found by hash ${block_hash}` });
        return;
      }
      const dbTxs = result.result;
      const results = dbTxs.results.map(dbTx => parseDbTx(dbTx));

      const response: TransactionResults = {
        limit: limit,
        offset: offset,
        total: dbTxs.total,
        results: results,
      };
      if (!isProdEnv) {
        const schemaPath =
          '@stacks/stacks-blockchain-api-types/api/transaction/get-transactions.schema.json';
        await validate(schemaPath, response);
      }
      setETagCacheHeaders(res);
      res.json(response);
    })
  );

  router.get(
    '/block_height/:height',
    cacheHandler,
    asyncHandler(async (req, res, next) => {
      const height = getBlockHeightPathParam(req, res, next);

      const limit = getPagingQueryLimit(ResourceType.Tx, req.query['limit']);
      const offset = parsePagingQueryInput(req.query['offset'] ?? 0);
      const result = await db.getTxsFromBlock({ height: height }, limit, offset);
      if (!result.found) {
        res.status(404).json({ error: `no block found at height ${height}` });
        return;
      }
      const dbTxs = result.result;
      const results = dbTxs.results.map(dbTx => parseDbTx(dbTx));

      const response: TransactionResults = {
        limit: limit,
        offset: offset,
        total: dbTxs.total,
        results: results,
      };
      if (!isProdEnv) {
        const schemaPath =
          '@stacks/stacks-blockchain-api-types/api/transaction/get-transactions.schema.json';
        await validate(schemaPath, response);
      }
      setETagCacheHeaders(res);
      res.json(response);
    })
  );

  return router;
}
