import { Server, createServer } from 'http';
import { Socket } from 'net';
import * as express from 'express';
import { v4 as uuid } from 'uuid';
import * as cors from 'cors';

import { TxRoutes } from './routes/tx';
import { DebugRoutes } from './routes/debug';
import { InfoRoutes } from './routes/info';
import { ContractRoutes } from './routes/contract';
import { createCoreNodeRpcProxyRouter } from './routes/core-node-rpc-proxy';
import { BlockRoutes } from './routes/block';
import { FaucetRoutes } from './routes/faucets';
import { AddressRoutes } from './routes/address';
import { SearchRoutes } from './routes/search';
import { StxSupplyRoutes } from './routes/stx-supply';
import { createRosettaNetworkRouter } from './routes/rosetta/network';
import { createRosettaMempoolRouter } from './routes/rosetta/mempool';
import { createRosettaBlockRouter } from './routes/rosetta/block';
import { createRosettaAccountRouter } from './routes/rosetta/account';
import { createRosettaConstructionRouter } from './routes/rosetta/construction';
import { ChainID, apiDocumentationUrl, getChainIDNetwork } from '../helpers';
import { InvalidRequestError } from '../errors';
import { BurnchainRoutes } from './routes/burnchain';
import { createBnsNamespacesRouter } from './routes/bns/namespaces';
import { createBnsPriceRouter } from './routes/bns/pricing';
import { createBnsNamesRouter } from './routes/bns/names';
import { createBnsAddressesRouter } from './routes/bns/addresses';
import * as pathToRegex from 'path-to-regexp';
import * as expressListEndpoints from 'express-list-endpoints';
import { createMiddleware as createPrometheusMiddleware } from '@promster/express';
import { MicroblockRoutes } from './routes/microblock';
import { StatusRoutes } from './routes/status';
import { TokenRoutes } from './routes/tokens';
import { FeeRateRoutes } from './routes/fee-rate';
import { setResponseNonCacheable } from './controllers/cache-controller';

import * as path from 'path';
import * as fs from 'fs';
import { PgStore } from '../datastore/pg-store';
import { PgWriteStore } from '../datastore/pg-write-store';
import { WebSocketTransmitter } from './routes/ws/web-socket-transmitter';
import { PoxEventRoutes, PoxRoutes } from './routes/pox';
import { logger, loggerMiddleware } from '../logger';
import {
  PINO_LOGGER_CONFIG,
  SERVER_VERSION,
  isPgConnectionError,
  isProdEnv,
  parseBoolean,
  waiter,
} from '@hirosystems/api-toolkit';
import { BlockRoutesV2 } from './routes/v2/blocks';
import { getReqQuery } from './query-helpers';
import { BurnBlockRoutesV2 } from './routes/v2/burn-blocks';
import { createMempoolRouter } from './routes/v2/mempool';
import { createV2SmartContractsRouter } from './routes/v2/smart-contracts';
import { createV2AddressesRouter } from './routes/v2/addresses';
import { createPoxRouter } from './routes/v2/pox';

