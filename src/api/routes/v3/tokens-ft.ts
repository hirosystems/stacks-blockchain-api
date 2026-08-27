import { FastifyPluginAsync } from 'fastify';
import { Server } from 'node:http';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { handleChainTipCache } from '../../controllers/cache-controller.js';
import { FtHolderSchema } from '../../schemas/v3/entities/ft-holders.js';
import { FtSupplySchema } from '../../schemas/v3/entities/ft-supply.js';
import { AssetIdentifierSchema } from '../../schemas/v3/entities/common.js';
import {
  CursorPaginatedResponse,
  CursorPaginationQuerystring,
  FtHolderCursorSchema,
} from '../../schemas/v3/cursors.js';
import { getPagingQueryLimit, ResourceType } from '../../pagination.js';

export const TokensFtRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/tokens/ft/:asset_identifier/holders',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_ft_holders',
        summary: 'Get fungible token holders',
        description:
          'Retrieves the principals holding a given fungible token, sorted by balance ' +
          "descending. Balances are in the token's own base units.",
        tags: ['Tokens'],
        params: Type.Object({ asset_identifier: AssetIdentifierSchema }),
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
        token: req.params.asset_identifier,
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

  fastify.get(
    '/tokens/ft/:asset_identifier/supply',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_ft_total_supply',
        summary: 'Get total fungible token supply',
        description:
          'Retrieves the total supply of a fungible token: the sum of every holder balance, ' +
          "equivalent to the token's mints minus its burns. Returns a zero supply for a token " +
          'with no recorded balances.',
        tags: ['Tokens'],
        params: Type.Object({ asset_identifier: AssetIdentifierSchema }),
        response: {
          200: FtSupplySchema,
        },
      },
    },
    async (req, reply) => {
      const supply = await fastify.db.v3.getFtSupply({ token: req.params.asset_identifier });
      await reply.send({
        asset_identifier: req.params.asset_identifier,
        total: supply.total,
      });
    }
  );

  await Promise.resolve();
};
