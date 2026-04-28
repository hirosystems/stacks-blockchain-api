import { handleChainTipCache } from '../../controllers/cache-controller.js';
import { parseDbMempoolTransactionSummary } from '../../serializers/transactions.js';
import { FastifyPluginAsync } from 'fastify';
import { Type, TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { getPagingQueryLimit, ResourceType } from '../../pagination.js';
import { PaginatedCursorResponse } from '../../schemas/util.js';
import { LimitParam } from '../../schemas/params.js';
import { MempoolTransactionSummarySchema } from 'src/api/schemas/entities/v3/mempool-transaction-summaries.js';

export const MempoolRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get(
    '/mempool/transactions',
    {
      preHandler: handleChainTipCache,
      schema: {
        operationId: 'get_mempool_transaction_summaries',
        summary: 'Get mempool transaction summaries',
        description: `Retrieves a list of recently broadcasted transaction summaries`,
        tags: ['Mempool'],
        querystring: Type.Object({
          limit: LimitParam(ResourceType.Tx),
          // cursor: Type.Optional(TransactionSummaryCursorParamSchema),
        }),
        response: {
          200: PaginatedCursorResponse(MempoolTransactionSummarySchema),
        },
      },
    },
    async (req, reply) => {
      const query = req.query;
      const limit = getPagingQueryLimit(ResourceType.Tx, req.query.limit);
      const results = await fastify.db.v3.getMempoolTransactionSummaryList({ ...query, limit });
      // if (query.cursor && !results.current_cursor) {
      //   throw new NotFoundError('Cursor not found');
      // }
      await reply.send({
        limit: results.limit,
        offset: results.offset,
        total: results.total,
        next_cursor: results.next_cursor,
        prev_cursor: results.prev_cursor,
        cursor: results.current_cursor,
        results: results.results.map(r => parseDbMempoolTransactionSummary(r)),
      });
    }
  );

  // fastify.get(
  //   '/mempool/transactions/:tx_id',
  //   {
  //     preHandler: handleTransactionCache,
  //     schema: {
  //       operationId: 'get_transaction_by_id',
  //       summary: 'Get transaction',
  //       description: `Retrieves details for a given transaction ID`,
  //       tags: ['Transactions'],
  //       params: Type.Object({
  //         tx_id: TransactionIdParamSchema,
  //       }),
  //       response: {
  //         200: TransactionSchema,
  //       },
  //     },
  //   },
  //   async (req, reply) => {
  //     const { tx_id } = req.params;
  //     const transaction = await fastify.db.v3.getTransaction({ txId: tx_id });
  //     if (!transaction) {
  //       throw new NotFoundError('Transaction not found');
  //     }
  //     const result = parseDbTransaction(transaction);
  //     await reply.send(result);
  //   }
  // );

  await Promise.resolve();
};
