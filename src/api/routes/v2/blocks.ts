import { handleBlockCache, handleChainTipCache } from '../../../api/controllers/cache-controller';
import {
  BlockParamsSchema,
  cleanBlockHeightOrHashParam,
  BlockCursorParamSchema,
  parseBlockParam,
} from './schemas';
import { parseDbNakamotoBlock } from './helpers';
import { InvalidRequestError, NotFoundError } from '../../../errors';
import { parseDbTx } from '../../../api/controllers/db-controller';
import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { CursorOffsetParam, LimitParam, OffsetParam } from '../../schemas/params';
import { getPagingQueryLimit, ResourceType } from '../../pagination';
import { PaginatedResponse } from '../../schemas/util';
import { NakamotoBlock, NakamotoBlockSchema } from '../../schemas/entities/block';
import { TransactionSchema } from '../../schemas/entities/transactions';
import {
  BlockListV2ResponseSchema,
  BlockSignerSignatureResponseSchema,
} from '../../schemas/responses/responses';

export const BlockRoutesV2: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_blocks',
        summary: 'Get blocks',
        description: `Retrieves a list of recently mined blocks`,
        tags: ['Blocks'],
        querystring: Type.Object({
          limit: LimitParam(ResourceType.Block),
          offset: CursorOffsetParam({ resource: ResourceType.Block }),
          cursor: Type.Optional(BlockCursorParamSchema),
        }),
        response: {
          200: BlockListV2ResponseSchema,
        },
      },
    },
    async (req, reply) => {
      const query = req.query;
      const limit = getPagingQueryLimit(ResourceType.Block, req.query.limit);
      const blockQuery = await fastify.db.v2.getBlocks({ ...query, limit });
      if (query.cursor && !blockQuery.current_cursor) {
        throw new NotFoundError('Cursor not found');
      }
      const blocks: NakamotoBlock[] = blockQuery.results.map(r => parseDbNakamotoBlock(r));
      await reply.send({
        limit: blockQuery.limit,
        offset: blockQuery.offset,
        total: blockQuery.total,
        next_cursor: blockQuery.next_cursor,
        prev_cursor: blockQuery.prev_cursor,
        cursor: blockQuery.current_cursor,
        results: blocks,
      });
    }
  );

  fastify.get(
    '/average-times',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_average_block_times',
        summary: 'Get average block times',
        description: `Retrieves average block times (in seconds)`,
        tags: ['Blocks'],
        response: {
          200: Type.Object({
            last_1h: Type.Number({
              description: 'Average block times over the last hour (in seconds)',
            }),
            last_24h: Type.Number({
              description: 'Average block times over the last 24 hours (in seconds)',
            }),
            last_7d: Type.Number({
              description: 'Average block times over the last 7 days (in seconds)',
            }),
            last_30d: Type.Number({
              description: 'Average block times over the last 30 days (in seconds)',
            }),
          }),
        },
      },
    },
    async (_req, reply) => {
      const query = await fastify.db.v2.getAverageBlockTimes();
      // Round to 2 decimal places
      const times = {
        last_1h: parseFloat(query.last_1h.toFixed(2)),
        last_24h: parseFloat(query.last_24h.toFixed(2)),
        last_7d: parseFloat(query.last_7d.toFixed(2)),
        last_30d: parseFloat(query.last_30d.toFixed(2)),
      };
      await reply.send(times);
    }
  );

  fastify.get(
    '/:height_or_hash',
    {
      preHandler: handleBlockCache,
      preValidation: (req, _reply, done) => {
        cleanBlockHeightOrHashParam(req.params);
        done();
      },
      schema: {
        operationId: 'get_block',
        summary: 'Get block',
        description: `Retrieves a single block`,
        tags: ['Blocks'],
        params: BlockParamsSchema,
        response: {
          200: NakamotoBlockSchema,
        },
      },
    },
    async (req, reply) => {
      const params = parseBlockParam(req.params.height_or_hash);
      const block = await fastify.db.v2.getBlock(params);
      if (!block) {
        throw new NotFoundError('Block not found');
      }
      await reply.send(parseDbNakamotoBlock(block));
    }
  );

  fastify.get(
    '/:height_or_hash/transactions',
    {
      preHandler: handleBlockCache,
      preValidation: (req, _reply, done) => {
        cleanBlockHeightOrHashParam(req.params);
        done();
      },
      schema: {
        operationId: 'get_transactions_by_block',
        summary: 'Get transactions by block',
        description: `Retrieves transactions confirmed in a single block`,
        tags: ['Transactions'],
        params: BlockParamsSchema,
        querystring: Type.Object({
          limit: LimitParam(ResourceType.Tx),
          offset: OffsetParam(),
        }),
        response: {
          200: PaginatedResponse(TransactionSchema),
        },
      },
    },
    async (req, reply) => {
      const params = parseBlockParam(req.params.height_or_hash);
      const query = req.query;

      try {
        const { limit, offset, results, total } = await fastify.db.v2.getBlockTransactions({
          block: params,
          ...query,
        });
        const response = {
          limit,
          offset,
          total,
          results: results.map(r => parseDbTx(r, false)),
        };
        await reply.send(response);
      } catch (error) {
        if (error instanceof InvalidRequestError) {
          throw new NotFoundError('Block not found');
        }
        throw error;
      }
    }
  );

  fastify.get(
    '/:height_or_hash/signer-signatures',
    {
      preHandler: handleBlockCache,
      preValidation: (req, _reply, done) => {
        cleanBlockHeightOrHashParam(req.params);
        done();
      },
      schema: {
        operationId: 'get_signer_signatures_for_block',
        summary: 'Get signer signatures for block',
        description: `Retrieves the signer signatures (an array of signature byte strings) in a single block`,
        tags: ['Blocks'],
        params: BlockParamsSchema,
        querystring: Type.Object({
          limit: LimitParam(ResourceType.BlockSignerSignature),
          offset: OffsetParam(),
        }),
        response: {
          200: BlockSignerSignatureResponseSchema,
        },
      },
    },
    async (req, reply) => {
      const params = parseBlockParam(req.params.height_or_hash);
      const query = req.query;

      try {
        const { limit, offset, results, total } = await fastify.db.v2.getBlockSignerSignature({
          blockId: params,
          ...query,
        });
        const response = {
          limit,
          offset,
          total,
          results: results,
        };
        await reply.send(response);
      } catch (error) {
        if (error instanceof InvalidRequestError) {
          throw new NotFoundError('Block not found');
        }
        throw error;
      }
    }
  );

  await Promise.resolve();
};
