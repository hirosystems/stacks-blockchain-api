import { FastifyPluginAsync } from 'fastify';
import { Server } from 'node:http';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { handleChainTipCache } from '../../controllers/cache-controller.js';
import { getPagingQueryLimit, ResourceType } from '../../pagination.js';
import {
  CursorPaginatedResponse,
  CursorPaginationQuerystring,
  SignerCursorSchema,
  StakerCursorSchema,
} from '../../schemas/v3/cursors.js';
import {
  SignerStakerSchema,
  StakingSignerDetailSchema,
  StakingSignerSchema,
} from '../../schemas/v3/entities/staking-signers.js';
import { PrincipalSchema } from '../../schemas/v3/entities/common.js';
import {
  serializeDbSignerStaker,
  serializeDbStakingSigner,
  serializeDbStakingSignerDetail,
} from '../../serializers/v3/signers.js';
import { NotFoundError } from '../../../errors.js';

export const StakingSignersRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/staking/signers',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_staking_signers',
        summary: 'Get staking signers',
        description:
          "Get the all-time registry of pox-5 staking signers: every signer principal that has ever registered a signer key, with its most recently registered key. Registrants are never removed from this registry, even if they are no longer part of the current cycle's signer set.",
        tags: ['Staking'],
        querystring: CursorPaginationQuerystring(SignerCursorSchema, ResourceType.Signer),
        response: {
          200: CursorPaginatedResponse(
            StakingSignerSchema,
            SignerCursorSchema,
            ResourceType.Signer
          ),
        },
      },
    },
    async (req, reply) => {
      const results = await fastify.db.v3.getStakingSigners({
        limit: req.query.limit ?? getPagingQueryLimit(ResourceType.Signer),
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
        results: results.results.map(serializeDbStakingSigner),
      });
    }
  );

  fastify.get(
    '/staking/signers/:principal',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_staking_signer',
        summary: 'Get staking signer',
        description:
          'Get a registered pox-5 staking signer along with the details of the transaction that registered its current key.',
        tags: ['Staking'],
        params: Type.Object({ principal: PrincipalSchema }),
        response: {
          200: StakingSignerDetailSchema,
        },
      },
    },
    async (req, reply) => {
      const signer = await fastify.db.v3.getStakingSigner({ signer: req.params.principal });
      if (!signer) {
        throw new NotFoundError('Staking signer not found');
      }
      await reply.send(serializeDbStakingSignerDetail(signer));
    }
  );

  fastify.get(
    '/staking/signers/:principal/stakers',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_staking_signer_stakers',
        summary: 'Get staking signer stakers',
        description:
          'List the stakers that belong to a pox-5 signer, across both direct STX staking and BTC/sBTC bond staking. Each entry indicates which staking type(s) the staker participates in under this signer.',
        tags: ['Staking'],
        params: Type.Object({ principal: PrincipalSchema }),
        querystring: CursorPaginationQuerystring(StakerCursorSchema, ResourceType.Stacker),
        response: {
          200: CursorPaginatedResponse(
            SignerStakerSchema,
            StakerCursorSchema,
            ResourceType.Stacker
          ),
        },
      },
    },
    async (req, reply) => {
      const results = await fastify.db.v3.getSignerStakers({
        signer: req.params.principal,
        limit: req.query.limit ?? getPagingQueryLimit(ResourceType.Signer),
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
        results: results.results.map(serializeDbSignerStaker),
      });
    }
  );

  await Promise.resolve();
};
