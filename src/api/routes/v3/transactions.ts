import { handleChainTipCache, handleTransactionCache } from '../../controllers/cache-controller.js';
import {
  serializeDbTransactionOrMempoolTransaction,
  serializeDbTransactionSummary,
} from '../../serializers/v3/transactions.js';
import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { getPagingQueryLimit, ResourceType } from '../../pagination.js';
import { TransactionSummarySchema } from '../../schemas/v3/entities/transaction-summaries.js';
import {
  CursorPaginatedResponse,
  CursorPaginationQuerystring,
  TransactionCursorSchema,
  TransactionEventCursorSchema,
} from '../../schemas/v3/cursors.js';
import { TransactionIdSchema } from '../../schemas/v3/entities/common.js';
import {
  TransactionIncludeFieldSchema,
  TransactionSchema,
} from '../../schemas/v3/entities/transactions.js';
import { MempoolTransactionSchema } from '../../schemas/v3/entities/mempool-transactions.js';
import { NotFoundError } from '../../../errors.js';
import { TransactionEventSchema } from '../../schemas/v3/entities/transaction-events.js';
import { serializeDbTransactionEvent } from '../../serializers/v3/transaction-events.js';
import { splitCommaSeparatedQueryParam } from '../../query-helpers.js';
import { TransactionIdsQuerystringParam } from '../../schemas/v3/params.js';

export const TransactionsRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/transactions',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_transactions',
        summary: 'Get transactions',
        description: `Retrieves a list of recently mined transactions`,
        tags: ['Transactions'],
        querystring: CursorPaginationQuerystring(TransactionCursorSchema, ResourceType.Tx),
        response: {
          200: CursorPaginatedResponse(
            TransactionSummarySchema,
            TransactionCursorSchema,
            ResourceType.Tx
          ),
        },
      },
    },
    async (req, reply) => {
      const results = await fastify.db.v3.getTransactionSummaries({
        limit: req.query.limit ?? getPagingQueryLimit(ResourceType.Tx),
        cursor: req.query.cursor,
      });
      await reply.send({
        limit: results.limit,
        total: results.total,
        cursor: {
          next: results.next_cursor,
          previous: results.prev_cursor,
          current: results.current_cursor,
        },
        results: results.results.map(r => serializeDbTransactionSummary(r)),
      });
    }
  );

  fastify.get(
    '/transactions/batch',
    {
      preHandler: handleChainTipCache,
      preValidation: splitCommaSeparatedQueryParam('tx_id'),
      schema: {
        operationId: 'get_transactions_batch',
        summary: 'Get a batch of transactions',
        description:
          'Retrieves the summaries of up to 20 mined transactions in a single call, given their ' +
          'transaction ids. Provide them as repeated querystring values (`?tx_id=A&tx_id=B`) or ' +
          'as a single comma-separated value (`?tx_id=A,B`). Results are returned in canonical ' +
          'chain order (newest first), not in the order the ids were supplied. Only transactions ' +
          'mined in the canonical chain are returned: an id that is unknown, non-canonical, or ' +
          'still in the mempool is absent from `results` rather than reported as an error, so ' +
          'compare the response against the ids you sent to find the ones that did not resolve. ' +
          'Use `GET /extended/v3/transactions/{tx_id}` for a single transaction, which also ' +
          'covers mempool transactions.',
        tags: ['Transactions'],
        querystring: Type.Object({
          tx_id: TransactionIdsQuerystringParam('Transaction ids to fetch summaries for.'),
        }),
        response: {
          200: Type.Object(
            {
              results: Type.Array(TransactionSummarySchema),
            },
            { title: 'TransactionBatchResponse' }
          ),
        },
      },
    },
    async (req, reply) => {
      const results = await fastify.db.v3.getTransactionSummariesByTxIds({
        txIds: req.query.tx_id,
      });
      await reply.send({ results: results.map(r => serializeDbTransactionSummary(r)) });
    }
  );

  fastify.get(
    '/transactions/:tx_id',
    {
      preHandler: handleTransactionCache,
      preValidation: splitCommaSeparatedQueryParam('include'),
      schema: {
        operationId: 'get_transaction',
        summary: 'Get transaction',
        description: `Retrieves details for a given transaction, including both mined and mempool transactions`,
        tags: ['Transactions'],
        params: Type.Object({
          tx_id: TransactionIdSchema,
        }),
        querystring: Type.Object({
          include: Type.Optional(
            Type.Array(TransactionIncludeFieldSchema, {
              uniqueItems: true,
              description:
                'Heavy fields to include in the response. Omitted by default to keep the ' +
                'payload lean. Provide as repeated querystring values ' +
                '(`?include=A&include=B`) or as a single comma-separated value ' +
                '(`?include=A,B`).',
            })
          ),
        }),
        response: {
          200: Type.Union([TransactionSchema, MempoolTransactionSchema]),
        },
      },
    },
    async (req, reply) => {
      const { tx_id } = req.params;
      const transaction = await fastify.db.v3.getTransaction({
        txId: tx_id,
        include: req.query.include,
      });
      if (!transaction) {
        throw new NotFoundError('Transaction not found');
      }
      const result = serializeDbTransactionOrMempoolTransaction(transaction, req.query.include);
      await reply.send(result);
    }
  );

  fastify.get(
    '/transactions/:tx_id/events',
    {
      preHandler: handleTransactionCache,
      schema: {
        operationId: 'get_transaction_events',
        summary: 'Get transaction events',
        description: `Retrieves events for a given transaction ID`,
        tags: ['Transactions'],
        params: Type.Object({
          tx_id: TransactionIdSchema,
        }),
        querystring: CursorPaginationQuerystring(TransactionEventCursorSchema, ResourceType.Event),
        response: {
          200: CursorPaginatedResponse(
            TransactionEventSchema,
            TransactionEventCursorSchema,
            ResourceType.Event
          ),
        },
      },
    },
    async (req, reply) => {
      const events = await fastify.db.v3.getTransactionEvents({
        txId: req.params.tx_id,
        limit: getPagingQueryLimit(ResourceType.Event, req.query.limit),
        cursor: req.query.cursor,
      });
      await reply.send({
        total: events.total,
        limit: events.limit,
        cursor: {
          next: events.next_cursor,
          previous: events.prev_cursor,
          current: events.current_cursor,
        },
        results: events.results.map(r => serializeDbTransactionEvent(r)),
      });
    }
  );

  await Promise.resolve();
};
