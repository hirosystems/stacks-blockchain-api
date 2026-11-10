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
  RawTransactionSchema,
  TransactionIncludeFieldSchema,
  TransactionSchema,
} from '../../schemas/v3/entities/transactions.js';
import { MempoolTransactionSchema } from '../../schemas/v3/entities/mempool-transactions.js';
import { NotFoundError } from '../../../errors.js';
import {
  TransactionEventSchema,
  TransactionEventTypeSchema,
} from '../../schemas/v3/entities/transaction-events.js';
import { serializeDbTransactionEvent } from '../../serializers/v3/transaction-events.js';
import {
  redirectUnprefixedHashParams,
  splitCommaSeparatedQueryParam,
} from '../../query-helpers.js';
import {
  TransactionIdsQuerystringParam,
  TransactionTypeSchema,
  TransactionTypesQuerystringParam,
} from '../../schemas/v3/params.js';
import { getTxTypeId } from '../../controllers/db-controller.js';

export const TransactionsRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/transactions',
    {
      preHandler: handleChainTipCache,
      preValidation: splitCommaSeparatedQueryParam('type'),
      schema: {
        operationId: 'get_transactions',
        summary: 'Get transactions',
        description:
          'Retrieves a list of recently mined transactions, optionally restricted to some ' +
          'transaction types. Cursors are chain positions, so a cursor stays valid when the ' +
          '`type` filter changes: it resumes the new list at the same point in the chain. A ' +
          '`height:0:0` cursor with no transaction of a requested type at that exact position ' +
          'resumes at the top of that block instead.',
        tags: ['Transactions'],
        querystring: Type.Composite([
          CursorPaginationQuerystring(TransactionCursorSchema, ResourceType.Tx),
          Type.Object({
            type: TransactionTypesQuerystringParam(TransactionTypeSchema),
          }),
        ]),
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
        results: results.results.map(r => serializeDbTransactionSummary(r)),
      });
    }
  );

  fastify.get(
    '/transactions/batch',
    {
      onRequest: redirectUnprefixedHashParams({ query: ['tx_id'] }),
      preHandler: handleChainTipCache,
      preValidation: splitCommaSeparatedQueryParam('tx_id'),
      schema: {
        operationId: 'get_transactions_batch',
        summary: 'Get a batch of transactions',
        description:
          'Retrieves the summaries of up to 20 mined transactions in a single call, given their ' +
          'transaction ids. Provide them as repeated querystring values (`?tx_id=A&tx_id=B`) or ' +
          'as a single comma-separated value (`?tx_id=A,B`). Results are returned in canonical ' +
          'chain order (newest first), not in the order the ids were supplied. Only transactions ' +
          'mined in the canonical chain are returned: an id that is unknown, non-canonical, or ' +
          'still in the mempool is absent from `results` rather than reported as an error, so ' +
          'compare the response against the ids you sent to find the ones that did not resolve. ' +
          'Use `GET /extended/v3/transactions/{tx_id}` for a single transaction, which also ' +
          'covers mempool transactions.',
        tags: ['Transactions'],
        querystring: Type.Object({
          tx_id: TransactionIdsQuerystringParam('Transaction ids to fetch summaries for.'),
        }),
        response: {
          200: Type.Object(
            {
              results: Type.Array(TransactionSummarySchema),
            },
            { title: 'TransactionBatchResponse' }
          ),
        },
      },
    },
    async (req, reply) => {
      const results = await fastify.db.v3.getTransactionSummariesByTxIds({
        txIds: req.query.tx_id,
      });
      await reply.send({ results: results.map(r => serializeDbTransactionSummary(r)) });
    }
  );

  fastify.get(
    '/transactions/:tx_id',
    {
      onRequest: redirectUnprefixedHashParams({ params: ['tx_id'] }),
      preHandler: handleTransactionCache,
      preValidation: splitCommaSeparatedQueryParam('include'),
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
    '/transactions/:tx_id/raw',
    {
      onRequest: redirectUnprefixedHashParams({ params: ['tx_id'] }),
      preHandler: handleTransactionCache,
      schema: {
        operationId: 'get_raw_transaction',
        summary: 'Get raw transaction',
        description: `Retrieves the hex-encoded serialized bytes of a mined or mempool transaction`,
        tags: ['Transactions'],
        params: Type.Object({
          tx_id: TransactionIdSchema,
        }),
        response: {
          200: RawTransactionSchema,
        },
      },
    },
    async (req, reply) => {
      const raw = await fastify.db.v3.getRawTransaction({ txId: req.params.tx_id });
      if (!raw) {
        throw new NotFoundError('Transaction not found');
      }
      await reply.send({ raw });
    }
  );

  fastify.get(
    '/transactions/:tx_id/events',
    {
      onRequest: redirectUnprefixedHashParams({ params: ['tx_id'] }),
      preHandler: handleTransactionCache,
      preValidation: splitCommaSeparatedQueryParam('type'),
      schema: {
        operationId: 'get_transaction_events',
        summary: 'Get transaction events',
        description: `Retrieves events for a given transaction ID, optionally filtered by event type`,
        tags: ['Transactions'],
        params: Type.Object({
          tx_id: TransactionIdSchema,
        }),
        querystring: Type.Composite([
          CursorPaginationQuerystring(TransactionEventCursorSchema, ResourceType.Event),
          Type.Object({
            type: Type.Optional(
              Type.Array(TransactionEventTypeSchema, {
                minItems: 1,
                uniqueItems: true,
                description:
                  'Restricts results to these event types; `total` counts only the matching ' +
                  'events. Provide them as repeated querystring values ' +
                  '(`?type=ft_asset&type=nft_asset`) or as a single comma-separated value ' +
                  '(`?type=ft_asset,nft_asset`). Defaults to every type.',
              })
            ),
          }),
        ]),
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
        types: req.query.type,
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
