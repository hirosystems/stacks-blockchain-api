import { handleChainTipCache } from '../../controllers/cache-controller';
import { parseDbNakamotoBlock } from './helpers';
import { TenureParamsSchema } from './schemas';
import { InvalidRequestError, NotFoundError } from '../../../errors';
import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { LimitParam, OffsetParam } from '../../schemas/params';
import { ResourceType } from '../../pagination';
import { PaginatedResponse } from '../../schemas/util';
import { NakamotoBlockSchema } from '../../schemas/entities/block';

export const TenureHeightRoutesV2: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/:height/blocks',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_blocks_by_tenure_height',
        summary: 'Get blocks by tenure height',
        description: `Retrieves a list of blocks confirmed within a specific tenure height`,
        tags: ['Tenure Height'],
        params: TenureParamsSchema,
        querystring: Type.Object({
          limit: LimitParam(ResourceType.TenureHeight),
          offset: OffsetParam(),
        }),
        response: {
          200: PaginatedResponse(NakamotoBlockSchema),
        },
      },
    },
    async (req, reply) => {
      const { height } = req.params;
      const query = req.query;

      try {
        const { limit, offset, results, total } = await fastify.db.v2.getBlocksByTenureHeight({
          height,
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
