import { handleChainTipCache } from '../../controllers/cache-controller.js';
import { FastifyPluginAsync } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { getPagingQueryLimit, ResourceType } from '../../pagination.js';
import {
  CursorPaginatedResponse,
  CursorPaginationQuerystring,
  MempoolTransactionCursorSchema,
} from '../../schemas/v3/cursors.js';
import { serializeDbMempoolTransactionSummary } from '../../serializers/v3/mempool-transactions.js';
import { MempoolTransactionSummarySchema } from '../../schemas/v3/entities/mempool-transaction-summaries.js';

export const MempoolRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/mempool/transactions',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_mempool_transactions',
        summary: 'Get mempool transactions',
        description: `Retrieves a list of recently broadcasted transactions`,
        tags: ['Mempool'],
        querystring: CursorPaginationQuerystring(MempoolTransactionCursorSchema, ResourceType.Tx),
        response: {
          200: CursorPaginatedResponse(
            MempoolTransactionSummarySchema,
            MempoolTransactionCursorSchema,
            ResourceType.Tx
          ),
        },
      },
    },
    async (req, reply) => {
      const results = await fastify.db.v3.getMempoolTransactionSummaries({
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
        results: results.results.map(r => serializeDbMempoolTransactionSummary(r)),
      });
    }
  );

  await Promise.resolve();
};
