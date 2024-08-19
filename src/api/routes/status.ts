import { FastifyPluginAsync } from 'fastify';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import { Server } from 'node:http';
import { ServerStatusResponse, ServerStatusResponseSchema } from '../schemas/responses/responses';
import { handleChainTipCache } from '../controllers/cache-controller';
import { SERVER_VERSION } from '@hirosystems/api-toolkit';

export const StatusRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  fastify.get('/extended', {
    schema: {
      operationId: 'get_status',
      summary: 'API status',
      description:
        'Retrieves the running status of the Stacks Blockchain API, including the server version and current chain tip information.',
      tags: ['Info'],
      response: {
        200: ServerStatusResponseSchema,
      },
    },
    preHandler: handleChainTipCache,
    handler: async (_, reply) => {
      const response: ServerStatusResponse = {
        server_version: `stacks-blockchain-api ${SERVER_VERSION.tag} (${SERVER_VERSION.branch}:${SERVER_VERSION.commit})`,
        status: 'ready',
      };
      try {
        await fastify.db.sqlTransaction(async sql => {
          const poxForceUnlockHeights = await fastify.db.getPoxForcedUnlockHeightsInternal(sql);
          if (poxForceUnlockHeights.found) {
            response.pox_v1_unlock_height = poxForceUnlockHeights.result.pox1UnlockHeight as number;
            response.pox_v2_unlock_height = poxForceUnlockHeights.result.pox2UnlockHeight as number;
            response.pox_v3_unlock_height = poxForceUnlockHeights.result.pox3UnlockHeight as number;
          }
          const chainTip = await fastify.db.getChainTip(sql);
          if (chainTip.block_height > 0) {
            response.chain_tip = {
              block_height: chainTip.block_height,
              block_hash: chainTip.block_hash,
              index_block_hash: chainTip.index_block_hash,
              microblock_hash: chainTip.microblock_hash,
              microblock_sequence: chainTip.microblock_sequence,
              burn_block_height: chainTip.burn_block_height,
            };
          }
        });
      } catch (error) {
        // ignore error
      }
      await reply.send(response);
    },
  });

  fastify.get('/', { schema: { hide: true } }, async (_, reply) => {
    await reply.code(301).redirect('/extended');
  });
  fastify.get('/extended/v1/status', { schema: { hide: true } }, async (_, reply) => {
    await reply.code(301).redirect('/extended');
  });

  await Promise.resolve();
};