import Fastify, { FastifyInstance } from 'fastify';
import FastifyMetrics from 'fastify-metrics';
import FastifyCors from '@fastify/cors';
import { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';

declare module 'fastify' {
  interface FastifyInstance {
    db: PgStore;
    writeDb?: PgWriteStore;
    chainId: ChainID;
  }
}

export interface ApiServer {
  expressApp: express.Express;
  fastifyApp: FastifyInstance;
  server: Server;
  ws: WebSocketTransmitter;
  address: string;
  datastore: PgStore;
  terminate: () => Promise<void>;
  forceKill: () => Promise<void>;
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
  const app = express();
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

  let routes: {
    path: string;
    regexp: RegExp;
  }[] = [];

  if (isProdEnv) {
    // The default from
    // https://github.com/tdeekens/promster/blob/696803abf03a9a657d4af46d312fa9fb70a75320/packages/metrics/src/create-metric-types/create-metric-types.ts#L16
    const defaultPromHttpRequestDurationInSeconds = [0.05, 0.1, 0.3, 0.5, 0.8, 1, 1.5, 2, 3, 10];

    // Add a few more buckets to account for requests that take longer than 10 seconds
    defaultPromHttpRequestDurationInSeconds.push(25, 50, 100, 250, 500);

    const promMiddleware = createPrometheusMiddleware({
      options: {
        buckets: defaultPromHttpRequestDurationInSeconds as [number],
        normalizePath: path => {
          // Get the url pathname without a query string or fragment
          // (note base url doesn't matter, but required by URL constructor)
          try {
            const pathTemplate = new URL(path, 'http://x').pathname;
            // Match request url to the Express route, e.g.:
            // `/extended/v1/address/ST26DR4VGV507V1RZ1JNM7NN4K3DTGX810S62SBBR/stx` to
            // `/extended/v1/address/:stx_address/stx`
            for (const pathRegex of routes) {
              if (pathRegex.regexp.test(pathTemplate)) {
                return pathRegex.path;
              }
            }
            return '<invalid_path>';
          } catch (error) {
            logger.warn(`Warning: ${error}`);
            return path;
          }
        },
      },
    });
    app.use(promMiddleware);
  }
  // Add API version to header
  app.use((_, res, next) => {
    res.setHeader(
      'X-API-Version',
      `${SERVER_VERSION.tag} (${SERVER_VERSION.branch}:${SERVER_VERSION.commit})`
    );
    res.append('Access-Control-Expose-Headers', 'X-API-Version');
    next();
  });

  // Common logger middleware for the whole API.
  app.use(loggerMiddleware);

  app.set('json spaces', 2);

  // Turn off Express's etag handling. By default CRC32 hashes are generated over response payloads
  // which are useless for our use case and wastes CPU.
  // See https://expressjs.com/en/api.html#etag.options.table
  app.set('etag', false);

  app.use('/doc', (req, res) => {
    // if env variable for API_DOCS_URL is given
    if (apiDocumentationUrl) {
      return res.redirect(apiDocumentationUrl);
    } else if (!isProdEnv) {
      // use local documentation if serving locally
      const apiDocumentationPath = path.join(__dirname + '../../../docs/.tmp/index.html');
      if (fs.existsSync(apiDocumentationPath)) {
        return res.sendFile(apiDocumentationPath);
      }

      const docNotFound = {
        error: 'Local documentation not found',
        desc: 'Please run the command: `npm run build:docs` and restart your server',
      };
      return res.send(docNotFound).status(404);
    }
    // for production and no API_DOCS_URL provided
    const errObj = {
      error: 'Documentation is not available',
      desc: `You can still read documentation from https://docs.hiro.so/api`,
    };
    res.send(errObj).status(404);
  });

  // Setup extended API routes
  app.use(
    '/extended',
    (() => {
      const router = express.Router();
      router.use(cors());
      router.use((req, res, next) => {
        // Set caching on all routes to be disabled by default, individual routes can override
        res.set('Cache-Control', 'no-store');
        next();
      });
      router.use(
        '/v2',
        (() => {
          const v2 = express.Router();
          v2.use('/smart-contracts', createV2SmartContractsRouter(datastore));
          v2.use('/mempool', createMempoolRouter(datastore));
          v2.use('/addresses', createV2AddressesRouter(datastore));
          v2.use('/pox', createPoxRouter(datastore, chainId));
          return v2;
        })()
      );
      return router;
    })()
  );

  // Setup direct proxy to core-node RPC endpoints (/v2)
  // pricing endpoint
  app.use(
    '/v2',
    (() => {
      const router = express.Router();
      router.use(cors());
      router.use('/prices', createBnsPriceRouter(datastore, chainId));
      router.use('/', createCoreNodeRpcProxyRouter(datastore));

      return router;
    })()
  );

  // Rosetta API -- https://www.rosetta-api.org
  if (parseBoolean(process.env['STACKS_API_ENABLE_ROSETTA'] ?? '1'))
    app.use(
      '/rosetta/v1',
      (() => {
        const router = express.Router();
        router.use(cors());
        router.use('/network', createRosettaNetworkRouter(datastore, chainId));
        router.use('/mempool', createRosettaMempoolRouter(datastore, chainId));
        router.use('/block', createRosettaBlockRouter(datastore, chainId));
        router.use('/account', createRosettaAccountRouter(datastore, chainId));
        router.use('/construction', createRosettaConstructionRouter(datastore, chainId));
        return router;
      })()
    );

  // Setup legacy API v1 and v2 routes
  app.use(
    '/v1',
    (() => {
      const router = express.Router();
      router.use(cors());
      router.use('/namespaces', createBnsNamespacesRouter(datastore));
      router.use('/names', createBnsNamesRouter(datastore, chainId));
      router.use('/addresses', createBnsAddressesRouter(datastore, chainId));
      return router;
    })()
  );

  //handle invalid request gracefully
  app.use((req, res) => {
    res.status(404).json({ message: `${req.method} ${req.path} not found` });
  });

  // Setup error handler (must be added at the end of the middleware stack)
  app.use(((error, req, res, next) => {
    if (req.method === 'GET' && res.statusCode !== 200 && res.hasHeader('ETag')) {
      logger.error(
        error,
        `Non-200 request has ETag: ${res.header('ETag')}, Cache-Control: ${res.header(
          'Cache-Control'
        )}`
      );
    }
    if (error && res.headersSent && res.statusCode !== 200 && res.hasHeader('ETag')) {
      logger.error(
        error,
        `A non-200 response with an error in request processing has ETag: ${res.header(
          'ETag'
        )}, Cache-Control: ${res.header('Cache-Control')}`
      );
    }
    if (!res.headersSent && (error || res.statusCode !== 200)) {
      setResponseNonCacheable(res);
    }
    if (error && !res.headersSent) {
      if (error instanceof InvalidRequestError) {
        logger.warn(error, error.message);
        res.status(error.status).json({ error: error.message }).end();
      } else if (isPgConnectionError(error)) {
        res.status(503).json({ error: `The database service is unavailable` }).end();
      } else {
        res.status(500);
        const errorTag = uuid();
        Object.assign(error, { errorTag: errorTag });
        res
          .json({ error: error.toString(), stack: (error as Error).stack, errorTag: errorTag })
          .end();
      }
    }
    next(error);
  }) as express.ErrorRequestHandler);

  // Store all the registered express routes for usage with metrics reporting
  routes = expressListEndpoints(app).map(endpoint => ({
    path: endpoint.path,
    regexp: pathToRegex.pathToRegexp(endpoint.path),
  }));

  // Manual route definitions for the /v2/ proxied endpoints
  routes.push({
    path: '/v2/pox',
    regexp: /^\/v2\/pox(.*)/,
  });
  routes.push({
    path: '/v2/info',
    regexp: /^\/v2\/info(.*)/,
  });
  routes.push({
    path: '/v2/accounts/*',
    regexp: /^\/v2\/accounts(.*)/,
  });
  routes.push({
    path: '/v2/contracts/call-read/*',
    regexp: /^\/v2\/contracts\/call-read(.*)/,
  });
  routes.push({
    path: '/v2/map_entry/*',
    regexp: /^\/v2\/map_entry(.*)/,
  });
  routes.push({
    path: '/v2/*',
    regexp: /^\/v2(.*)/,
  });

  const fastify = Fastify({
    trustProxy: true,
    logger: PINO_LOGGER_CONFIG,
  }).withTypeProvider<TypeBoxTypeProvider>();
  fastify.decorate('db', opts.datastore);
  fastify.decorate('writeDb', opts.writeDatastore);
  fastify.decorate('chainId', opts.chainId);
  await fastify.register(FastifyMetrics, { endpoint: null });
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
    },
    { prefix: '/extended/v2' }
  );

  // This will be a messy list as routes are migrated to Fastify,
  // However, it's the most straightforward way to split between Fastify and Express without
  // introducing a bunch of problamatic middleware side-effects.
  // Once all `/extended` routes are migrated it will be simplified to something like "only use Express for Rosetta routes".
  const fastifyPaths = new RegExp(['^/$', '^/extended'].join('|'), 'i');

  const server = createServer(async (req, res) => {
    const path = new URL(req.url as string, 'http://x').pathname;
    if (fastifyPaths.test(path)) {
      // handle with fastify
      await fastify.ready();
      fastify.server.emit('request', req, res);
    } else {
      // handle with express
      app(req, res);
    }
  });

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
    expressApp: app,
    fastifyApp: fastify,
    server: server,
    ws: ws,
    address: addrStr,
    datastore: datastore,
    terminate: terminate,
    forceKill: forceKill,
  };
}
