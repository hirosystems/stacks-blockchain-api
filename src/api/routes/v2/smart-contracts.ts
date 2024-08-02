import { handleChainTipCache } from '../../controllers/cache-controller';
import { SmartContractStatusParamsSchema } from './schemas';
import { parseDbSmartContractStatusArray } from './helpers';
import { FastifyPluginAsync } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { SmartContractStatusListSchema } from '../../schemas/entities/smart-contracts';

export const SmartContractRoutesV2: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/status',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_smart_contracts_status',
        summary: 'Get smart contracts status',
        description: `Retrieves the deployment status of multiple smart contracts.`,
        tags: ['Smart Contracts'],
        querystring: SmartContractStatusParamsSchema,
        response: {
          200: SmartContractStatusListSchema,
        },
      },
    },
    async (req, reply) => {
      const query = req.query;
      const result = await fastify.db.v2.getSmartContractStatus(query);
      const resultArray = parseDbSmartContractStatusArray(query, result);
      await reply.send(resultArray);
    }
  );

  await Promise.resolve();
};
