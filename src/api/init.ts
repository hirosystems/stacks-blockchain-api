import { Server } from 'http';
import { Socket } from 'net';

import { TxRoutes } from './routes/tx.js';
import { InfoRoutes } from './routes/info.js';
import { ContractRoutes } from './routes/contract.js';
import { CoreNodeRpcProxyRouter } from './routes/core-node-rpc-proxy.js';
import { BlockRoutes } from './routes/block.js';
import { FaucetRoutes } from './routes/faucets.js';
import { AddressRoutes } from './routes/address.js';
import { SearchRoutes } from './routes/search.js';
import { StxSupplyRoutes } from './routes/stx-supply.js';
import { ChainID } from '../helpers.js';
import { BurnchainRoutes } from './routes/burnchain.js';
import { BnsNamespaceRoutes } from './routes/bns/namespaces.js';
import { BnsPriceRoutes } from './routes/bns/pricing.js';
import { BnsNameRoutes } from './routes/bns/names.js';
import { BnsAddressRoutes } from './routes/bns/addresses.js';
import { MicroblockRoutes } from './routes/microblock.js';
import { StatusRoutes } from './routes/status.js';
import { TokenRoutes } from './routes/tokens.js';
import { FeeRateRoutes } from './routes/fee-rate.js';

import { PgStore } from '../datastore/pg-store.js';
import { PgWriteStore } from '../datastore/pg-write-store.js';
import { WebSocketTransmitter } from './routes/ws/web-socket-transmitter.js';
import { PoxEventRoutes, PoxRoutes } from './routes/pox.js';
import { ENV } from '../env.js';
import {
  PINO_LOGGER_CONFIG,
  SERVER_VERSION,
  isPgConnectionError,
  isProdEnv,
  waiter,
  logger,
} from '@stacks/api-toolkit';
import { BlockRoutesV2 } from './routes/v2/blocks.js';
import { BurnBlockRoutesV2 } from './routes/v2/burn-blocks.js';
import { MempoolRoutesV2 } from './routes/v2/mempool.js';
import { SmartContractRoutesV2 } from './routes/v2/smart-contracts.js';
import { AddressRoutesV2 } from './routes/v2/addresses.js';
import { PoxRoutesV2 } from './routes/v2/pox.js';

import Fastify, { FastifyInstance, FastifyPluginAsync } from 'fastify';
import FastifyMetricsModule from 'fastify-metrics';
const FastifyMetrics = FastifyMetricsModule.default;
import FastifyCors from '@fastify/cors';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import * as promClient from 'prom-client';
import DeprecationPlugin from './deprecation-plugin.js';
import { BlockTenureRoutes } from './routes/v2/block-tenures.js';

export interface ApiServer {
  fastifyApp: FastifyInstance;
  server: Server;
  ws: WebSocketTransmitter;
  address: string;
  datastore: PgStore;
  terminate: () => Promise<void>;
  forceKill: () => Promise<void>;
}

export const StacksApiRoutes: FastifyPluginAsync<
  Record<never, never>,
  Server,
  TypeBoxTypeProvider
> = async fastify => {
  await fastify.register(StatusRoutes);
  await fastify.register(
    async fastify => {
      await fastify.register(TxRoutes, { prefix: '/tx' });
      await fastify.register(StxSupplyRoutes, { prefix: '/stx_supply' });
      await fastify.register(InfoRoutes, { prefix: '/info' });
      await fastify.register(TokenRoutes, { prefix: '/tokens' });
      await fastify.register(ContractRoutes, { prefix: '/contract' });
      await fastify.register(FeeRateRoutes, { prefix: '/fee_rate' });
      await fastify.register(MicroblockRoutes, { prefix: '/microblock' });
      await fastify.register(BlockRoutes, { prefix: '/block' });
      await fastify.register(BurnchainRoutes, { prefix: '/burnchain' });
      await fastify.register(AddressRoutes, { prefix: '/address' });
      await fastify.register(SearchRoutes, { prefix: '/search' });
      await fastify.register(PoxRoutes, { prefix: '/:pox(pox\\d)' });
      await fastify.register(PoxEventRoutes, { prefix: '/:(pox\\d_events)' });
      await fastify.register(FaucetRoutes, { prefix: '/faucets' });
    },
    { prefix: '/extended/v1' }
  );

  await fastify.register(
    async fastify => {
      await fastify.register(BlockRoutesV2, { prefix: '/blocks' });
      await fastify.register(BurnBlockRoutesV2, { prefix: '/burn-blocks' });
      await fastify.register(BlockTenureRoutes, { prefix: '/block-tenures' });
      await fastify.register(SmartContractRoutesV2, { prefix: '/smart-contracts' });
      await fastify.register(MempoolRoutesV2, { prefix: '/mempool' });
      await fastify.register(PoxRoutesV2, { prefix: '/pox' });
      await fastify.register(AddressRoutesV2, { prefix: '/addresses' });
    },
    { prefix: '/extended/v2' }
  );

  // Setup legacy API v1 and v2 routes
  await fastify.register(BnsNameRoutes, { prefix: '/v1/names' });
  await fastify.register(BnsNamespaceRoutes, { prefix: '/v1/namespaces' });
  await fastify.register(BnsAddressRoutes, { prefix: '/v1/addresses' });
  await fastify.register(BnsPriceRoutes, { prefix: '/v2/prices' });

  await Promise.resolve();
};

