import { FastifyPluginAsync } from 'fastify';
import { Server } from 'node:http';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { handleChainTipWithBurnchainTipCache } from '../../controllers/cache-controller.js';
import { StakingOverviewSchema } from '../../schemas/v3/entities/staking-overview.js';

export const StakingRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/staking',
    {
      // Lock and bond expiry depend on the burn tip, which advances on `/new_burn_block` between
      // Stacks blocks, so the ETag covers the Stacks tip and the burnchain tip (height and hash).
      preHandler: handleChainTipWithBurnchainTipCache,
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
            stx_only_total: totals.individual_staked_stx,
            bond_total: totals.bond_staked_stx,
            total: (
              BigInt(totals.individual_staked_stx) + BigInt(totals.bond_staked_stx)
            ).toString(),
          },
          btc: {
            total: totals.bond_staked_btc,
          },
        },
      });
    }
  );
};
