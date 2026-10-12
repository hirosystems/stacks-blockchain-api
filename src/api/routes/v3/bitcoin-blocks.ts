import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import {
  handleBurnchainChainTipCache,
  handleChainTipWithBurnchainTipCache,
} from '../../controllers/cache-controller.js';
import { getPagingQueryLimit, ResourceType } from '../../pagination.js';
import {
  BitcoinBlockCursorSchema,
  BlockCursorSchema,
  CursorPaginatedResponse,
  CursorPaginationQuerystring,
} from '../../schemas/v3/cursors.js';
import {
  BitcoinBlockSummarySchema,
  BlockHeightOrHashSchema,
  BlockSummarySchema,
} from '../../schemas/v3/entities/common.js';
import {
  serializeDbBitcoinBlockSummary,
  serializeDbBlockSummary,
} from '../../serializers/v3/blocks.js';
import { parseBlockParam } from '../v2/schemas.js';
import { NotFoundError } from '../../../errors.js';
import { redirectUnprefixedHashParams } from '../../query-helpers.js';

export const BitcoinBlocksRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/bitcoin-blocks',
    {
      preHandler: handleBurnchainChainTipCache,
      schema: {
        operationId: 'get_bitcoin_blocks',
        summary: 'Get Bitcoin blocks',
        description: 'Retrieves the summaries of canonical Bitcoin blocks, newest first',
        tags: ['Bitcoin Blocks'],
        querystring: CursorPaginationQuerystring(BitcoinBlockCursorSchema, ResourceType.BurnBlock),
        response: {
          200: CursorPaginatedResponse(
            BitcoinBlockSummarySchema,
            BitcoinBlockCursorSchema,
            ResourceType.BurnBlock
          ),
        },
      },
    },
    async (req, reply) => {
      const results = await fastify.db.v3.getBitcoinBlockSummaries({
        limit: req.query.limit ?? getPagingQueryLimit(ResourceType.BurnBlock),
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
        results: results.results.map(r => serializeDbBitcoinBlockSummary(r)),
      });
    }
  );

  fastify.get(
    '/bitcoin-blocks/:height_or_hash',
    {
      onRequest: redirectUnprefixedHashParams({ params: ['height_or_hash'] }),
      preHandler: handleBurnchainChainTipCache,
      schema: {
        operationId: 'get_bitcoin_block',
        summary: 'Get Bitcoin block',
        description:
          'Retrieves the summary of a single canonical Bitcoin block, by height, hash, or `latest`',
        tags: ['Bitcoin Blocks'],
        params: Type.Object({
          height_or_hash: BlockHeightOrHashSchema,
        }),
        response: {
          200: BitcoinBlockSummarySchema,
        },
      },
    },
    async (req, reply) => {
      const block = await fastify.db.v3.getBitcoinBlockSummary({
        block: parseBlockParam(req.params.height_or_hash),
      });
      if (!block) {
        throw new NotFoundError('Bitcoin block not found');
      }
      await reply.send(serializeDbBitcoinBlockSummary(block));
    }
  );

  fastify.get(
    '/bitcoin-blocks/:height_or_hash/blocks',
    {
      onRequest: redirectUnprefixedHashParams({ params: ['height_or_hash'] }),
      // Stacks blocks keep arriving for the current Bitcoin block, and a Bitcoin fork can replace
      // the block a height or `latest` resolves to, so both tips feed the ETag.
      preHandler: handleChainTipWithBurnchainTipCache,
      schema: {
        operationId: 'get_bitcoin_block_stacks_blocks',
        summary: 'Get Bitcoin block Stacks blocks',
        description:
          'Retrieves the summaries of the canonical Stacks blocks confirmed by a single canonical ' +
          'Bitcoin block, newest first',
        tags: ['Bitcoin Blocks'],
        params: Type.Object({
          height_or_hash: BlockHeightOrHashSchema,
        }),
        querystring: CursorPaginationQuerystring(BlockCursorSchema, ResourceType.Block),
        response: {
          200: CursorPaginatedResponse(BlockSummarySchema, BlockCursorSchema, ResourceType.Block),
        },
      },
    },
    async (req, reply) => {
      const results = await fastify.db.v3.getBitcoinBlockStacksBlockSummaries({
        block: parseBlockParam(req.params.height_or_hash),
        limit: req.query.limit ?? getPagingQueryLimit(ResourceType.Block),
        cursor: req.query.cursor,
      });
      if (!results) {
        throw new NotFoundError('Bitcoin block not found');
      }
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

  await Promise.resolve();
};
