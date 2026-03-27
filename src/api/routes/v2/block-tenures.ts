import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { FastifyPluginAsync } from 'fastify';
import { Server } from 'node:http';
import { handleBlockCache } from '../../../api/controllers/cache-controller.js';
import { getPagingQueryLimit, ResourceType } from '../../../api/pagination.js';
import { CursorOffsetParam, LimitParam } from '../../../api/schemas/params.js';
import { BlockListV2ResponseSchema } from '../../../api/schemas/responses/responses.js';
import { BlockTenureParamsSchema, BlockCursorParamSchema } from './schemas.js';
import { NotFoundError } from '../../../errors.js';
import { NakamotoBlock } from '../../../api/schemas/entities/block.js';
import { parseDbNakamotoBlock } from './helpers.js';

export const BlockTenureRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/:tenure_height/blocks',
    {
      preHandler: handleBlockCache,
      schema: {
        operationId: 'get_tenure_blocks',
        summary: 'Get blocks by tenure',
        description: `Retrieves blocks confirmed in a block tenure`,
        tags: ['Blocks'],
        params: BlockTenureParamsSchema,
        querystring: Type.Object({
          limit: LimitParam(ResourceType.Block),
          offset: CursorOffsetParam({ resource: ResourceType.Block }),
          cursor: Type.Optional(BlockCursorParamSchema),
        }),
        response: {
          200: BlockListV2ResponseSchema,
        },
      },
    },
    async (req, reply) => {
      const offset = req.query.offset ?? 0;
      const limit = getPagingQueryLimit(ResourceType.Block, req.query.limit);
      const blockQuery = await fastify.db.v2.getBlocks({
        offset,
        limit,
        cursor: req.query.cursor,
        tenureHeight: req.params.tenure_height,
      });
      if (req.query.cursor && !blockQuery.current_cursor) {
        throw new NotFoundError('Cursor not found');
      }
      const blocks: NakamotoBlock[] = blockQuery.results.map(r => parseDbNakamotoBlock(r));
      await reply.send({
        limit: blockQuery.limit,
        offset: blockQuery.offset,
        total: blockQuery.total,
        next_cursor: blockQuery.next_cursor,
        prev_cursor: blockQuery.prev_cursor,
        cursor: blockQuery.current_cursor,
        results: blocks,
      });
    }
  );

  await Promise.resolve();
};
