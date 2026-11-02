import { handleMempoolCache } from '../../controllers/cache-controller.js';
import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { getPagingQueryLimit, ResourceType } from '../../pagination.js';
import {
  CursorPaginatedResponse,
  CursorPaginationQuerystring,
  MempoolTransactionCursorSchema,
} from '../../schemas/v3/cursors.js';
import { serializeDbMempoolTransactionSummary } from '../../serializers/v3/mempool-transactions.js';
import { MempoolTransactionSummarySchema } from '../../schemas/v3/entities/mempool-transaction-summaries.js';
import { MempoolSummarySchema } from '../../schemas/v3/entities/mempool-summary.js';
import { serializeMempoolSummary } from '../../serializers/v3/mempool-summary.js';
import {
  MempoolTransactionTypeSchema,
  TransactionTypesQuerystringParam,
} from '../../schemas/v3/params.js';
import { getTxTypeId } from '../../controllers/db-controller.js';
import { splitCommaSeparatedQueryParam } from '../../query-helpers.js';

export const MempoolRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/mempool',
    {
      preHandler: handleMempoolCache,
      schema: {
        operationId: 'get_mempool_summary',
        summary: 'Get mempool summary',
        description:
          'Retrieves a summary of the transactions currently pending in the mempool: how many ' +
          'there are, and the fee, size, and receipt percentiles across them, both overall and ' +
          'broken down by transaction type. Percentiles are discrete: each is a value some ' +
          'pending transaction actually has, not an interpolation between two of them.',
        tags: ['Mempool'],
        response: {
          200: MempoolSummarySchema,
        },
      },
    },
    async (_req, reply) => {
      const rows = await fastify.db.v3.getMempoolSummary();
      await reply.send(serializeMempoolSummary(rows));
    }
  );

  fastify.get(
    '/mempool/transactions',
    {
      preHandler: handleMempoolCache,
      preValidation: splitCommaSeparatedQueryParam('type'),
      schema: {
        operationId: 'get_mempool_transactions',
        summary: 'Get mempool transactions',
        description:
          'Retrieves a list of recently broadcasted transactions, optionally restricted to some ' +
          'transaction types',
        tags: ['Mempool'],
        querystring: Type.Composite([
          CursorPaginationQuerystring(MempoolTransactionCursorSchema, ResourceType.Tx),
          Type.Object({
            type: TransactionTypesQuerystringParam(MempoolTransactionTypeSchema),
          }),
        ]),
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
        typeIds: req.query.type?.flatMap(t => getTxTypeId(t)),
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
