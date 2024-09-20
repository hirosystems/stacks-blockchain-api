import { handleChainTipCache } from '../../../api/controllers/cache-controller';
import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { UnanchoredParamSchema } from '../../schemas/params';
import { InvalidRequestError, InvalidRequestErrorType } from '../../../errors';

const SUPPORTED_BLOCKCHAINS = ['stacks'];

export const BnsV2AddressRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/:blockchain/:address',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_names_owned_by_address',
        summary: 'Get Names Owned by Address',
        description: `Retrieves a list of names owned by the address provided.`,
        tags: ['Names'],
        params: Type.Object({
          blockchain: Type.String({
            description: 'The layer-1 blockchain for the address',
            examples: ['stacks'],
          }),
          address: Type.String({
            description: 'The address to lookup',
            examples: ['SP2J6ZY48GV1EZ5V2V5RB9MP66SW86PYKKNRV9EJ7'],
          }),
        }),
        querystring: Type.Object({
          unanchored: UnanchoredParamSchema,
        }),
        response: {
          200: Type.Object(
            {
              names: Type.Array(
                Type.String({
                  examples: ['muneeb.id'],
                })
              ),
            },
            {
              title: 'BnsNamesOwnByAddressResponse',
              description: 'Retrieves a list of names owned by the address provided.',
            }
          ),
        },
      },
    },
    async (req, reply) => {
      const { blockchain, address } = req.params;

      if (!SUPPORTED_BLOCKCHAINS.includes(blockchain)) {
        throw new InvalidRequestError(
          'Unsupported blockchain',
          InvalidRequestErrorType.bad_request
        );
      }

      const includeUnanchored = req.query.unanchored ?? false;

      const namesV2ByAddress = await fastify.db.getNamesV2ByAddressList({
        address: address,
        includeUnanchored,
        chainId: fastify.chainId,
      });

      if (namesV2ByAddress.found) {
        await reply.send({ names: namesV2ByAddress.result });
      } else {
        await reply.send({ names: [] });
      }
    }
  );
  await Promise.resolve();
};
