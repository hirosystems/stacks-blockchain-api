import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';

export const FEE_RATE = 400;

export const FeeRateRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.post(
    '/',
    {
      schema: {
        deprecated: true,
        operationId: 'fetch_fee_rate',
        summary: 'Fetch fee rate',
        description: `**NOTE:** This endpoint is deprecated in favor of [Get approximate fees for a given transaction](/api/get-approximate-fees-for-a-given-transaction).

        Retrieves estimated fee rate.`,
        tags: ['Fees'],
        body: Type.Object(
          {
            transaction: Type.String({ description: 'A serialized transaction' }),
          },
          { title: 'FeeRateRequest', description: 'Request to fetch fee for a transaction' }
        ),
        response: {
          200: Type.Object(
            {
              fee_rate: Type.Integer(),
            },
            {
              title: 'FeeRate',
              description: 'Get fee rate information.',
            }
          ),
        },
      },
    },
    async (_req, reply) => {
      //validate and use req.body.transaction when we want to use it
      const response = {
        fee_rate: FEE_RATE,
      };
      await reply.send(response);
    }
  );

  await Promise.resolve();
};
