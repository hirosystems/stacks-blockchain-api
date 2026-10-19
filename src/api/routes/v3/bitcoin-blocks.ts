import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { handleChainTipWithBurnchainTipCache } from '../../controllers/cache-controller.js';
import { getPagingQueryLimit, ResourceType } from '../../pagination.js';
import {
  BitcoinBlockCursorSchema,
  BlockCursorSchema,
  CursorPaginatedResponse,
  CursorPaginationQuerystring,
} from '../../schemas/v3/cursors.js';
import {
  BitcoinBlockSchema,
  BlockHeightOrHashSchema,
  BlockSummarySchema,
} from '../../schemas/v3/entities/common.js';
import { serializeBitcoinBlock, serializeDbBlockSummary } from '../../serializers/v3/blocks.js';
import { getBitcoinBlockTimeProjectionConfig } from '../../../datastore/bitcoin-block-time.js';
import { parseBlockParam } from '../v2/schemas.js';
import { NotFoundError } from '../../../errors.js';
import { redirectUnprefixedHashParams } from '../../query-helpers.js';

export const BitcoinBlocksRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  const projectionConfig = getBitcoinBlockTimeProjectionConfig(fastify.chainId);

  /** Resolves the times of a set of Bitcoin heights, for {@link serializeBitcoinBlock}. */
  const getTimes = async (heights: number[]) => ({
    times: await fastify.db.v3.getBitcoinBlockTimes(heights, projectionConfig.paceWindowBlocks),
    config: projectionConfig,
  });

  fastify.get(
    '/bitcoin-blocks',
    {
      // Times are learned from the Stacks blocks anchored to each Bitcoin block, and projections
      // follow the Stacks tip, so both tips feed the ETag.
      preHandler: handleChainTipWithBurnchainTipCache,
      schema: {
        operationId: 'get_bitcoin_blocks',
        summary: 'Get Bitcoin blocks',
        description:
          'Retrieves canonical Bitcoin blocks, newest first. Each block carries its header time ' +
          'once the API has learned it from a Stacks block anchored to it, an interpolated time ' +
          'for a past block no Stacks block anchored to, and a projected time for the newest ' +
          'blocks no Stacks block has anchored to yet.',
        tags: ['Bitcoin Blocks'],
        querystring: CursorPaginationQuerystring(BitcoinBlockCursorSchema, ResourceType.BurnBlock),
        response: {
          200: CursorPaginatedResponse(
            BitcoinBlockSchema,
            BitcoinBlockCursorSchema,
            ResourceType.BurnBlock
          ),
        },
      },
    },
    async (req, reply) => {
      const response = await fastify.db.sqlTransaction(async _sql => {
        const results = await fastify.db.v3.getBitcoinBlockSummaries({
          limit: req.query.limit ?? getPagingQueryLimit(ResourceType.BurnBlock),
          cursor: req.query.cursor,
        });
        const times = await getTimes(results.results.map(r => r.burn_block_height));
        const counts = await fastify.db.v3.getBitcoinBlockStacksBlockCounts(results.results);
        return {
          limit: results.limit,
          total: results.total,
          cursor: {
            next: results.next_cursor,
            previous: results.prev_cursor,
            current: results.current_cursor,
          },
          results: results.results.map(r => serializeBitcoinBlock(r, times, counts)),
        };
      });
      await reply.send(response);
    }
  );

  fastify.get(
    '/bitcoin-blocks/:height_or_hash',
    {
      onRequest: redirectUnprefixedHashParams({ params: ['height_or_hash'] }),
      preHandler: handleChainTipWithBurnchainTipCache,
      schema: {
        operationId: 'get_bitcoin_block',
        summary: 'Get Bitcoin block',
        description:
          'Retrieves a single canonical Bitcoin block, by height, hash, or `latest`, with its time ' +
          '(see the Bitcoin blocks list). A height above the Bitcoin tip returns the future block ' +
          'with no hash and its projected time.',
        tags: ['Bitcoin Blocks'],
        params: Type.Object({
          height_or_hash: BlockHeightOrHashSchema,
        }),
        response: {
          200: BitcoinBlockSchema,
        },
      },
    },
    async (req, reply) => {
      const blockId = parseBlockParam(req.params.height_or_hash);
      const response = await fastify.db.sqlTransaction(async _sql => {
        const block = await fastify.db.v3.getBitcoinBlockSummary({ block: blockId });
        if (block) {
          return serializeBitcoinBlock(
            block,
            await getTimes([block.burn_block_height]),
            await fastify.db.v3.getBitcoinBlockStacksBlockCounts([block])
          );
        }
        // A height above the Bitcoin tip is a future block: it has no hash yet, only a projection.
        if (blockId.type === 'height') {
          const tip = await fastify.db.v3.getBitcoinBlockSummary({
            block: { type: 'latest', latest: true },
          });
          if (tip && blockId.height > tip.burn_block_height) {
            return serializeBitcoinBlock(
              { burn_block_height: blockId.height, burn_block_hash: null },
              await getTimes([blockId.height]),
              new Map()
            );
          }
        }
        throw new NotFoundError('Bitcoin block not found');
      });
      await reply.send(response);
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
