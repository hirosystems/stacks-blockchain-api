import { handleChainTipCache } from '../../controllers/cache-controller';
import { parseDbBurnBlock, parseDbNakamotoBlock } from './helpers';
import { BurnBlockParamsSchema, cleanBlockHeightOrHashParam, parseBlockParam } from './schemas';
import { InvalidRequestError, NotFoundError } from '../../../errors';
import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { LimitParam, OffsetParam } from '../../schemas/params';
import { ResourceType } from '../../pagination';
import { PaginatedResponse } from '../../schemas/util';
import { BurnBlock, BurnBlockSchema } from '../../schemas/entities/burn-blocks';
import { NakamotoBlockSchema } from '../../schemas/entities/block';

export const BurnBlockRoutesV2: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_burn_blocks',
        summary: 'Get burn blocks',
        description: `Retrieves a list of recent burn blocks`,
        tags: ['Burn Blocks'],
        querystring: Type.Object({
          limit: LimitParam(ResourceType.BurnBlock),
          offset: OffsetParam(),
        }),
        response: {
          200: PaginatedResponse(BurnBlockSchema),
        },
      },
    },
    async (req, reply) => {
      const query = req.query;
      const { limit, offset, results, total } = await fastify.db.v2.getBurnBlocks(query);
      const blocks: BurnBlock[] = results.map(r => parseDbBurnBlock(r));
      await reply.send({
        limit,
        offset,
        total,
        results: blocks,
      });
    }
  );

  fastify.get(
    '/:height_or_hash',
    {
      preHandler: handleChainTipCache,
      preValidation: (req, _reply, done) => {
        cleanBlockHeightOrHashParam(req.params);
        done();
      },
      schema: {
        operationId: 'get_burn_block',
        summary: 'Get burn block',
        description: `Retrieves a single burn block`,
        tags: ['Burn Blocks'],
        params: BurnBlockParamsSchema,
        response: {
          200: BurnBlockSchema,
        },
      },
    },
    async (req, reply) => {
      const params = parseBlockParam(req.params.height_or_hash);
      const block = await fastify.db.v2.getBurnBlock(params);
      if (!block) {
        throw new NotFoundError();
      }
      const response: BurnBlock = parseDbBurnBlock(block);
      await reply.send(response);
    }
  );

  fastify.get(
    '/:height_or_hash/blocks',
    {
      preHandler: handleChainTipCache,
      preValidation: (req, _reply, done) => {
        cleanBlockHeightOrHashParam(req.params);
        done();
      },
      schema: {
        operationId: 'get_blocks_by_burn_block',
        summary: 'Get blocks by burn block',
        description: `Retrieves a list of blocks confirmed by a specific burn block`,
        tags: ['Burn Blocks'],
        params: BurnBlockParamsSchema,
        querystring: Type.Object({
          limit: LimitParam(ResourceType.BurnBlock),
          offset: OffsetParam(),
        }),
        response: {
          200: PaginatedResponse(NakamotoBlockSchema),
        },
      },
    },
    async (req, reply) => {
      const params = parseBlockParam(req.params.height_or_hash);
      const query = req.query;

      try {
        const { limit, offset, results, total } = await fastify.db.v2.getBlocksByBurnBlock({
          block: params,
          ...query,
        });
        const blocks = results.map(r => parseDbNakamotoBlock(r));
        await reply.send({
          limit,
          offset,
          total,
          results: blocks,
        });
      } catch (error) {
        if (error instanceof InvalidRequestError) {
          throw new NotFoundError(error.message);
        }
        throw error;
      }
    }
  );

  await Promise.resolve();
};
