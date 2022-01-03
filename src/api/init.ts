import { Server, createServer } from 'http';
import { Socket } from 'net';
import * as express from 'express';
import * as expressWinston from 'express-winston';
import * as winston from 'winston';
import { v4 as uuid } from 'uuid';
import * as cors from 'cors';
import * as WebSocket from 'ws';
import * as SocketIO from 'socket.io';

import { DataStore } from '../datastore/common';
import { createTxRouter } from './routes/tx';
import { createDebugRouter } from './routes/debug';
import { createInfoRouter } from './routes/info';
import { createContractRouter } from './routes/contract';
import { createCoreNodeRpcProxyRouter } from './routes/core-node-rpc-proxy';
import { createBlockRouter } from './routes/block';
import { createFaucetRouter } from './routes/faucets';
import { createAddressRouter } from './routes/address';
import { createSearchRouter } from './routes/search';
import { createStxSupplyRouter } from './routes/stx-supply';
import { createRosettaNetworkRouter } from './routes/rosetta/network';
import { createRosettaMempoolRouter } from './routes/rosetta/mempool';
import { createRosettaBlockRouter } from './routes/rosetta/block';
import { createRosettaAccountRouter } from './routes/rosetta/account';
import { createRosettaConstructionRouter } from './routes/rosetta/construction';
import { isProdEnv, logError, logger, LogLevel, waiter } from '../helpers';
import { createWsRpcRouter } from './routes/ws/ws-rpc';
import { createSocketIORouter } from './routes/ws/socket-io';
import { createBurnchainRouter } from './routes/burnchain';
import { createBnsNamespacesRouter } from './routes/bns/namespaces';
import { createBnsPriceRouter } from './routes/bns/pricing';
import { createBnsNamesRouter } from './routes/bns/names';
import { createBnsAddressesRouter } from './routes/bns/addresses';

import { ChainID } from '@stacks/transactions';

import * as pathToRegex from 'path-to-regexp';
import * as expressListEndpoints from 'express-list-endpoints';
import { createMiddleware as createPrometheusMiddleware } from '@promster/express';
import { createMicroblockRouter } from './routes/microblock';
import { createStatusRouter } from './routes/status';
import { createTokenRouter } from './routes/tokens/tokens';
import { createFeeRateRouter } from './routes/fee-rate';
import { setResponseNonCacheable } from './controllers/cache-controller';
import * as swaggerUi from 'swagger-ui-express';
import * as yaml from 'yamljs';
const swaggerDocument = yaml.load('docs/openapi.yaml');

export interface ApiServer {
  expressApp: express.Express;
  server: Server;
  wss: WebSocket.Server;
  io: SocketIO.Server;
  address: string;
  datastore: DataStore;
  terminate: () => Promise<void>;
  forceKill: () => Promise<void>;
}

