import { handlePrincipalCache } from '../../controllers/cache-controller.js';
import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { getPagingQueryLimit, ResourceType } from '../../pagination.js';
import { PrincipalSchema } from '../../schemas/v3/entities/common.js';
import {
  CursorPaginationQuerystring,
  CursorPaginatedResponse,
  TransactionCursorSchema,
} from '../../schemas/v3/params.js';
import { PrincipalTransactionSummarySchema } from '../../schemas/v3/entities/principal-transactions.js';
import { serializePrincipalTransactionSummary } from '../../serializers/transactions.js';

export const PrincipalsRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/principals/:principal/transactions',
    {
      preHandler: handlePrincipalCache,
      schema: {
        operationId: 'get_principal_transactions',
        summary: 'Get principal transactions',
        description: `Returns a list of confirmed transactions sent or received by a Stacks principal`,
        tags: ['Transactions'],
        params: Type.Object({ principal: PrincipalSchema }),
        querystring: CursorPaginationQuerystring(ResourceType.Tx, TransactionCursorSchema),
        response: {
          200: CursorPaginatedResponse(PrincipalTransactionSummarySchema),
        },
      },
    },
    async (req, reply) => {
      const results = await fastify.db.v3.getPrincipalTransactionSummaries({
        principal: req.params.principal,
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
        results: results.results.map(r => serializePrincipalTransactionSummary(r)),
      });
    }
  );

  await Promise.resolve();
};
