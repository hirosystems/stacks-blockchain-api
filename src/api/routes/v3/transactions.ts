import { handleChainTipCache } from '../../controllers/cache-controller.js';
import { serializeDbTransactionSummary } from '../../serializers/v3/transactions.js';
import { FastifyPluginAsync } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { getPagingQueryLimit, ResourceType } from '../../pagination.js';
import { TransactionSummarySchema } from '../../schemas/v3/entities/transaction-summaries.js';
import {
  CursorPaginatedResponse,
  CursorPaginationQuerystring,
  TransactionCursorSchema,
} from '../../schemas/v3/cursors.js';

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

  await Promise.resolve();
};
