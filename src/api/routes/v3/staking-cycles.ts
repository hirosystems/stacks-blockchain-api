import { FastifyPluginAsync } from 'fastify';
import { Server } from 'node:http';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { handleChainTipCache } from '../../controllers/cache-controller.js';
import { getPagingQueryLimit, ResourceType } from '../../pagination.js';
import {
  CursorPaginatedResponse,
  CursorPaginationQuerystring,
  SigningKeyCursorSchema,
} from '../../schemas/v3/cursors.js';
import { CycleSignerSchema } from '../../schemas/v3/entities/staking-cycles.js';
import { serializeDbCycleSigner } from '../../serializers/v3/staking-cycles.js';
import { NotFoundError } from '../../../errors.js';

export const StakingCyclesRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/staking/cycles/:cycle_number/signers',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_cycle_signers',
        summary: 'Get cycle signers',
        description:
          "Get the signer set of a PoX cycle, including each signer's weight, stacked amount, and the signer manager contracts whose key bindings were effective when the cycle's reward set was calculated. Key bindings changed after that point are surfaced as pending updates that take effect next cycle.",
        tags: ['Staking'],
        params: Type.Object({
          cycle_number: Type.Literal('current', {
            description:
              'The PoX cycle to fetch signers for. Only `current` is supported at the moment.',
          }),
        }),
        querystring: CursorPaginationQuerystring(SigningKeyCursorSchema, ResourceType.Signer),
        response: {
          200: CursorPaginatedResponse(
            CycleSignerSchema,
            SigningKeyCursorSchema,
            ResourceType.Signer
          ),
        },
      },
    },
    async (req, reply) => {
      const results = await fastify.db.v3.getCurrentCycleSigners({
        limit: req.query.limit ?? getPagingQueryLimit(ResourceType.Signer),
        cursor: req.query.cursor,
      });
      if (!results) {
        throw new NotFoundError('No PoX cycles found');
      }
      await reply.send({
        limit: results.limit,
        total: results.total,
        cursor: {
          next: results.next_cursor,
          previous: results.prev_cursor,
          current: results.current_cursor,
        },
        results: results.results.map(r => serializeDbCycleSigner(r, results.cycle_number)),
      });
    }
  );

  await Promise.resolve();
};
