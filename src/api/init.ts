import { createServer, type Server } from 'http';
import type { Socket } from 'net';
import * as path from 'path';
import * as fs from 'fs';

import { TxRoutes } from './routes/tx';
import { DebugRoutes } from './routes/debug';
import { InfoRoutes } from './routes/info';
import { ContractRoutes } from './routes/contract';
import { CoreNodeRpcProxyRouter } from './routes/core-node-rpc-proxy';
import { BlockRoutes } from './routes/block';
import { FaucetRoutes } from './routes/faucets';
import { AddressRoutes } from './routes/address';
import { SearchRoutes } from './routes/search';
import { StxSupplyRoutes } from './routes/stx-supply';
import { RosettaNetworkRoutes } from './routes/rosetta/network';
import { RosettaMempoolRoutes } from './routes/rosetta/mempool';
import { RosettaBlockRoutes } from './routes/rosetta/block';
import { RosettaAccountRoutes } from './routes/rosetta/account';
import { RosettaConstructionRoutes } from './routes/rosetta/construction';
import { type ChainID, apiDocumentationUrl } from '../helpers';
import { InvalidRequestError } from '../errors';
import { BurnchainRoutes } from './routes/burnchain';
import { BnsNamespaceRoutes } from './routes/bns/namespaces';
import { BnsPriceRoutes } from './routes/bns/pricing';
import { BnsNameRoutes } from './routes/bns/names';
import { BnsAddressRoutes } from './routes/bns/addresses';
import { MicroblockRoutes } from './routes/microblock';
import { StatusRoutes } from './routes/status';
import { TokenRoutes } from './routes/tokens';
import { FeeRateRoutes } from './routes/fee-rate';

import type { PgStore } from '../datastore/pg-store';
import type { PgWriteStore } from '../datastore/pg-write-store';
import { WebSocketTransmitter } from './routes/ws/web-socket-transmitter';
import { PoxEventRoutes, PoxRoutes } from './routes/pox';
import { logger } from '../logger';
import {
  PINO_LOGGER_CONFIG,
  SERVER_VERSION,
  isPgConnectionError,
  isProdEnv,
  parseBoolean,
  waiter,
} from '@hirosystems/api-toolkit';
import { BlockRoutesV2 } from './routes/v2/blocks';
import { BurnBlockRoutesV2 } from './routes/v2/burn-blocks';
import { MempoolRoutesV2 } from './routes/v2/mempool';
import { SmartContractRoutesV2 } from './routes/v2/smart-contracts';
import { AddressRoutesV2 } from './routes/v2/addresses';
import { PoxRoutesV2 } from './routes/v2/pox';

import Fastify, { type FastifyInstance, type FastifyPluginAsync } from 'fastify';
import FastifyMetrics from 'fastify-metrics';
import FastifyCors from '@fastify/cors';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import * as promClient from 'prom-client';
import DeprecationPlugin from './deprecation-plugin';
import { BlockTenureRoutes } from './routes/v2/block-tenures';

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
      await fastify.register(DebugRoutes, { prefix: '/debug' });
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

async function createRosettaServer(datastore: PgStore, chainId: ChainID) {
  const fastify = Fastify({
    trustProxy: true,
    logger: PINO_LOGGER_CONFIG,
    ignoreTrailingSlash: true,
  });

  fastify.decorate('db', datastore);
  fastify.decorate('chainId', chainId);

  await fastify.register(FastifyCors, { exposedHeaders: ['X-API-Version'] });

  fastify.addHook('preHandler', async (_, reply) => {
    void reply.header(
      'X-API-Version',
      `${SERVER_VERSION.tag} (${SERVER_VERSION.branch}:${SERVER_VERSION.commit})`
    );
    void reply.header('Cache-Control', 'no-store');
  });

  fastify.setErrorHandler(async (error, _req, reply) => {
    if (error instanceof InvalidRequestError) {
      logger.warn(error, error.message);
      return reply.status(error.status).send({ error: error.message });
    } else if (isPgConnectionError(error)) {
      return reply.status(503).send({ error: `The database service is unavailable` });
    } else {
      return reply.status(500).send({ error: error.toString(), stack: (error as Error).stack });
    }
  });

  fastify.get('/doc', async (_req, reply) => {
    // if env variable for API_DOCS_URL is given
    if (apiDocumentationUrl) {
      return reply.redirect(apiDocumentationUrl);
    } else if (!isProdEnv) {
      // use local documentation if serving locally
      const apiDocumentationPath = path.join(__dirname + '../../../docs/.tmp/index.html');
      if (fs.existsSync(apiDocumentationPath)) {
        const bufferApiDocumentation = fs.readFileSync(apiDocumentationPath);
        return reply.type('text/html').send(bufferApiDocumentation);
      }

      const docNotFound = {
        error: 'Local documentation not found',
        desc: 'Please run the command: `npm run build:docs` and restart your server',
      };
      return reply.status(404).send(docNotFound);
    }
    // for production and no API_DOCS_URL provided
    const errObj = {
      error: 'Documentation is not available',
      desc: `You can still read documentation from https://docs.hiro.so/api`,
    };
    return reply.status(404).send(errObj);
  });

  await fastify.register(
    async fastify => {
      await fastify.register(RosettaNetworkRoutes, { prefix: '/network' });
      await fastify.register(RosettaMempoolRoutes, { prefix: '/mempool' });
      await fastify.register(RosettaBlockRoutes, { prefix: '/block' });
      await fastify.register(RosettaAccountRoutes, { prefix: '/account' });
      await fastify.register(RosettaConstructionRoutes, { prefix: '/construction' });
    },
    { prefix: '/rosetta/v1' }
  );

  return fastify;
}

