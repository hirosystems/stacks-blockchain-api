import { FastifyPluginAsync } from 'fastify';
import { Server } from 'node:http';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { handleChainTipCache } from '../../controllers/cache-controller.js';
import { NftHistoryEventSchema, NftMintSchema } from '../../schemas/v3/entities/nft-events.js';
import { AssetIdentifierSchema } from '../../schemas/v3/entities/common.js';
import {
  CursorPaginatedResponse,
  CursorPaginationQuerystring,
  EventPositionCursorSchema,
} from '../../schemas/v3/cursors.js';
import { getPagingQueryLimit, ResourceType } from '../../pagination.js';
import { serializeNftHistoryEvent, serializeNftMint } from '../../serializers/v3/nft-events.js';
import { has0xPrefix } from '@stacks/api-toolkit';

const NftValueSchema = Type.String({
  pattern: '^(0x)?[a-fA-F0-9]+$',
  description: "Hex representation of the token instance's unique Clarity value",
  examples: ['0x0100000000000000000000000000000803'],
});

export const TokensNftRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/tokens/nft/:asset_identifier/history',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_nft_instance_history',
        summary: 'Get non-fungible token history',
        description:
          'Retrieves the event history of a single non-fungible token instance — every transfer, ' +
          "mint, and burn that moved it — newest first. Useful for determining an asset's " +
          'ownership history. Mints have a null `sender` and burns a null `recipient`.',
        tags: ['Tokens'],
        params: Type.Object({ asset_identifier: AssetIdentifierSchema }),
        querystring: Type.Composite([
          CursorPaginationQuerystring(EventPositionCursorSchema, ResourceType.Token),
          Type.Object({ value: NftValueSchema }),
        ]),
        response: {
          200: CursorPaginatedResponse(
            NftHistoryEventSchema,
            EventPositionCursorSchema,
            ResourceType.Token
          ),
        },
      },
    },
    async (req, reply) => {
      const value = has0xPrefix(req.query.value) ? req.query.value : `0x${req.query.value}`;
      const results = await fastify.db.v3.getNftHistory({
        assetIdentifier: req.params.asset_identifier,
        value,
        limit: req.query.limit ?? getPagingQueryLimit(ResourceType.Token),
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
        results: results.results.map(serializeNftHistoryEvent),
      });
    }
  );

  fastify.get(
    '/tokens/nft/:asset_identifier/mints',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_nft_asset_mints',
        summary: 'Get non-fungible token mints',
        description:
          'Retrieves the mint events of a non-fungible token asset class, newest first. Useful ' +
          'for determining which instances of a collection have been claimed.',
        tags: ['Tokens'],
        params: Type.Object({ asset_identifier: AssetIdentifierSchema }),
        querystring: CursorPaginationQuerystring(EventPositionCursorSchema, ResourceType.Token),
        response: {
          200: CursorPaginatedResponse(
            NftMintSchema,
            EventPositionCursorSchema,
            ResourceType.Token
          ),
        },
      },
    },
    async (req, reply) => {
      const results = await fastify.db.v3.getNftMints({
        assetIdentifier: req.params.asset_identifier,
        limit: req.query.limit ?? getPagingQueryLimit(ResourceType.Token),
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
        results: results.results.map(serializeNftMint),
      });
    }
  );

  await Promise.resolve();
};
