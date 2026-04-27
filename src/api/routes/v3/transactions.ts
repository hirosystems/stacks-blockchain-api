import { handleChainTipCache } from '../../controllers/cache-controller.js';
import { parseDbTransactionSummary } from './helpers.js';
import { NotFoundError } from '../../../errors.js';
import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { getPagingQueryLimit, ResourceType } from '../../pagination.js';
import { PaginatedCursorResponse } from '../../schemas/util.js';
import { TransactionSummarySchema } from '../../schemas/entities/transaction-summaries.js';
import { LimitParam } from '../../schemas/params.js';

const TransactionSummaryCursorParamSchema = Type.String({
  pattern: '^\\d+:\\d+:\\d+$',
  description: 'Cursor for transaction summary pagination',
});

export const V3TransactionsRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/',
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
      const results = await fastify.db.v3.getTransactionSummaries({ ...query, limit });
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

  await Promise.resolve();
};
