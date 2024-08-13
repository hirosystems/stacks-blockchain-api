import { handleChainTipCache } from '../../controllers/cache-controller';
import { parseDbPoxCycle, parseDbPoxSigner, parseDbPoxSignerStacker } from './helpers';
import { InvalidRequestError, NotFoundError } from '../../../errors';
import { getChainIDNetwork } from '../../../helpers';
import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { LimitParam, OffsetParam } from '../../schemas/params';
import { getPagingQueryLimit, ResourceType } from '../../pagination';
import { PaginatedResponse } from '../../schemas/util';
import {
  PoxCycle,
  PoxCycleSchema,
  PoxSigner,
  PoxSignerSchema,
  PoxStacker,
  PoxStackerSchema,
} from '../../schemas/entities/pox';

export const PoxRoutesV2: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  const getIsMainnet = () => getChainIDNetwork(fastify.chainId) === 'mainnet';

  fastify.get(
    '/cycles',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_pox_cycles',
        summary: 'Get PoX cycles',
        description: `Retrieves a list of PoX cycles`,
        tags: ['Proof of Transfer'],
        querystring: Type.Object({
          limit: LimitParam(ResourceType.PoxCycle),
          offset: OffsetParam(),
        }),
        response: {
          200: PaginatedResponse(PoxCycleSchema),
        },
      },
    },
    async (req, reply) => {
      const query = req.query;
      const cycles = await fastify.db.v2.getPoxCycles(query);
      const results: PoxCycle[] = cycles.results.map(c => parseDbPoxCycle(c));
      await reply.send({
        limit: cycles.limit,
        offset: cycles.offset,
        total: cycles.total,
        results: results,
      });
    }
  );

  fastify.get(
    '/cycles/:cycle_number',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_pox_cycle',
        summary: 'Get PoX cycle',
        description: `Retrieves details for a PoX cycle`,
        tags: ['Proof of Transfer'],
        params: Type.Object({
          cycle_number: Type.Integer({ description: 'PoX cycle number' }),
        }),
        response: {
          200: PoxCycleSchema,
        },
      },
    },
    async (req, reply) => {
      const params = req.params;
      const cycle = await fastify.db.v2.getPoxCycle(params);
      if (!cycle) {
        throw new NotFoundError();
      }
      await reply.send(cycle);
    }
  );

  fastify.get(
    '/cycles/:cycle_number/signers',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_pox_cycle_signers',
        summary: 'Get signers in PoX cycle',
        description: `Retrieves a list of signers in a PoX cycle`,
        tags: ['Proof of Transfer'],
        params: Type.Object({
          cycle_number: Type.Integer({ description: 'PoX cycle number' }),
        }),
        querystring: Type.Object({
          limit: LimitParam(ResourceType.Signer),
          offset: OffsetParam(),
        }),
        response: {
          200: PaginatedResponse(PoxSignerSchema),
        },
      },
    },
    async (req, reply) => {
      const params = req.params;
      const query = req.query;

      try {
        const { limit, offset, results, total } = await fastify.db.v2.getPoxCycleSigners({
          cycle_number: params.cycle_number,
          limit: getPagingQueryLimit(ResourceType.Signer, query.limit),
          offset: query.offset ?? 0,
        });
        const isMainnet = getIsMainnet();
        const signers: PoxSigner[] = results.map(r => parseDbPoxSigner(r, isMainnet));
        await reply.send({
          limit,
          offset,
          total,
          results: signers,
        });
      } catch (error) {
        if (error instanceof InvalidRequestError) {
          throw new NotFoundError(error.message);
        }
        throw error;
      }
    }
  );

  fastify.get(
    '/cycles/:cycle_number/signers/:signer_key',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_pox_cycle_signer',
        summary: 'Get signer in PoX cycle',
        description: `Retrieves details for a signer in a PoX cycle`,
        tags: ['Proof of Transfer'],
        params: Type.Object({
          cycle_number: Type.Integer({ description: 'PoX cycle number' }),
          signer_key: Type.String({
            description: 'Signer key',
            examples: ['0x038e3c4529395611be9abf6fa3b6987e81d402385e3d605a073f42f407565a4a3d'],
          }),
        }),
        querystring: Type.Object({}),
        response: {
          200: PoxSignerSchema,
        },
      },
    },
    async (req, reply) => {
      const params = req.params;
      try {
        const signer = await fastify.db.v2.getPoxCycleSigner(params);
        if (!signer) {
          throw new NotFoundError();
        }
        const isMainnet = getIsMainnet();
        const response: PoxSigner = parseDbPoxSigner(signer, isMainnet);
        await reply.send(response);
      } catch (error) {
        if (error instanceof InvalidRequestError) {
          throw new NotFoundError(error.message);
        }
        throw error;
      }
    }
  );

  fastify.get(
    '/cycles/:cycle_number/signers/:signer_key/stackers',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_pox_cycle_signer_stackers',
        summary: 'Get stackers for signer in PoX cycle',
        description: `Retrieves a list of stackers for a signer in a PoX cycle`,
        tags: ['Proof of Transfer'],
        params: Type.Object({
          cycle_number: Type.Integer({ description: 'PoX cycle number' }),
          signer_key: Type.String({
            description: 'Signer key',
            examples: ['0x038e3c4529395611be9abf6fa3b6987e81d402385e3d605a073f42f407565a4a3d'],
          }),
        }),
        querystring: Type.Object({
          limit: LimitParam(ResourceType.Stacker),
          offset: OffsetParam(),
        }),
        response: {
          200: PaginatedResponse(PoxStackerSchema),
        },
      },
    },
    async (req, reply) => {
      const params = req.params;
      const query = req.query;

      try {
        const { limit, offset, results, total } = await fastify.db.v2.getPoxCycleSignerStackers({
          cycle_number: params.cycle_number,
          signer_key: params.signer_key,
          limit: getPagingQueryLimit(ResourceType.Stacker, query.limit),
          offset: query.offset ?? 0,
        });
        const stackers: PoxStacker[] = results.map(r => parseDbPoxSignerStacker(r));
        await reply.send({
          limit,
          offset,
          total,
          results: stackers,
        });
      } catch (error) {
        if (error instanceof InvalidRequestError) {
          throw new NotFoundError(error.message);
        }
        throw error;
      }
    }
  );

  await Promise.resolve();
};
