import { handlePrincipalCache } from '../../controllers/cache-controller.js';
import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { getPagingQueryLimit, pagingQueryLimits, ResourceType } from '../../pagination.js';
import { PrincipalSchema, TransactionIdSchema } from '../../schemas/v3/entities/common.js';
import {
  CursorPaginationQuerystring,
  CursorPaginatedResponse,
  TransactionCursorSchema,
  PrincipalTransactionBalanceChangeCursorSchema,
  PrincipalBalanceChangeCursorSchema,
} from '../../schemas/v3/params.js';
import { PrincipalTransactionSummarySchema } from '../../schemas/v3/entities/principal-transactions.js';
import {
  serializePrincipalBalanceChange,
  serializePrincipalTransactionBalanceChange,
  serializePrincipalTransactionSummary,
} from '../../serializers/transactions.js';
import {
  PrincipalBalanceChangeSchema,
  PrincipalTransactionBalanceChangeSchema,
} from '../../schemas/v3/entities/principal-balance-changes.js';

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
        results: results.results.map(r => serializePrincipalTransactionBalanceChange(r)),
      });
    }
  );

  fastify.get(
    '/principals/:principal/balance-changes',
    {
      preHandler: handlePrincipalCache,
      // Accept both repeated (`?tx_id=A&tx_id=B`) and comma-separated (`?tx_id=A,B`) forms.
      // The repeated form is already an array via Fastify's qs parser; this hook normalizes
      // the comma-separated form. Mirrors the convention used by `/extended/v1/tx/multiple`.
      preValidation: (req, _reply, done) => {
        if (typeof req.query.tx_id === 'string') {
          req.query.tx_id = (req.query.tx_id as string).split(',') as typeof req.query.tx_id;
        }
        done();
      },
      schema: {
        operationId: 'get_principal_balance_changes',
        summary: 'Get principal balance changes',
        description: `Returns the balance changes for a principal across one or more transactions, as a single paginated flat array ordered by chain position descending then by asset.`,
        tags: ['Transactions'],
        params: Type.Object({ principal: PrincipalSchema }),
        querystring: Type.Composite([
          CursorPaginationQuerystring(ResourceType.Tx, PrincipalBalanceChangeCursorSchema),
          Type.Object({
            tx_id: Type.Array(TransactionIdSchema, {
              minItems: 1,
              maxItems: pagingQueryLimits[ResourceType.Tx].maxLimit,
              description:
                'Transaction IDs to query balance changes for. Provide as repeated ' +
                'querystring values (`?tx_id=A&tx_id=B`) or as a single comma-separated ' +
                'value (`?tx_id=A,B`).',
            }),
          }),
        ]),
        response: {
          200: CursorPaginatedResponse(PrincipalBalanceChangeSchema),
        },
      },
    },
    async (req, reply) => {
      const results = await fastify.db.v3.getPrincipalBalanceChanges({
        principal: req.params.principal,
        tx_ids: req.query.tx_id,
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
        results: results.results.map(r => serializePrincipalBalanceChange(r)),
      });
    }
  );

  await Promise.resolve();
};
