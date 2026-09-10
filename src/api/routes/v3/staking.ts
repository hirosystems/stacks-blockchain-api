import { FastifyPluginAsync } from 'fastify';
import { Server } from 'node:http';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { handleChainTipCache } from '../../controllers/cache-controller.js';
import { StakingOverviewSchema } from '../../schemas/v3/entities/staking-overview.js';

export const StakingRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/staking',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_staking_overview',
        summary: 'Get network staking overview',
        description:
          'An overview of staking across the Stacks network, as of the current chain tip.',
        tags: ['Staking'],
        response: {
          200: StakingOverviewSchema,
        },
      },
    },
    async (_req, reply) => {
      const totals = await fastify.db.v3.getStakingLockedTotals();
      await reply.send({
        locked: {
          stx: {
            individual_staked_amount: totals.individual_staked_stx,
            bond_staked_amount: totals.bond_staked_stx,
            total_amount: (
              BigInt(totals.individual_staked_stx) + BigInt(totals.bond_staked_stx)
            ).toString(),
          },
          btc: {
            bond_staked_amount: totals.bond_staked_btc,
          },
        },
      });
    }
  );
};