export async function startApiServer(opts: {
  datastore: PgStore;
  writeDatastore?: PgWriteStore;
  chainId: ChainID;
}): Promise<ApiServer> {
  const { datastore, writeDatastore, chainId } = opts;

  const apiHost = ENV.STACKS_BLOCKCHAIN_API_HOST;
  const apiPort = ENV.STACKS_BLOCKCHAIN_API_PORT;

  const fastify = Fastify({
    trustProxy: true,
    logger: PINO_LOGGER_CONFIG,
    ignoreTrailingSlash: true,
  }).withTypeProvider<TypeBoxTypeProvider>();

  fastify.decorate('db', datastore);
  fastify.decorate('writeDb', writeDatastore);
  fastify.decorate('chainId', chainId);

  if (isProdEnv) {
    await fastify.register(FastifyMetrics, {
      endpoint: null,
      promClient: promClient,
      defaultMetrics: { enabled: false },
    });
  }

  await fastify.register(FastifyCors, { exposedHeaders: ['X-API-Version'] });

  fastify.addHook('preHandler', async (_, reply) => {
    // Set API version in all responses.
    void reply.header(
      'X-API-Version',
      `${SERVER_VERSION.tag} (${SERVER_VERSION.branch}:${SERVER_VERSION.commit})`
    );
    // Set caching on all routes to be disabled by default, individual routes can override.
    void reply.header('Cache-Control', 'no-store');
  });

  fastify.setErrorHandler(async (error, _req, reply) => {
    if (isPgConnectionError(error)) {
      return reply.status(503).send({ error: `The database service is unavailable` });
    } else {
      return reply.send(error);
    }
  });

  await fastify.register(StacksApiRoutes);

  // Setup direct proxy to core-node RPC endpoints (/v2)
  await fastify.register(CoreNodeRpcProxyRouter, { prefix: '/v2' });

  // Middleware to annotate http responses with deprecation warnings
  await fastify.register(DeprecationPlugin, {
    defaultDeprecatedMessage: 'See https://docs.hiro.so/stacks/api for more information',
  });

  const serverSockets = new Set<Socket>();
  fastify.server.on('connection', socket => {
    serverSockets.add(socket);
    socket.once('close', () => {
      serverSockets.delete(socket);
    });
  });

  const ws = new WebSocketTransmitter(datastore, fastify.server);
  ws.connect();

  await fastify.listen({ port: apiPort, host: apiHost });

  const terminate = async () => {
    await new Promise<void>((resolve, reject) => {
      logger.info('Closing WebSocket channels...');
      ws.close(error => {
        if (error) {
          logger.error(error, 'Failed to gracefully close WebSocket channels');
          reject(error);
        } else {
          logger.info('API WebSocket channels closed.');
          resolve();
        }
      });
    });
    for (const socket of serverSockets) {
      socket.destroy();
    }
    logger.info('Closing API http server...');
    await fastify.close();
    logger.info('API http server closed.');
  };

  const forceKill = async () => {
    logger.info('Force closing API server...');
    const wsClosePromise = waiter();
    ws.close(() => wsClosePromise.finish());
    for (const socket of serverSockets) {
      socket.destroy();
    }
    await Promise.allSettled([wsClosePromise, fastify.close()]);
  };

  const addr = fastify.server.address();
  if (addr === null) {
    throw new Error('server missing address');
  }
  const addrStr = typeof addr === 'string' ? addr : `${addr.address}:${addr.port}`;
  return {
    fastifyApp: fastify,
    server: fastify.server,
    ws: ws,
    address: addrStr,
    datastore: datastore,
    terminate: terminate,
    forceKill: forceKill,
  };
}
