import { handleBlockCache, handleChainTipCache } from '../../controllers/cache-controller.js';
import { serializeDbTransactionSummary } from '../../serializers/v3/transactions.js';
import { serializeDbBlock, serializeDbBlockSummary } from '../../serializers/v3/blocks.js';
import { BlockSchema } from '../../schemas/v3/entities/blocks.js';
import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { getPagingQueryLimit, ResourceType } from '../../pagination.js';
import { TransactionSummarySchema } from '../../schemas/v3/entities/transaction-summaries.js';
import {
  BlockCursorSchema,
  CursorPaginatedResponse,
  CursorPaginationQuerystring,
  TransactionCursorSchema,
} from '../../schemas/v3/cursors.js';
import { BlockHeightOrHashSchema, BlockSummarySchema } from '../../schemas/v3/entities/common.js';
import { parseBlockParam } from '../v2/schemas.js';
import { InvalidRequestError, NotFoundError } from '../../../errors.js';
import { redirectUnprefixedHashParams } from '../../query-helpers.js';

export const BlocksRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/blocks',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_stacks_blocks',
        summary: 'Get blocks',
        description: 'Retrieves the summaries of canonical Stacks blocks, newest first',
        tags: ['Blocks'],
        querystring: CursorPaginationQuerystring(BlockCursorSchema, ResourceType.Block),
        response: {
          200: CursorPaginatedResponse(BlockSummarySchema, BlockCursorSchema, ResourceType.Block),
        },
      },
    },
    async (req, reply) => {
      const results = await fastify.db.v3.getBlockSummaries({
        limit: req.query.limit ?? getPagingQueryLimit(ResourceType.Block),
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
        results: results.results.map(r => serializeDbBlockSummary(r)),
      });
    }
  );

  fastify.get(
    '/blocks/:height_or_hash',
    {
      onRequest: redirectUnprefixedHashParams({ params: ['height_or_hash'] }),
      preHandler: handleBlockCache,
      schema: {
        operationId: 'get_stacks_block',
        summary: 'Get block',
        description:
          'Retrieves a single canonical Stacks block with its details, by height, block hash, ' +
          'index block hash, or `latest`',
        tags: ['Blocks'],
        params: Type.Object({
          height_or_hash: BlockHeightOrHashSchema,
        }),
        response: {
          200: BlockSchema,
        },
      },
    },
    async (req, reply) => {
      const block = await fastify.db.v3.getBlock({
        block: parseBlockParam(req.params.height_or_hash),
      });
      if (!block) {
        throw new NotFoundError('Block not found');
      }
      await reply.send(serializeDbBlock(block));
    }
  );

  fastify.get(
    '/blocks/:height_or_hash/transactions',
    {
      onRequest: redirectUnprefixedHashParams({ params: ['height_or_hash'] }),
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
