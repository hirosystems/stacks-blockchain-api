import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { handleChainTipCache } from '../controllers/cache-controller';

const enum TargetBlockTime {
  /**
   * This is currently the Stacks 2.0 testnet, which uses a regtest bitcoin node with a
   * controller service that controls the block mining. The configured time can be found at
   * https://github.com/hirosystems/k8s/blob/5a3ae6abe74b736a0f21566a187838b00425e045/blockstack-core/v2/argon/bitcoin/staging/configmap.yaml#L7
   */
  Testnet = 2 * 60, // 2 minutes
  /**
   * Mainnet uses burnchain's block time (i.e. Bitcoin mainnet's 10 minute block time)
   */
  Mainnet = 10 * 60, // 10 minutes
}

export const InfoRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/network_block_times',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_network_block_times',
        summary: 'Get the network target block time',
        description: `Retrieves the target block times for mainnet and testnet. The block time is hardcoded and will change throughout the implementation phases of the testnet.`,
        tags: ['Info'],
        response: {
          200: Type.Object(
            {
              mainnet: Type.Object({
                target_block_time: Type.Integer(),
              }),
              testnet: Type.Object({
                target_block_time: Type.Integer(),
              }),
            },
            {
              title: 'NetworkBlockTimesResponse',
              description: 'GET request that returns network target block times',
            }
          ),
        },
      },
    },
    async (_req, reply) => {
      await reply.send({
        testnet: { target_block_time: TargetBlockTime.Testnet },
        mainnet: { target_block_time: TargetBlockTime.Mainnet },
      });
    }
  );

  fastify.get(
    '/network_block_time/:network',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_network_block_time_by_network',
        summary: `Get a given network's target block time`,
        description: `Retrieves the target block time for a given network. The network can be mainnet or testnet. The block time is hardcoded and will change throughout the implementation phases of the testnet.`,
        tags: ['Info'],
        params: Type.Object({
          network: Type.Enum({ testnet: 'testnet', mainnet: 'mainnet' }),
        }),
        response: {
          200: Type.Object(
            {
              target_block_time: Type.Integer(),
            },
            {
              title: 'NetworkBlockTimeResponse',
              description: 'GET request that target block time for a given network',
            }
          ),
        },
      },
    },
    async (req, reply) => {
      const { network } = req.params;
      await reply.send({
        target_block_time:
          network === 'testnet' ? TargetBlockTime.Testnet : TargetBlockTime.Mainnet,
      });
    }
  );

  await Promise.resolve();
};
