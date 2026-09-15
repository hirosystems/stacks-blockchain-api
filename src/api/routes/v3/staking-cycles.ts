import { FastifyPluginAsync } from 'fastify';
import { Server } from 'node:http';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { handleChainTipWithBurnchainTipCache } from '../../controllers/cache-controller.js';
import { getPagingQueryLimit, ResourceType } from '../../pagination.js';
import {
  CursorPaginatedResponse,
  CursorPaginationQuerystring,
  SigningKeyCursorSchema,
} from '../../schemas/v3/cursors.js';
import { CycleSelectorParamSchema, parseCycleSelector } from '../../schemas/v3/params.js';
import { CycleSignerSchema, StakingCycleSchema } from '../../schemas/v3/entities/staking-cycles.js';
import {
  serializeDbCycleSigner,
  serializeDbStakingCycle,
} from '../../serializers/v3/staking-cycles.js';
import { InvalidRequestError, NotFoundError } from '../../../errors.js';

export const StakingCyclesRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/staking/cycles/:cycle_number',
    {
      preHandler: handleChainTipWithBurnchainTipCache,
      schema: {
        operationId: 'get_staking_cycle',
        summary: 'Get staking cycle',
        description: 'A summary of staking for one PoX reward cycle.',
        tags: ['Staking'],
        params: Type.Object({ cycle_number: CycleSelectorParamSchema }),
        response: {
          200: StakingCycleSchema,
        },
      },
    },
    async (req, reply) => {
      const cycle = await fastify.db.v3.getStakingCycle({
        selector: parseCycleSelector(req.params.cycle_number),
        poxConstants: await fastify.db.getPoxConstants(),
      });
      if (!cycle) {
        throw new NotFoundError('PoX cycle not found');
      }
      await reply.send(serializeDbStakingCycle(cycle));
    }
  );

  fastify.get(
    '/staking/cycles/:cycle_number/signers',
    {
      preHandler: handleChainTipWithBurnchainTipCache,
      schema: {
        operationId: 'get_cycle_signers',
        summary: 'Get cycle signers',
        description:
          "Get the signer set of a PoX cycle, including each signer's weight, staked amount, and the signer manager contracts whose registered signing key was this key when the cycle's reward set was calculated.",
        tags: ['Staking'],
        params: Type.Object({ cycle_number: CycleSelectorParamSchema }),
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
      const cycleNumber = await fastify.db.v3.resolveCycleSelector(
        parseCycleSelector(req.params.cycle_number),
        await fastify.db.getPoxConstants()
      );
      if (cycleNumber === undefined) {
        throw new NotFoundError('PoX cycle not found');
      }
      try {
        const results = await fastify.db.v3.getCycleSigners({
          cycleNumber,
          limit: req.query.limit ?? getPagingQueryLimit(ResourceType.Signer),
          cursor: req.query.cursor,
        });
        if (!results) {
          throw new NotFoundError('No reward set for this PoX cycle');
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
      } catch (error) {
        if (error instanceof InvalidRequestError) {
          throw new NotFoundError('Cursor not found');
        }
        throw error;
      }
    }
  );

  await Promise.resolve();
};
