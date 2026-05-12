import { handlePrincipalCache } from '../../controllers/cache-controller.js';
import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { getPagingQueryLimit, ResourceType } from '../../pagination.js';
import { PrincipalSchema, TransactionIdSchema } from '../../schemas/v3/entities/common.js';
import {
  CursorPaginationQuerystring,
  CursorPaginatedResponse,
  TransactionCursorSchema,
  PrincipalTransactionBalanceChangeCursorSchema,
} from '../../schemas/v3/params.js';
import { PrincipalTransactionSummarySchema } from '../../schemas/v3/entities/principal-transactions.js';
import {
  parsePrincipalTransactionBalanceChange,
  parsePrincipalTransactionSummary,
} from '../../serializers/transactions.js';
import { PrincipalTransactionBalanceChangeSchema } from '../../schemas/v3/entities/principal-balance-changes.js';

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
        results: results.results.map(r => parsePrincipalTransactionSummary(r)),
      });
    }
  );

  fastify.get(
    '/principals/:principal/transactions/:tx_id/balance-changes',
    {
      // TODO: Etag should really be based on both the transaction id and principal.
      preHandler: handlePrincipalCache,
      schema: {
        operationId: 'get_principal_transaction_balance_changes',
        summary: 'Get principal transaction balance changes',
        description: `Returns the balance changes for a principal's transaction`,
        tags: ['Transactions'],
        params: Type.Object({ principal: PrincipalSchema, tx_id: TransactionIdSchema }),
        querystring: CursorPaginationQuerystring(
          ResourceType.Tx,
          PrincipalTransactionBalanceChangeCursorSchema
        ),
        response: {
          200: CursorPaginatedResponse(PrincipalTransactionBalanceChangeSchema),
        },
      },
    },
    async (req, reply) => {
      const results = await fastify.db.v3.getPrincipalTransactionBalanceChanges({
        principal: req.params.principal,
        tx_id: req.params.tx_id,
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
        results: results.results.map(r => parsePrincipalTransactionBalanceChange(r)),
      });
    }
  );

  await Promise.resolve();
};
