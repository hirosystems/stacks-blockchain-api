import { FastifyPluginAsync } from 'fastify';
import { Server } from 'node:http';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { handleChainTipCache } from '../../controllers/cache-controller.js';
import { StxSupplySchema } from '../../schemas/v3/entities/stx-supply.js';
import { STACKS_DECIMAL_PLACES, TOTAL_STACKS_YEAR_2050 } from '../../../helpers.js';

const TOTAL_MICRO_STX_YEAR_2050 =
  TOTAL_STACKS_YEAR_2050.shiftedBy(STACKS_DECIMAL_PLACES).toFixed(0);

export const StxSupplyRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/tokens/stx/supply',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_stx_total_supply',
        summary: 'Get total STX supply',
        description:
          'Retrieves the total liquid STX supply in micro-STX (µSTX) at the current chain tip: ' +
          'all STX minted (including vesting schedule unlocks) plus matured miner coinbase ' +
          'rewards, minus burned STX.',
        tags: ['Info'],
        response: {
          200: StxSupplySchema,
        },
      },
    },
    async (_req, reply) => {
      const supply = await fastify.db.v3.getStxSupply();
      await reply.send({
        total: supply.stx_supply,
        projected_total_2050: TOTAL_MICRO_STX_YEAR_2050,
      });
    }
  );

  await Promise.resolve();
};
