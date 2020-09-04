import { Server, createServer } from 'http';
import { Socket } from 'net';
import * as express from 'express';
import * as expressWinston from 'express-winston';
import { v4 as uuid } from 'uuid';
import * as cors from 'cors';
import { addAsync, ExpressWithAsync } from '@awaitjs/express';
import * as WebSocket from 'ws';

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
import { createRosettaNetworkRouter } from './routes/rosetta/network';
import { createRosettaMempoolRouter } from './routes/rosetta/mempool';
import { createRosettaBlockRouter } from './routes/rosetta/block';
import { createRosettaAccountRouter } from './routes/rosetta/account';
import { logger } from '../helpers';
import { createWsRpcRouter } from './routes/ws-rpc';

export interface ApiServer {
  expressApp: ExpressWithAsync;
  server: Server;
  wss: WebSocket.Server;
  address: string;
  datastore: DataStore;
  terminate: () => Promise<void>;
}

export async function startApiServer(datastore: DataStore): Promise<ApiServer> {
  const app = addAsync(express());

  const apiHost = process.env['STACKS_BLOCKCHAIN_API_HOST'];
  const apiPort = parseInt(process.env['STACKS_BLOCKCHAIN_API_PORT'] ?? '');
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

  // Setup request logging
  app.use(
    expressWinston.logger({
      winstonInstance: logger,
      metaField: (null as unknown) as string,
    })
  );

  app.get('/', (req, res) => {
    res.redirect(`/extended/v1/status`);
  });

  // Setup extended API v1 routes
  app.use(
    '/extended/v1',
    (() => {
      const router = addAsync(express.Router());
      router.use(cors());
      router.use('/tx', createTxRouter(datastore));
      router.use('/block', createBlockRouter(datastore));
      router.use('/contract', createContractRouter(datastore));
      router.use('/address', createAddressRouter(datastore));
      router.use('/search', createSearchRouter(datastore));
      router.use('/info', createInfoRouter(datastore));
      router.use('/debug', createDebugRouter(datastore));
      router.use('/status', (req, res) => res.status(200).json({ status: 'ready' }));
      router.use('/faucets', createFaucetRouter(datastore));
      return router;
    })()
  );

  // Setup direct proxy to core-node RPC endpoints (/v2)
  app.use('/v2', createCoreNodeRpcProxyRouter());

  // Rosetta API -- https://www.rosetta-api.org
  app.use(
    '/rosetta/v1',
    (() => {
      const router = addAsync(express.Router());
      router.use(cors());
      router.use('/network', createRosettaNetworkRouter(datastore));
      router.use('/mempool', createRosettaMempoolRouter(datastore));
      router.use('/block', createRosettaBlockRouter(datastore));
      router.use('/account', createRosettaAccountRouter(datastore));
      return router;
    })()
  );

  // Setup error handler (must be added at the end of the middleware stack)
  app.use(((error, req, res, next) => {
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
      winstonInstance: logger,
      metaField: (null as unknown) as string,
      blacklistedMetaFields: ['trace', 'os', 'process'],
    })
  );

  const server = createServer(app);

  const serverSockets = new Set<Socket>();
  server.on('connection', socket => {
    serverSockets.add(socket);
    socket.on('close', () => {
      serverSockets.delete(socket);
    });
  });

  // Setup websockets RPC endpoint
  const wss = createWsRpcRouter(datastore, server);

  await new Promise<Server>((resolve, reject) => {
    try {
      server.listen(apiPort, apiHost, () => resolve());
    } catch (error) {
      reject(error);
    }
  });

  const terminate = async () => {
    for (const socket of serverSockets) {
      socket.destroy();
    }
    await new Promise((resolve, reject) =>
      wss.close(error => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      })
    );
    await new Promise((resolve, reject) =>
      server.close(error => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      })
    );
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
    address: addrStr,
    datastore: datastore,
    terminate,
  };
}
