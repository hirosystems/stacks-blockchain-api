import {
  parseTxTypeStrings,
  parseDbMempoolTx,
  searchTx,
  searchTxs,
  parseDbTx,
  parseDbEvent,
} from '../controllers/db-controller';
import { isValidC32Address, isValidPrincipal, parseEventTypeStrings } from '../../helpers';
import { InvalidRequestError, InvalidRequestErrorType, NotFoundError } from '../../errors';
import { validateRequestHexInput, validatePrincipal } from '../query-helpers';
import { getPagingQueryLimit, parsePagingQueryInput, ResourceType } from '../pagination';
import {
  handleChainTipCache,
  handleMempoolCache,
  handleTransactionCache,
} from '../controllers/cache-controller';
import { DbEventTypeId } from '../../datastore/common';
import { has0xPrefix } from '@hirosystems/api-toolkit';

import { FastifyPluginAsync } from 'fastify';
import { Server } from 'node:http';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import {
  AddressParamSchema,
  BlockHeightSchema,
  LimitParam,
  MempoolOrderByParamSchema,
  OffsetParam,
  OrderParamSchema,
  PrincipalSchema,
  TransactionIdParamSchema,
  UnanchoredParamSchema,
} from '../schemas/params';
import {
  AbstractMempoolTransactionProperties,
  BaseTransactionSchemaProperties,
  MempoolTransaction,
  MempoolTransactionSchema,
  TokenTransferTransactionMetadataProperties,
  Transaction,
  TransactionSchema,
  TransactionSearchResponseSchema,
  TransactionTypeSchema,
} from '../schemas/entities/transactions';
import { PaginatedResponse } from '../schemas/util';
import {
  ErrorResponseSchema,
  MempoolStatsResponseSchema,
  MempoolTransactionListResponse,
  RawTransactionResponseSchema,
  TransactionEventsResponseSchema,
  TransactionResultsSchema,
} from '../schemas/responses/responses';
import { TransactionEventTypeSchema } from '../schemas/entities/transaction-events';

