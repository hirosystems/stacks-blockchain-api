import { Server, createServer } from 'http';
import { Socket } from 'net';
import * as express from 'express';
import { v4 as uuid } from 'uuid';
import * as cors from 'cors';

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
import { ChainID, apiDocumentationUrl, getChainIDNetwork, isProdEnv, waiter } from '../helpers';
import { InvalidRequestError } from '../errors';
import { createBurnchainRouter } from './routes/burnchain';
import { createBnsNamespacesRouter } from './routes/bns/namespaces';
import { createBnsPriceRouter } from './routes/bns/pricing';
import { createBnsNamesRouter } from './routes/bns/names';
import { createBnsAddressesRouter } from './routes/bns/addresses';
import * as pathToRegex from 'path-to-regexp';
import * as expressListEndpoints from 'express-list-endpoints';
import { createMiddleware as createPrometheusMiddleware } from '@promster/express';
import { createMicroblockRouter } from './routes/microblock';
import { createStatusRouter } from './routes/status';
import { createTokenRouter } from './routes/tokens';
import { createFeeRateRouter } from './routes/fee-rate';
import { setResponseNonCacheable } from './controllers/cache-controller';

import * as path from 'path';
import * as fs from 'fs';
import { PgStore } from '../datastore/pg-store';
import { PgWriteStore } from '../datastore/pg-write-store';
import { WebSocketTransmitter } from './routes/ws/web-socket-transmitter';
import { createPox2EventsRouter } from './routes/pox2';
import { createPox3EventsRouter } from './routes/pox3';
import { isPgConnectionError } from '../datastore/helpers';
import { createStackingRouter } from './routes/stacking';
import { logger, loggerMiddleware } from '../logger';

export interface ApiServer {
  expressApp: express.Express;
  server: Server;
  ws: WebSocketTransmitter;
  address: string;
  datastore: PgStore;
  terminate: () => Promise<void>;
  forceKill: () => Promise<void>;
}

/** API version as given by .git-info */
export const API_VERSION: { branch?: string; commit?: string; tag?: string } = {};

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

  try {
    const [branch, commit, tag] = fs.readFileSync('.git-info', 'utf-8').split('\n');
    API_VERSION.branch = branch;
    API_VERSION.commit = commit;
    API_VERSION.tag = tag;
  } catch (error) {
    logger.error(error, `Unable to read API version from .git-info`);
  }

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
  // Add API version to header
  app.use((_, res, next) => {
    res.setHeader(
      'X-API-Version',
      `${API_VERSION.tag} (${API_VERSION.branch}:${API_VERSION.commit})`
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

  app.get('/', (req, res) => {
    res.redirect(`/extended/v1/status`);
  });

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

  // Setup extended API v1 routes
  app.use(
    '/extended/v1',
    (() => {
      const router = express.Router();
      router.use(cors());
      router.use((req, res, next) => {
        // Set caching on all routes to be disabled by default, individual routes can override
        res.set('Cache-Control', 'no-store');
        next();
      });
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
      router.use('/tokens', createTokenRouter(datastore));
      router.use('/pox2_events', createPox2EventsRouter(datastore));
      router.use('/pox3_events', createPox3EventsRouter(datastore));
      if (getChainIDNetwork(chainId) === 'testnet' && writeDatastore) {
        router.use('/faucets', createFaucetRouter(writeDatastore));
      }
      return router;
    })()
  );

  app.use(
    '/extended/beta',
    (() => {
      const router = express.Router();
      router.use(cors());
      router.use((req, res, next) => {
        // Set caching on all routes to be disabled by default, individual routes can override
        res.set('Cache-Control', 'no-store');
        next();
      });
      router.use('/stacking', createStackingRouter(datastore));
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

  const server = createServer(app);

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
    server: server,
    ws: ws,
    address: addrStr,
    datastore: datastore,
    terminate: terminate,
    forceKill: forceKill,
  };
}
