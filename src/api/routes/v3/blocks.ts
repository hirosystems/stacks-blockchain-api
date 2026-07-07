import { handleBlockCache } from '../../controllers/cache-controller.js';
import { serializeDbTransactionSummary } from '../../serializers/v3/transactions.js';
import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { getPagingQueryLimit, ResourceType } from '../../pagination.js';
import { TransactionSummarySchema } from '../../schemas/v3/entities/transaction-summaries.js';
import {
  CursorPaginatedResponse,
  CursorPaginationQuerystring,
  TransactionCursorSchema,
} from '../../schemas/v3/cursors.js';
import { BlockHeightOrHashSchema } from '../../schemas/v3/entities/common.js';
import { parseBlockParam } from '../v2/schemas.js';
import { InvalidRequestError, NotFoundError } from '../../../errors.js';

export const BlocksRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/blocks/:height_or_hash/transactions',
    {
      preHandler: handleBlockCache,
      schema: {
        operationId: 'get_block_transactions',
        summary: 'Get block transactions',
        description: `Retrieves transactions confirmed in a single block`,
        tags: ['Transactions'],
        params: Type.Object({
          height_or_hash: BlockHeightOrHashSchema,
        }),
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
      try {
        const results = await fastify.db.v3.getBlockTransactionSummaries({
          block: parseBlockParam(req.params.height_or_hash),
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
      } catch (error) {
        if (error instanceof InvalidRequestError) {
          throw new NotFoundError('Block not found');
        }
        throw error;
      }
    }
  );

  await Promise.resolve();
};
