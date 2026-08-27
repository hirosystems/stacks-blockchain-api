import { FastifyPluginAsync } from 'fastify';
import { Server } from 'node:http';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { handleChainTipCache } from '../../controllers/cache-controller.js';
import { StxSupplySchema } from '../../schemas/v3/entities/stx-supply.js';
import { FtHolderSchema } from '../../schemas/v3/entities/ft-holders.js';
import {
  CursorPaginatedResponse,
  CursorPaginationQuerystring,
  FtHolderCursorSchema,
} from '../../schemas/v3/cursors.js';
import { getPagingQueryLimit, ResourceType } from '../../pagination.js';
import { STACKS_DECIMAL_PLACES, TOTAL_STACKS_YEAR_2050 } from '../../../helpers.js';

const TOTAL_MICRO_STX_YEAR_2050 =
  TOTAL_STACKS_YEAR_2050.shiftedBy(STACKS_DECIMAL_PLACES).toFixed(0);

export const TokensStxRoutes: FastifyPluginAsync<
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
        tags: ['Tokens'],
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

  fastify.get(
    '/tokens/stx/holders',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_stx_holders',
        summary: 'Get STX holders',
        description:
          'Retrieves the principals holding STX, sorted by balance descending. Balances are ' +
          'the total µSTX held, including any STX locked for stacking — they are not the ' +
          "spendable balance reported as `available` by a principal's STX balance.",
        tags: ['Tokens'],
        querystring: CursorPaginationQuerystring(FtHolderCursorSchema, ResourceType.TokenHolders),
        response: {
          200: CursorPaginatedResponse(
            FtHolderSchema,
            FtHolderCursorSchema,
            ResourceType.TokenHolders
          ),
        },
      },
    },
    async (req, reply) => {
      const results = await fastify.db.v3.getFtHolders({
        token: 'stx',
        limit: req.query.limit ?? getPagingQueryLimit(ResourceType.TokenHolders),
        cursor: req.query.cursor,
      });
      await reply.send({
        limit: results.limit,
        total: results.total,
        cursor: {
          next: results.next_cursor,
          previous: results.prev_cursor,
          current: results.current_cursor,
        },
        results: results.results,
      });
    }
  );

  await Promise.resolve();
};
