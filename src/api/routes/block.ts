import { getBlockFromDataStore, getBlocksWithMetadata } from '../controllers/db-controller';
import { NotFoundError } from '../../errors';
import { getPagingQueryLimit, parsePagingQueryInput, ResourceType } from '../pagination';
import { validateRequestHexInput } from '../query-helpers';
import { handleChainTipCache } from '../controllers/cache-controller';
import { has0xPrefix } from '@hirosystems/api-toolkit';

import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { LimitParam, OffsetParam } from '../schemas/params';
import { PaginatedResponse } from '../schemas/util';
import { BlockSchema } from '../schemas/entities/block';

export const BlockRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/',
    {
      preHandler: handleChainTipCache,
      schema: {
        deprecated: true,
        operationId: 'get_block_list',
        summary: 'Get recent blocks',
        description: `**NOTE:** This endpoint is deprecated in favor of [Get blocks](/api/get-blocks).

          Retrieves a list of recently mined blocks

          If you need to actively monitor new blocks, we highly recommend subscribing to [WebSockets or Socket.io](https://github.com/hirosystems/stacks-blockchain-api/tree/master/client) for real-time updates.`,
        tags: ['Blocks'],
        querystring: Type.Object({
          limit: LimitParam(ResourceType.Block, 'Limit', 'max number of blocks to fetch'),
          offset: OffsetParam(),
        }),
        response: {
          200: PaginatedResponse(BlockSchema, {
            title: 'BlockListResponse',
            description: 'GET request that returns blocks',
          }),
        },
      },
    },
    async (req, reply) => {
      const limit = getPagingQueryLimit(ResourceType.Block, req.query.limit);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);

      const { results, total } = await getBlocksWithMetadata({ offset, limit, db: fastify.db });
      const response = { limit, offset, total, results };
      await reply.send(response);
    }
  );

  fastify.get(
    '/by_height/:height',
    {
      preHandler: handleChainTipCache,
      schema: {
        deprecated: true,
        operationId: 'get_block_by_height',
        summary: 'Get block by height',
        description: `**NOTE:** This endpoint is deprecated in favor of [Get block](/api/get-block).

        Retrieves block details of a specific block at a given block height`,
        tags: ['Blocks'],
        params: Type.Object({
          height: Type.Integer({
            description: 'Height of the block',
            minimum: 0,
            examples: [10000],
          }),
        }),
        response: {
          200: BlockSchema,
        },
      },
    },
    async (req, reply) => {
      const height = req.params.height;
      const block = await getBlockFromDataStore({ blockIdentifer: { height }, db: fastify.db });
      if (!block.found) {
        throw new NotFoundError(`cannot find block by height`);
      }
      await reply.send(block.result);
    }
  );

  fastify.get(
    '/by_burn_block_height/:burn_block_height',
    {
      preHandler: handleChainTipCache,
      schema: {
        deprecated: true,
        operationId: 'get_block_by_burn_block_height',
        summary: 'Get block by burnchain height',
        description: `**NOTE:** This endpoint is deprecated in favor of [Get blocks](/api/get-blocks).

        Retrieves block details of a specific block for a given burn chain height`,
        tags: ['Blocks'],
        params: Type.Object({
          burn_block_height: Type.Integer({
            description: 'Height of the burn chain block',
            minimum: 0,
            examples: [744603],
          }),
        }),
        response: {
          200: BlockSchema,
        },
      },
    },
    async (req, reply) => {
      const burnBlockHeight = req.params.burn_block_height;
      const block = await getBlockFromDataStore({
        blockIdentifer: { burnBlockHeight },
        db: fastify.db,
      });
      if (!block.found) {
        throw new NotFoundError(`cannot find block by height`);
      }
      await reply.send(block.result);
    }
  );

  fastify.get(
    '/:hash',
    {
      preHandler: handleChainTipCache,
      schema: {
        deprecated: true,
        operationId: 'get_block_by_hash',
        summary: 'Get block by hash',
        description: `**NOTE:** This endpoint is deprecated in favor of [Get block](/api/get-block).
        
        Retrieves block details of a specific block for a given chain height. You can use the hash from your latest block ('get_block_list' API) to get your block details.`,
        tags: ['Blocks'],
        params: Type.Object({
          hash: Type.String({
            description: 'Hash of the block',
            examples: ['0x4839a8b01cfb39ffcc0d07d3db31e848d5adf5279d529ed5062300b9f353ff79'],
          }),
        }),
        response: {
          200: BlockSchema,
        },
      },
    },
    async (req, reply) => {
      const { hash } = req.params;

      if (!has0xPrefix(hash)) {
        return reply.redirect('/extended/v1/block/0x' + hash);
      }
      validateRequestHexInput(hash);

      const block = await getBlockFromDataStore({ blockIdentifer: { hash }, db: fastify.db });
      if (!block.found) {
        throw new NotFoundError(`cannot find block by hash`);
      }

      await reply.send(block.result);
    }
  );

  fastify.get(
    '/by_burn_block_hash/:burn_block_hash',
    {
      preHandler: handleChainTipCache,
      schema: {
        deprecated: true,
        operationId: 'get_block_by_burn_block_hash',
        summary: 'Get block by burnchain block hash',
        description: `**NOTE:** This endpoint is deprecated in favor of [Get blocks](/api/get-blocks).

        Retrieves block details of a specific block for a given burnchain block hash`,
        tags: ['Blocks'],
        params: Type.Object({
          burn_block_hash: Type.String({
            description: 'Hash of the burnchain block',
            examples: ['0x00000000000000000002bba732926cf68b6eda3e2cdbc2a85af79f10efeeeb10'],
          }),
        }),
        response: {
          200: BlockSchema,
        },
      },
    },
    async (req, reply) => {
      const { burn_block_hash } = req.params;

      if (!has0xPrefix(burn_block_hash)) {
        return reply.redirect('/extended/v1/block/by_burn_block_hash/0x' + burn_block_hash);
      }

      const block = await getBlockFromDataStore({
        blockIdentifer: { burnBlockHash: burn_block_hash },
        db: fastify.db,
      });
      if (!block.found) {
        throw new NotFoundError(`cannot find block by burn block hash`);
      }
      await reply.send(block.result);
    }
  );

  await Promise.resolve();
};
