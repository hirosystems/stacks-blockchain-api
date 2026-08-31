import { FastifyPluginAsync } from 'fastify';
import { Server } from 'node:http';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { handleChainTipCache } from '../../controllers/cache-controller.js';
import { SmartContractIdSchema } from '../../schemas/v3/entities/common.js';
import {
  SmartContractIncludeFieldSchema,
  SmartContractSchema,
} from '../../schemas/v3/entities/smart-contracts.js';
import { serializeDbSmartContract } from '../../serializers/v3/smart-contracts.js';
import { NotFoundError } from '../../../errors.js';

export const SmartContractsRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/smart-contracts/:contract_id',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_smart_contract',
        summary: 'Get smart contract',
        description:
          'Retrieves a deployed smart contract, along with the transaction that deployed it. ' +
          'Only successfully deployed contracts are returned; a contract id whose deploy ' +
          'transaction failed is not found.',
        tags: ['Smart Contracts'],
        params: Type.Object({
          contract_id: SmartContractIdSchema,
        }),
        querystring: Type.Object({
          include: Type.Optional(
            Type.Array(SmartContractIncludeFieldSchema, {
              uniqueItems: true,
              description: 'Heavy fields to include in the response.',
            })
          ),
        }),
        response: {
          200: SmartContractSchema,
        },
      },
    },
    async (req, reply) => {
      const contract = await fastify.db.v3.getSmartContract({
        contractId: req.params.contract_id,
        include: req.query.include,
      });
      if (!contract) {
        throw new NotFoundError('Smart contract not found');
      }
      await reply.send(serializeDbSmartContract(contract));
    }
  );

  await Promise.resolve();
};