export async function startApiServer(opts: {
  datastore: DataStore;
  chainId: ChainID;
  /** If not specified, this is read from the STACKS_BLOCKCHAIN_API_HOST env var. */
  serverHost?: string;
  /** If not specified, this is read from the STACKS_BLOCKCHAIN_API_PORT env var. */
  serverPort?: number;
  httpLogLevel?: LogLevel;
}): Promise<ApiServer> {
  const { datastore, chainId, serverHost, serverPort, httpLogLevel } = opts;

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

  // app.use(compression());
  // app.disable('x-powered-by');

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
            let pathTemplate = new URL(path, 'http://x').pathname;
            // Match request url to the Express route, e.g.:
            // `/extended/v1/address/ST26DR4VGV507V1RZ1JNM7NN4K3DTGX810S62SBBR/stx` to
            // `/extended/v1/address/:stx_address/stx`
            for (const pathRegex of routes) {
              if (pathRegex.regexp.test(pathTemplate)) {
                pathTemplate = pathRegex.path;
                break;
              }
            }
            return pathTemplate;
          } catch (error) {
            logger.warn(`Warning: ${error}`);
            return path;
          }
        },
      },
    });
    app.use(promMiddleware);
  }
  // Setup request logging
  app.use(
    expressWinston.logger({
      format: logger.format,
      transports: logger.transports,
      metaField: (null as unknown) as string,
      statusLevels: {
        error: 'error',
        warn: httpLogLevel ?? 'http',
        success: httpLogLevel ?? 'http',
      },
    })
  );

  app.set('json spaces', 2);

  // Turn off Express's etag handling. By default CRC32 hashes are generated over response payloads
  // which are useless for our use case and wastes CPU.
  // See https://expressjs.com/en/api.html#etag.options.table
  app.set('etag', false);

  app.get('/', (req, res) => {
    res.redirect(`/extended/v1/status`);
  });

  if (!isProdEnv) {
    app.use('/doc', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
  }

  // Setup extended API v1 routes
  app.use(
    '/extended/v1',
    (() => {
      const router = express.Router();
      router.use(cors());
      router.use('/tx', createTxRouter(datastore));
      router.use('/block', createBlockRouter(datastore));
      router.use('/microblock', createMicroblockRouter(datastore));
      router.use('/burnchain', createBurnchainRouter(datastore));
      router.use('/contract', createContractRouter(datastore));
      // same here, exclude account nonce route
      router.use('/address', createAddressRouter(datastore, chainId));
      router.use('/search', createSearchRouter(datastore));
      router.use('/info', createInfoRouter(datastore));
      router.use('/stx_supply', createStxSupplyRouter(datastore));
      router.use('/debug', createDebugRouter(datastore));
      router.use('/status', createStatusRouter(datastore));
      router.use('/fee_rate', createFeeRateRouter(datastore));
      router.use('/faucets', createFaucetRouter(datastore));
      router.use('/tokens', createTokenRouter(datastore));
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
      router.use('/names', createBnsNamesRouter(datastore));
      router.use('/addresses', createBnsAddressesRouter(datastore));
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
        `Non-200 request has ETag: ${res.header('ETag')}, Cache-Control: ${res.header(
          'Cache-Control'
        )}`
      );
    }
    if (error && res.headersSent && res.statusCode !== 200 && res.hasHeader('ETag')) {
      logger.error(
        `A non-200 response with an error in request processing has ETag: ${res.header(
          'ETag'
        )}, Cache-Control: ${res.header('Cache-Control')}`
      );
    }
    if (!res.headersSent && (error || res.statusCode !== 200)) {
      setResponseNonCacheable(res);
    }
    if (error && !res.headersSent) {
      res.status(500);
      const errorTag = uuid();
      Object.assign(error, { errorTag: errorTag });
      res
        .json({ error: error.toString(), stack: (error as Error).stack, errorTag: errorTag })
        .end();
    }
    next(error);
  }) as express.ErrorRequestHandler);

  app.use(
    expressWinston.errorLogger({
      winstonInstance: logger as winston.Logger,
      metaField: (null as unknown) as string,
      blacklistedMetaFields: ['trace', 'os', 'process'],
    })
  );

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

  const server = createServer(app);

  const serverSockets = new Set<Socket>();
  server.on('connection', socket => {
    serverSockets.add(socket);
    socket.once('close', () => {
      serverSockets.delete(socket);
    });
  });

  // Setup socket.io server
  const io = createSocketIORouter(datastore, server);

  // Setup websockets RPC endpoint
  const wss = createWsRpcRouter(datastore, server);

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
      logger.info('Closing Socket.io server...');
      io.close(error => {
        if (error) {
          logError('Failed to gracefully close Socket.io server', error);
          reject(error);
        } else {
          logger.info('API socket.io server closed.');
          resolve();
        }
      });
    });
    await new Promise<void>((resolve, reject) => {
      logger.info('Closing WebSocket server...');
      wss.close(error => {
        if (error) {
          logError('Failed to gracefully close WebSocket server.');
          reject(error);
        } else {
          logger.info('WebSocket server closed.');
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
    const [ioClosePromise, wssClosePromise, serverClosePromise] = [waiter(), waiter(), waiter()];
    io.close(() => ioClosePromise.finish());
    wss.close(() => wssClosePromise.finish());
    server.close(() => serverClosePromise.finish());
    for (const socket of serverSockets) {
      socket.destroy();
    }
    await Promise.allSettled([ioClosePromise, wssClosePromise, serverClosePromise]);
  };

  const addr = server.address();
  if (addr === null) {
    throw new Error('server missing address');
  }
  const addrStr = typeof addr === 'string' ? addr : `${addr.address}:${addr.port}`;
  return {
    expressApp: app,
    server: server,
    wss: wss,
    io: io,
    address: addrStr,
    datastore: datastore,
    terminate: terminate,
    forceKill: forceKill,
  };
}
