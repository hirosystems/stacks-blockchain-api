import { FastifyPluginAsync } from 'fastify';
import { Server } from 'node:http';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { handleChainTipCache } from '../../controllers/cache-controller.js';
import { NftHistoryEventSchema } from '../../schemas/v3/entities/nft-events.js';
import { AssetIdentifierSchema } from '../../schemas/v3/entities/common.js';
import {
  CursorPaginatedResponse,
  CursorPaginationQuerystring,
  EventPositionCursorSchema,
} from '../../schemas/v3/cursors.js';
import { getPagingQueryLimit, ResourceType } from '../../pagination.js';
import { serializeNftHistoryEvent } from '../../serializers/v3/nft-events.js';
import { cvToHex, uintCV } from '@stacks/transactions';
import { InvalidRequestError, InvalidRequestErrorType } from '../../../errors.js';

const NftValueSchema = Type.String({
  pattern: '^(\\d+|0x[a-fA-F0-9]+)$',
  title: 'NFT instance identifier',
  description:
    "The token instance's identifier, either as a plain integer (a SIP-009 token id, which is " +
    'serialized as a Clarity `uint`) or as a `0x`-prefixed serialized Clarity value.',
  examples: ['2051', '0x0100000000000000000000000000000803'],
});

/**
 * Resolves the `{value}` path segment to the serialized Clarity value stored in `nft_events`. A
 * plain integer is a SIP-009 token id and becomes a Clarity `uint`; anything else is already a
 * serialized Clarity value. Parsed as a string rather than a number: Clarity uints are 128-bit and
 * would lose precision past `Number.MAX_SAFE_INTEGER`.
 * @param value - The raw path segment.
 * @returns The `0x`-prefixed serialized Clarity value.
 */
const resolveNftValue = (value: string): string => {
  if (!/^\d+$/.test(value)) {
    return value;
  }
  try {
    return cvToHex(uintCV(value));
  } catch {
    // uintCV throws a RangeError past the uint128 max. Surface that as a 400 rather than letting it
    // escape as a 500, matching how out-of-range cursor components are handled.
    throw new InvalidRequestError(
      `Token id is larger than the maximum Clarity uint`,
      InvalidRequestErrorType.invalid_param
    );
  }
};

export const TokensNftRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/tokens/nft/:asset_identifier/:value/history',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_nft_instance_history',
        summary: 'Get non-fungible token history',
        description:
          'Retrieves the event history of a single non-fungible token instance, newest first. ' +
          "Useful for determining an asset's ownership history. Mints have a null `sender` and " +
          'burns a null `recipient`. The instance is addressed by a SIP-009 token id, or by its ' +
          'serialized Clarity value when the collection is not keyed by a `uint`.',
        tags: ['Tokens'],
        params: Type.Object({
          asset_identifier: AssetIdentifierSchema,
          value: NftValueSchema,
        }),
        querystring: CursorPaginationQuerystring(EventPositionCursorSchema, ResourceType.Token),
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
      const results = await fastify.db.v3.getNftHistory({
        assetIdentifier: req.params.asset_identifier,
        value: resolveNftValue(req.params.value),
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

  await Promise.resolve();
};
