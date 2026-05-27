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
    '/transactions/:tx_id',
    {
      preHandler: handleTransactionCache,
      // Accept both repeated (`?include=A&include=B`) and comma-separated (`?include=A,B`)
      // forms. The repeated form is already an array via Fastify's qs parser; this hook
      // normalizes the comma-separated form. Mirrors the convention used by
      // `/principals/:principal/balance-changes`.
      preValidation: (req, _reply, done) => {
        if (typeof req.query.include === 'string') {
          req.query.include = (req.query.include as string).split(',') as typeof req.query.include;
        }
        done();
      },
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
