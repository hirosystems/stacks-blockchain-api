import { handleChainTipCache, handleTransactionCache } from '../../controllers/cache-controller.js';
import {
  parseDbTransactionOrMempoolTransaction,
  parseDbTransactionSummary,
} from '../../serializers/transactions.js';
import { NotFoundError } from '../../../errors.js';
import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { getPagingQueryLimit, ResourceType } from '../../pagination.js';
import { PaginatedCursorResponse } from '../../schemas/util.js';
import { TransactionSummarySchema } from '../../schemas/entities/v3/transaction-summaries.js';
import { LimitParam, TransactionIdParamSchema } from '../../schemas/params.js';
import { TransactionSchema } from '../../schemas/entities/v3/transactions.js';
import { MempoolTransactionSchema } from '../../schemas/entities/v3/mempool-transactions.js';

const TransactionSummaryCursorParamSchema = Type.String({
  pattern: '^\\d+:\\d+:\\d+$',
  description: 'Cursor for transaction summary pagination',
});

export const TransactionRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/transactions',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_transaction_summaries',
        summary: 'Get transaction summaries',
        description: `Retrieves a list of recently mined transaction summaries`,
        tags: ['Transactions'],
        querystring: Type.Object({
          limit: LimitParam(ResourceType.Tx),
          cursor: Type.Optional(TransactionSummaryCursorParamSchema),
        }),
        response: {
          200: PaginatedCursorResponse(TransactionSummarySchema),
        },
      },
    },
    async (req, reply) => {
      const query = req.query;
      const limit = getPagingQueryLimit(ResourceType.Tx, req.query.limit);
      const results = await fastify.db.v3.getTransactionSummaryList({ ...query, limit });
      if (query.cursor && !results.current_cursor) {
        throw new NotFoundError('Cursor not found');
      }
      await reply.send({
        limit: results.limit,
        offset: results.offset,
        total: results.total,
        next_cursor: results.next_cursor,
        prev_cursor: results.prev_cursor,
        cursor: results.current_cursor,
        results: results.results.map(r => parseDbTransactionSummary(r)),
      });
    }
  );

  fastify.get(
    '/transactions/:tx_id',
    {
      preHandler: handleTransactionCache,
      schema: {
        operationId: 'get_transaction_by_id',
        summary: 'Get transaction',
        description: `Retrieves details for a given transaction ID, including both mined and mempool transactions`,
        tags: ['Transactions'],
        params: Type.Object({
          tx_id: TransactionIdParamSchema,
        }),
        response: {
          200: Type.Union([TransactionSchema, MempoolTransactionSchema]),
        },
      },
    },
    async (req, reply) => {
      const { tx_id } = req.params;
      const transaction = await fastify.db.v3.getTransaction({ txId: tx_id });
      if (!transaction) {
        throw new NotFoundError('Transaction not found');
      }
      const result = parseDbTransactionOrMempoolTransaction(transaction);
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
          tx_id: TransactionIdParamSchema,
        }),
        querystring: Type.Object({
          limit: LimitParam(ResourceType.Event),
          cursor: Type.Optional(
            Type.String({
              pattern: '^\\d+$',
              description: 'Cursor for transaction event pagination',
            })
          ),
        }),
      },
    },
    async (req, reply) => {
      const { tx_id } = req.params;
      const query = req.query;
      const events = await fastify.db.v3.getTransactionEvents({
        txId: tx_id,
        limit: getPagingQueryLimit(ResourceType.Event, query.limit),
        cursor: query.cursor,
      });
      if (query.cursor && !events.current_cursor) {
        throw new NotFoundError('Cursor not found');
      }
      await reply.send(events);
    }
  );

  await Promise.resolve();
};
