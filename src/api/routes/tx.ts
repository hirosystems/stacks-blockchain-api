import * as express from 'express';
import { asyncHandler } from '../async-handler';
import { DataStore, DbTx, DbMempoolTx } from '../../datastore/common';
import {
  getTxFromDataStore,
  parseTxTypeStrings,
  parseDbMempoolTx,
  searchTx,
  searchTxs,
  parseDbTx,
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

export function createTxRouter(db: DataStore): express.Router {
  const router = express.Router();

  const cacheHandler = getChainTipCacheHandler(db);

  router.get(
    '/',
    cacheHandler,
    asyncHandler(async (req, res, next) => {
      const limit = parseTxQueryLimit(req.query.limit ?? 96);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);

      const typeQuery = req.query.type;
      let txTypeFilter: TransactionType[];
      if (Array.isArray(typeQuery)) {
        txTypeFilter = parseTxTypeStrings(typeQuery as string[]);
      } else if (typeof typeQuery === 'string') {
        txTypeFilter = parseTxTypeStrings([typeQuery]);
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
      setChainTipCacheHeaders(res);
      res.json(response);
    })
  );

  router.get(
    '/multiple',
    asyncHandler(async (req, res, next) => {
      if (typeof req.query.tx_id === 'string') {
        // in case req.query.tx_id is a single tx_id string and not an array
        req.query.tx_id = [req.query.tx_id];
      }
      const txList: string[] = req.query.tx_id as string[];
      const eventLimit = parseTxQueryEventsLimit(req.query['event_limit'] ?? 96);
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
    asyncHandler(async (req, res, next) => {
      const limit = parseTxQueryLimit(req.query.limit ?? 96);
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
      const { results: txResults, total } = await db.getMempoolTxList({
        offset,
        limit,
        includeUnanchored,
        senderAddress,
        recipientAddress,
        address,
      });

      const results = txResults.map(tx => parseDbMempoolTx(tx));
      const response: MempoolTransactionListResponse = { limit, offset, total, results };
      res.json(response);
    })
  );

  router.get(
    '/mempool/dropped',
    asyncHandler(async (req, res) => {
      const limit = parseTxQueryLimit(req.query.limit ?? 96);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);
      const { results: txResults, total } = await db.getDroppedTxs({
        offset,
        limit,
      });
      const results = txResults.map(tx => parseDbMempoolTx(tx));
      const response: MempoolTransactionListResponse = { limit, offset, total, results };
      res.json(response);
    })
  );

  router.get(
    '/stream',
    asyncHandler(async (req, res) => {
      const protocol = req.query['protocol'];
      const useEventSource = protocol === 'eventsource';
      const useWebSocket = protocol === 'websocket';
      if (!useEventSource && !useWebSocket) {
        throw new Error(`Unsupported stream protocol "${protocol}"`);
      }

      if (useEventSource) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });
      } else if (useWebSocket) {
        throw new Error('WebSocket stream not yet implemented');
      }

      const dbTxUpdate = async (txId: string): Promise<void> => {
        try {
          const txQuery = await searchTx(db, { txId, includeUnanchored: true });
          if (!txQuery.found) {
            throw new Error('error in tx stream, tx not found');
          }
          if (useEventSource) {
            res.write(`event: tx\ndata: ${JSON.stringify(txQuery.result)}\n\n`);
          }
        } catch (error) {
          // TODO: real error handling
          logError('error streaming tx updates', error);
        }
      };

      // EventEmitters don't like being passed Promise functions so wrap the async handler
      const onTxUpdate = (txId: string): void => {
        void dbTxUpdate(txId);
      };

      const endWaiter = waiter();
      db.addListener('txUpdate', onTxUpdate);
      res.on('close', () => {
        endWaiter.finish();
        db.removeListener('txUpdate', onTxUpdate);
      });
      await endWaiter;
    })
  );

  router.get(
    '/:tx_id',
    asyncHandler(async (req, res, next) => {
      const { tx_id } = req.params;
      if (!has0xPrefix(tx_id)) {
        return res.redirect('/extended/v1/tx/0x' + tx_id);
      }

      const eventLimit = parseTxQueryEventsLimit(req.query['event_limit'] ?? 96);
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
      // TODO: this validation needs fixed now that the mempool-tx and mined-tx types no longer overlap
      /*
    const schemaPath = require.resolve(
      '@stacks/stacks-blockchain-api-types/entities/transactions/transaction.schema.json'
    );
    await validate(schemaPath, txQuery.result);
    */
      res.json(txQuery.result);
    })
  );

  router.get(
    '/:tx_id/raw',
    asyncHandler(async (req, res) => {
      const { tx_id } = req.params;
      if (!has0xPrefix(tx_id)) {
        return res.redirect('/extended/v1/tx/0x' + tx_id + '/raw');
      }
      validateRequestHexInput(tx_id);

      const rawTxQuery = await db.getRawTx(tx_id);

      if (rawTxQuery.found) {
        const response: GetRawTransactionResult = {
          raw_tx: bufferToHexPrefixString(rawTxQuery.result.raw_tx),
        };
        res.json(response);
      } else {
        res.status(404).json({ error: `could not find transaction by ID ${tx_id}` });
      }
    })
  );

  router.get(
    '/block/:block_hash',
    asyncHandler(async (req, res) => {
      const { block_hash } = req.params;
      const limit = parseTxQueryEventsLimit(req.query['limit'] ?? 96);
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
      res.json(response);
    })
  );

  router.get(
    '/block_height/:height',
    asyncHandler(async (req, res, next) => {
      const height = getBlockHeightPathParam(req, res, next);
      const limit = parseTxQueryEventsLimit(req.query['limit'] ?? 96);
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
      res.json(response);
    })
  );

  return router;
}
