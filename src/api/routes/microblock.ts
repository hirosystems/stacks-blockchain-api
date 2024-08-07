import {
  getMicroblockFromDataStore,
  getMicroblocksFromDataStore,
  getUnanchoredTxsFromDataStore,
} from '../controllers/db-controller';
import { getPagingQueryLimit, parsePagingQueryInput, ResourceType } from '../pagination';
import { validateRequestHexInput } from '../query-helpers';
import { has0xPrefix } from '@hirosystems/api-toolkit';
import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { handleChainTipCache } from '../controllers/cache-controller';
import { LimitParam, OffsetParam } from '../schemas/params';
import { PaginatedResponse } from '../schemas/util';
import { MicroblockSchema } from '../schemas/entities/microblock';
import { NotFoundError } from '../../errors';
import { TransactionSchema } from '../schemas/entities/transactions';
import { MicroblockListResponseSchema } from '../schemas/responses/responses';

export const MicroblockRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_microblock_list',
        summary: 'Get recent microblocks',
        description: `Retrieves a list of microblocks.

          If you need to actively monitor new microblocks, we highly recommend subscribing to [WebSockets or Socket.io](https://github.com/hirosystems/stacks-blockchain-api/tree/master/client) for real-time updates.`,
        tags: ['Microblocks'],
        querystring: Type.Object({
          limit: LimitParam(ResourceType.Microblock, 'Limit', 'Max number of microblocks to fetch'),
          offset: OffsetParam(),
        }),
        response: {
          200: MicroblockListResponseSchema,
        },
      },
    },
    async (req, reply) => {
      const limit = getPagingQueryLimit(ResourceType.Microblock, req.query.limit);
      const offset = parsePagingQueryInput(req.query.offset ?? 0);
      const query = await getMicroblocksFromDataStore({ db: fastify.db, offset, limit });
      const response = {
        limit,
        offset,
        total: query.total,
        results: query.result,
      };

      await reply.send(response);
    }
  );

  fastify.get(
    '/:hash',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_microblock_by_hash',
        summary: 'Get microblock',
        description: 'Retrieves a specific microblock by `hash`',
        tags: ['Microblocks'],
        params: Type.Object({
          hash: Type.String({
            description: 'Hash of the microblock',
            examples: ['0x3bfcdf84b3012adb544cf0f6df4835f93418c2269a3881885e27b3d58eb82d47'],
          }),
        }),
        response: {
          200: MicroblockSchema,
        },
      },
    },
    async (req, reply) => {
      const { hash } = req.params;

      if (!has0xPrefix(hash)) {
        return reply.redirect('/extended/v1/microblock/0x' + hash);
      }

      validateRequestHexInput(hash);

      const block = await getMicroblockFromDataStore({ db: fastify.db, microblockHash: hash });
      if (!block.found) {
        throw new NotFoundError(`cannot find microblock by hash`);
      }
      const response = block.result;
      await reply.send(response);
    }
  );

  fastify.get(
    '/unanchored/txs',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_unanchored_txs',
        summary: 'Get the list of current transactions that belong to unanchored microblocks',
        description:
          'Retrieves transactions that have been streamed in microblocks but not yet accepted or rejected in an anchor block',
        tags: ['Microblocks'],
        response: {
          200: Type.Object({
            total: Type.Integer(),
            results: Type.Array(TransactionSchema),
          }),
        },
      },
    },
    async (_req, reply) => {
      // TODO: implement pagination for /unanchored/txs
      const txs = await getUnanchoredTxsFromDataStore(fastify.db);
      const response = {
        total: txs.length,
        results: txs,
      };
      await reply.send(response);
    }
  );

  await Promise.resolve();
};