export async function startApiServer(opts: {
  datastore: PgStore;
  writeDatastore?: PgWriteStore;
  chainId: ChainID;
  /** If not specified, this is read from the STACKS_BLOCKCHAIN_API_HOST env var. */
  serverHost?: string;
  /** If not specified, this is read from the STACKS_BLOCKCHAIN_API_PORT env var. */
  serverPort?: number;
}): Promise<ApiServer> {
  const { datastore, writeDatastore, chainId, serverHost, serverPort } = opts;

  const apiHost = serverHost ?? process.env['STACKS_BLOCKCHAIN_API_HOST'];
  const apiPort = serverPort ?? parseInt(process.env['STACKS_BLOCKCHAIN_API_PORT'] ?? '');

  if (!apiHost) {
    throw new Error(
      `STACKS_BLOCKCHAIN_API_HOST must be specified, e.g. "STACKS_BLOCKCHAIN_API_HOST=127.0.0.1"`
    );
  }
  if (!apiPort) {
    throw new Error(
      `STACKS_BLOCKCHAIN_API_PORT must be specified, e.g. "STACKS_BLOCKCHAIN_API_PORT=3999"`
    );
  }

  let rosettaFastify: FastifyInstance | undefined;
  if (parseBoolean(process.env['STACKS_API_ENABLE_ROSETTA'] ?? '1')) {
    rosettaFastify = await createRosettaServer(datastore, chainId);
  }

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

  // The most straightforward way to split between Fastify instances without
  // introducing a bunch of problematic middleware side-effects.
  const rosettaPath = new RegExp('^/rosetta');

  const server = createServer((req, res) => {
    if (rosettaPath.test(req.url as string)) {
      // handle with rosetta Fastify
      if (rosettaFastify) {
        rosettaFastify.server.emit('request', req, res);
      } else {
        res.writeHead(404).end();
      }
    } else {
      // handle with fastify
      fastify.server.emit('request', req, res);
    }
  });

  // Wait for all routes and middleware to be ready before starting the server
  await fastify.ready();
  if (rosettaFastify) {
    await rosettaFastify.ready();
  }

  const serverSockets = new Set<Socket>();
  server.on('connection', socket => {
    serverSockets.add(socket);
    socket.once('close', () => {
      serverSockets.delete(socket);
    });
  });

  const ws = new WebSocketTransmitter(datastore, server);
  ws.connect();

  await new Promise<void>((resolve, reject) => {
    try {
      server.once('error', error => {
        reject(error);
      });
      server.listen(apiPort, apiHost, () => {
        resolve();
      });
    } catch (error) {
      reject(error);
    }
  });

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
    await new Promise<void>(resolve => {
      logger.info('Closing API http server...');
      server.close(() => {
        logger.info('API http server closed.');
        resolve();
      });
    });
  };

  const forceKill = async () => {
    logger.info('Force closing API server...');
    const [wsClosePromise, serverClosePromise] = [waiter(), waiter()];
    ws.close(() => wsClosePromise.finish());
    server.close(() => serverClosePromise.finish());
    for (const socket of serverSockets) {
      socket.destroy();
    }
    await Promise.allSettled([wsClosePromise, serverClosePromise]);
  };

  const addr = server.address();
  if (addr === null) {
    throw new Error('server missing address');
  }
  const addrStr = typeof addr === 'string' ? addr : `${addr.address}:${addr.port}`;
  return {
    fastifyApp: fastify,
    server: server,
    ws: ws,
    address: addrStr,
    datastore: datastore,
    terminate: terminate,
    forceKill: forceKill,
  };
}