export const TxRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/',
    {
      preHandler: handleChainTipCache,
      preValidation: (req, _reply, done) => {
        if (typeof req.query.type === 'string') {
          req.query.type = (req.query.type as string).split(',') as typeof req.query.type;
        }
        done();
      },
      schema: {
        operationId: 'get_transaction_list',
        summary: 'Get recent transactions',
        description: `Retrieves all recently mined transactions`,
        tags: ['Transactions'],
        querystring: Type.Object({
          offset: OffsetParam(),
          limit: LimitParam(ResourceType.Tx),
          type: Type.Optional(Type.Array(TransactionTypeSchema)),
          unanchored: UnanchoredParamSchema,
          order: Type.Optional(Type.Enum({ asc: 'asc', desc: 'desc' })),
          sort_by: Type.Optional(
            Type.Enum(
              {
                block_height: 'block_height',
                burn_block_time: 'burn_block_time',
                fee: 'fee',
              },
              {
                default: 'block_height',
                description: 'Option to sort results by block height, timestamp, or fee',
              }
            )
          ),
          from_address: Type.Optional(
            Type.String({ description: 'Option to filter results by sender address' })
          ),
          to_address: Type.Optional(
            Type.String({ description: 'Option to filter results by recipient address' })
          ),
          start_time: Type.Optional(
            Type.Integer({
              description:
                'Filter by transactions after this timestamp (unix timestamp in seconds)',
              examples: [1704067200],
            })
          ),
          end_time: Type.Optional(
            Type.Integer({
              description:
                'Filter by transactions before this timestamp (unix timestamp in seconds)',
              examples: [1706745599],
            })
          ),
          contract_id: Type.Optional(
            Type.String({
              description: 'Option to filter results by contract ID',
              examples: ['SP000000000000000000002Q6VF78.pox-4'],
            })
          ),
          function_name: Type.Optional(
            Type.String({
              description: 'Filter by contract call transactions involving this function name',
              examples: ['delegate-stx'],
            })
          ),
          nonce: Type.Optional(
            Type.Integer({
              description: 'Filter by transactions with this nonce',
              minimum: 0,
              maximum: Number.MAX_SAFE_INTEGER,
              examples: [123],
            })
          ),
        }),
        response: {
          200: TransactionResultsSchema,
        },
      },
    },
    async (req, reply) => {
      const limit = getPagingQueryLimit(ResourceType.Tx, req.query.limit);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);

      const txTypeFilter = parseTxTypeStrings(req.query.type ?? []);

      let fromAddress: string | undefined;
      if (typeof req.query.from_address === 'string') {
        if (!isValidC32Address(req.query.from_address)) {
          throw new InvalidRequestError(
            `Invalid query parameter for "from_address": "${req.query.from_address}" is not a valid STX address`,
            InvalidRequestErrorType.invalid_param
          );
        }
        fromAddress = req.query.from_address;
      }

      let toAddress: string | undefined;
      if (typeof req.query.to_address === 'string') {
        if (!isValidPrincipal(req.query.to_address)) {
          throw new InvalidRequestError(
            `Invalid query parameter for "to_address": "${req.query.to_address}" is not a valid STX address`,
            InvalidRequestErrorType.invalid_param
          );
        }
        toAddress = req.query.to_address;
      }

      let contractId: string | undefined;
      if (typeof req.query.contract_id === 'string') {
        if (!isValidPrincipal(req.query.contract_id)) {
          throw new InvalidRequestError(
            `Invalid query parameter for "contract_id": "${req.query.contract_id}" is not a valid principal`,
            InvalidRequestErrorType.invalid_param
          );
        }
        contractId = req.query.contract_id;
      }

      const { results: txResults, total } = await fastify.db.getTxList({
        offset,
        limit,
        txTypeFilter,
        includeUnanchored: req.query.unanchored ?? false,
        fromAddress,
        toAddress,
        startTime: req.query.start_time,
        endTime: req.query.end_time,
        contractId,
        functionName: req.query.function_name,
        nonce: req.query.nonce,
        order: req.query.order,
        sortBy: req.query.sort_by,
      });
      const results = txResults.map(tx => parseDbTx(tx));
      await reply.send({ limit, offset, total, results });
    }
  );

  fastify.get(
    '/multiple',
    {
      preHandler: handleMempoolCache,
      preValidation: (req, _reply, done) => {
        if (typeof req.query.tx_id === 'string') {
          req.query.tx_id = (req.query.tx_id as string).split(',') as typeof req.query.tx_id;
        }
        done();
      },
      schema: {
        operationId: 'get_tx_list_details',
        summary: 'Get list of details for transactions',
        description: `Retrieves a list of transactions for a given list of transaction IDs`,
        tags: ['Transactions'],
        querystring: Type.Object({
          tx_id: Type.Array(TransactionIdParamSchema),
          event_limit: LimitParam(ResourceType.Event),
          event_offset: OffsetParam(),
          unanchored: UnanchoredParamSchema,
        }),
        response: {
          200: TransactionSearchResponseSchema,
        },
      },
    },
    async (req, reply) => {
      const eventLimit = getPagingQueryLimit(ResourceType.Event, req.query.event_limit);
      const eventOffset = parsePagingQueryInput(req.query.event_offset ?? 0);
      const includeUnanchored = req.query.unanchored ?? false;
      req.query.tx_id.forEach(tx => validateRequestHexInput(tx));
      const txQuery = await searchTxs(fastify.db, {
        txIds: req.query.tx_id,
        eventLimit,
        eventOffset,
        includeUnanchored,
      });
      await reply.send(txQuery);
    }
  );

  fastify.get(
    '/mempool',
    {
      preHandler: handleMempoolCache,
      schema: {
        operationId: 'get_mempool_transaction_list',
        summary: 'Get mempool transactions',
        description: `Retrieves all transactions that have been recently broadcast to the mempool. These are pending transactions awaiting confirmation.

        If you need to monitor new transactions, we highly recommend subscribing to [WebSockets or Socket.io](https://github.com/hirosystems/stacks-blockchain-api/tree/master/client) for real-time updates.`,
        tags: ['Transactions'],
        querystring: Type.Object({
          sender_address: Type.Optional(AddressParamSchema),
          recipient_address: Type.Optional(AddressParamSchema),
          address: Type.Optional(AddressParamSchema),
          order_by: Type.Optional(MempoolOrderByParamSchema),
          order: Type.Optional(OrderParamSchema),
          unanchored: UnanchoredParamSchema,
          offset: OffsetParam(),
          limit: LimitParam(ResourceType.Tx),
        }),
        response: {
          200: MempoolTransactionListResponse,
        },
      },
    },
    async (req, reply) => {
      const limit = getPagingQueryLimit(ResourceType.Tx, req.query.limit);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);

      const addrParams: (string | undefined)[] = [
        req.query.sender_address,
        req.query.recipient_address,
        req.query.address,
      ];
      try {
        addrParams.forEach(addr => {
          if (!addr) {
            return undefined;
          }
          if (!isValidPrincipal(addr)) {
            throw new Error(
              `Invalid query parameter: "${addr}" is not a valid STX address or principal`
            );
          }
        });
      } catch (error) {
        throw new InvalidRequestError(`${error}`, InvalidRequestErrorType.invalid_param);
      }

      const includeUnanchored = req.query.unanchored ?? false;
      const [senderAddress, recipientAddress, address] = addrParams;
      if (address && (recipientAddress || senderAddress)) {
        throw new InvalidRequestError(
          'The "address" filter cannot be specified with other address filters',
          InvalidRequestErrorType.invalid_param
        );
      }

      const orderBy = req.query.order_by;
      const order = req.query.order;

      const { results: txResults, total } = await fastify.db.getMempoolTxList({
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
      const response = { limit, offset, total, results };
      await reply.send(response);
    }
  );

  fastify.get(
    '/mempool/dropped',
    {
      preHandler: handleMempoolCache,
      schema: {
        operationId: 'get_dropped_mempool_transaction_list',
        summary: 'Get dropped mempool transactions',
        description: `Retrieves all recently-broadcast transactions that have been dropped from the mempool.

        Transactions are dropped from the mempool if:
         * they were stale and awaiting garbage collection or,
         * were expensive, or
         * were replaced with a new fee`,
        tags: ['Transactions'],
        querystring: Type.Object({
          offset: OffsetParam(),
          limit: LimitParam(ResourceType.Tx),
        }),
        response: {
          200: PaginatedResponse(MempoolTransactionSchema, {
            description: 'List of dropped mempool transactions',
          }),
        },
      },
    },
    async (req, reply) => {
      const limit = getPagingQueryLimit(ResourceType.Tx, req.query.limit);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);
      const { results: txResults, total } = await fastify.db.getDroppedTxs({
        offset,
        limit,
      });
      const results = txResults.map(tx => parseDbMempoolTx(tx));
      const response = { limit, offset, total, results };
      await reply.send(response);
    }
  );

  fastify.get(
    '/mempool/stats',
    {
      preHandler: handleMempoolCache,
      schema: {
        operationId: 'get_mempool_transaction_stats',
        summary: 'Get statistics for mempool transactions',
        description: `Queries for transactions counts, age (by block height), fees (simple average), and size.
        All results broken down by transaction type and percentiles (p25, p50, p75, p95).`,
        tags: ['Transactions'],
        response: {
          200: MempoolStatsResponseSchema,
        },
      },
    },
    async (_req, reply) => {
      const queryResult = await fastify.db.getMempoolStats({ lastBlockCount: undefined });
      await reply.send(queryResult);
    }
  );

  fastify.get(
    '/events',
    {
      preHandler: handleChainTipCache,
      preValidation: (req, _reply, done) => {
        if (typeof req.query.type === 'string') {
          req.query.type = (req.query.type as string).split(',') as typeof req.query.type;
        }
        done();
      },
      schema: {
        operationId: 'get_filtered_events',
        summary: 'Transaction Events',
        description: `Retrieves the list of events filtered by principal (STX address or Smart Contract ID), transaction id or event types.
        The list of event types is ('smart_contract_log', 'stx_lock', 'stx_asset', 'fungible_token_asset', 'non_fungible_token_asset').`,
        tags: ['Transactions'],
        querystring: Type.Object({
          tx_id: Type.Optional(TransactionIdParamSchema),
          address: Type.Optional(PrincipalSchema),
          type: Type.Optional(Type.Array(TransactionEventTypeSchema)),
          offset: OffsetParam(),
          limit: LimitParam(ResourceType.Event, undefined, undefined, 100),
        }),
        response: {
          200: TransactionEventsResponseSchema,
        },
      },
    },
    async (req, reply) => {
      const limit = getPagingQueryLimit(ResourceType.Tx, req.query.limit, 100);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);

      const addrOrTx = {
        address: req.query.address,
        txId: req.query.tx_id,
      } as { address: string; txId: undefined } | { address: undefined; txId: string };
      if (!addrOrTx.address && !addrOrTx.txId) {
        throw new InvalidRequestError(
          `can not find 'address' or 'tx_id' in the request`,
          InvalidRequestErrorType.bad_request
        );
      }
      if (addrOrTx.address && addrOrTx.txId) {
        // if mutually exclusive address and txId specified throw
        throw new InvalidRequestError(
          `can't handle both 'address' and 'tx_id' in the same request`,
          InvalidRequestErrorType.bad_request
        );
      }
      if (addrOrTx.address) {
        validatePrincipal(addrOrTx.address);
      }
      if (addrOrTx.txId) {
        addrOrTx.txId = has0xPrefix(addrOrTx.txId) ? addrOrTx.txId : '0x' + addrOrTx.txId;
        validateRequestHexInput(addrOrTx.txId);
      }

      const typeQuery = req.query.type;
      let eventTypeFilter: DbEventTypeId[];
      if (typeQuery && typeQuery.length > 0) {
        try {
          eventTypeFilter = parseEventTypeStrings(typeQuery);
        } catch (error) {
          throw new InvalidRequestError(
            `invalid 'event type'`,
            InvalidRequestErrorType.bad_request
          );
        }
      } else {
        eventTypeFilter = [
          DbEventTypeId.SmartContractLog,
          DbEventTypeId.StxAsset,
          DbEventTypeId.FungibleTokenAsset,
          DbEventTypeId.NonFungibleTokenAsset,
          DbEventTypeId.StxLock,
        ]; //no filter provided , return all types of events
      }

      const { results } = await fastify.db.getTransactionEvents({
        addressOrTxId: addrOrTx,
        eventTypeFilter,
        offset,
        limit,
      });
      await reply.send({ limit, offset, events: results.map(e => parseDbEvent(e)) });
    }
  );

  fastify.get(
    '/:tx_id',
    {
      preHandler: handleTransactionCache,
      schema: {
        operationId: 'get_transaction_by_id',
        summary: 'Get transaction',
        description: `Retrieves transaction details for a given transaction ID`,
        tags: ['Transactions'],
        params: Type.Object({
          tx_id: TransactionIdParamSchema,
        }),
        querystring: Type.Object({
          event_limit: LimitParam(ResourceType.Event, undefined, undefined, 100),
          event_offset: OffsetParam(),
          unanchored: UnanchoredParamSchema,
        }),
        response: {
          200: Type.Union([TransactionSchema, MempoolTransactionSchema]),
        },
      },
    },
    async (req, reply) => {
      const { tx_id } = req.params;
      if (!has0xPrefix(tx_id)) {
        const baseURL = req.protocol + '://' + req.headers.host + '/';
        const url = new URL(req.url, baseURL);
        return reply.redirect('/extended/v1/tx/0x' + req.params.tx_id + url.search);
      }

      const eventLimit = getPagingQueryLimit(ResourceType.Event, req.query['event_limit'], 100);
      const eventOffset = parsePagingQueryInput(req.query['event_offset'] ?? 0);
      const includeUnanchored = req.query.unanchored ?? false;
      validateRequestHexInput(tx_id);

      const txQuery = await searchTx(fastify.db, {
        txId: tx_id,
        eventLimit,
        eventOffset,
        includeUnanchored,
      });
      if (!txQuery.found) {
        throw new NotFoundError(`could not find transaction by ID`);
      }
      const result: Transaction | MempoolTransaction = txQuery.result;
      await reply.send(result);
    }
  );

  fastify.get(
    '/:tx_id/raw',
    {
      preHandler: handleTransactionCache,
      schema: {
        operationId: 'get_raw_transaction_by_id',
        summary: 'Get raw transaction',
        description: `Retrieves a hex encoded serialized transaction for a given ID`,
        tags: ['Transactions'],
        params: Type.Object({
          tx_id: TransactionIdParamSchema,
        }),
        querystring: Type.Object({
          event_limit: LimitParam(ResourceType.Event),
          event_offset: OffsetParam(),
        }),
        response: {
          200: RawTransactionResponseSchema,
        },
      },
    },
    async (req, reply) => {
      const { tx_id } = req.params;
      if (!has0xPrefix(tx_id)) {
        return reply.redirect('/extended/v1/tx/0x' + tx_id + '/raw');
      }
      validateRequestHexInput(tx_id);

      const rawTxQuery = await fastify.db.getRawTx(tx_id);

      if (rawTxQuery.found) {
        const response = {
          raw_tx: rawTxQuery.result.raw_tx,
        };
        await reply.send(response);
      } else {
        throw new NotFoundError(`could not find raw transaction by ID`);
      }
    }
  );

  fastify.get(
    '/block/:block_hash',
    {
      preHandler: handleChainTipCache,
      schema: {
        deprecated: true,
        operationId: 'get_transactions_by_block_hash',
        summary: 'Transactions by block hash',
        description: `**NOTE:** This endpoint is deprecated in favor of [Get transactions by block](/api/get-transactions-by-block).

        Retrieves a list of all transactions within a block for a given block hash.`,
        tags: ['Transactions'],
        params: Type.Object({
          block_hash: Type.String(),
        }),
        querystring: Type.Object({
          offset: OffsetParam(),
          limit: LimitParam(ResourceType.Tx, undefined, undefined, 200),
        }),
        response: {
          200: PaginatedResponse(TransactionSchema, { description: 'List of transactions' }),
        },
      },
    },
    async (req, reply) => {
      const { block_hash } = req.params;

      const limit = getPagingQueryLimit(ResourceType.Tx, req.query['limit'], 200);
      const offset = parsePagingQueryInput(req.query['offset'] ?? 0);
      validateRequestHexInput(block_hash);
      const result = await fastify.db.getTxsFromBlock({ hash: block_hash }, limit, offset);
      if (!result.found) {
        throw new NotFoundError(`no block found by hash`);
      }
      const dbTxs = result.result;
      const results = dbTxs.results.map(dbTx => parseDbTx(dbTx));

      await reply.send({
        limit: limit,
        offset: offset,
        total: dbTxs.total,
        results: results,
      });
    }
  );

  fastify.get(
    '/block_height/:height',
    {
      preHandler: handleChainTipCache,
      schema: {
        deprecated: true,
        operationId: 'get_transactions_by_block_height',
        summary: 'Transactions by block height',
        description: `**NOTE:** This endpoint is deprecated in favor of [Get transactions by block](/api/get-transactions-by-block).

        Retrieves all transactions within a block at a given height`,
        tags: ['Transactions'],
        params: Type.Object({
          height: BlockHeightSchema,
        }),
        querystring: Type.Object({
          offset: OffsetParam(),
          limit: LimitParam(ResourceType.Tx),
        }),
        response: {
          200: PaginatedResponse(TransactionSchema, { description: 'List of transactions' }),
        },
      },
    },
    async (req, reply) => {
      const height = req.params.height;

      const limit = getPagingQueryLimit(ResourceType.Tx, req.query['limit']);
      const offset = parsePagingQueryInput(req.query['offset'] ?? 0);
      const result = await fastify.db.getTxsFromBlock({ height: height }, limit, offset);
      if (!result.found) {
        throw new NotFoundError(`no block found at height ${height}`);
      }
      const dbTxs = result.result;
      const results = dbTxs.results.map(dbTx => parseDbTx(dbTx));

      await reply.send({
        limit: limit,
        offset: offset,
        total: dbTxs.total,
        results: results,
      });
    }
  );

  await Promise.resolve();
};
