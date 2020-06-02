import { Server } from 'http';
import * as express from 'express';
import * as expressWinston from 'express-winston';
import { v4 as uuid } from 'uuid';
import * as cors from 'cors';
import { addAsync, ExpressWithAsync } from '@awaitjs/express';

import { DataStore } from '../datastore/common';
import { createTxRouter } from './routes/tx';
import { createDebugRouter } from './routes/debug';
import { createContractRouter } from './routes/contract';
import { createCoreNodeRpcProxyRouter } from './routes/core-node-rpc-proxy';
import { createBlockRouter } from './routes/block';
import { createFaucetRouter } from './routes/faucets';
import { createAddressRouter } from './routes/address';
import { logger } from '../helpers';

export async function startApiServer(
  datastore: DataStore
): Promise<{ expressApp: ExpressWithAsync; server: Server; address: string }> {
  const app = addAsync(express());

  const apiHost = process.env['STACKS_SIDECAR_API_HOST'];
  const apiPort = parseInt(process.env['STACKS_SIDECAR_API_PORT'] ?? '');
  if (!apiHost) {
    throw new Error(
      `STACKS_SIDECAR_API_HOST must be specified, e.g. "STACKS_SIDECAR_API_HOST=127.0.0.1"`
    );
  }
  if (!apiPort) {
    throw new Error(
      `STACKS_SIDECAR_API_PORT must be specified, e.g. "STACKS_SIDECAR_API_PORT=3999"`
    );
  }

  // app.use(compression());
  // app.disable('x-powered-by');

  // Setup request logging
  app.use(
    expressWinston.logger({
      winstonInstance: logger,
      metaField: null!,
    })
  );

  // Setup sidecar API v1 routes
  app.use(
    '/sidecar/v1',
    (() => {
      const router = addAsync(express.Router());
      router.use(cors());
      router.use('/tx', createTxRouter(datastore));
      router.use('/block', createBlockRouter(datastore));
      router.use('/contract', createContractRouter(datastore));
      router.use('/address', createAddressRouter(datastore));
      router.use('/debug', createDebugRouter(datastore));
      router.use('/status', (req, res) => res.status(200).json({ status: 'ready' }));
      router.use('/faucets', createFaucetRouter(datastore));
      return router;
    })()
  );

  // Setup direct proxy to core-node RPC endpoints (/v2)
  app.use('/v2', createCoreNodeRpcProxyRouter());

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
      metaField: null!,
      blacklistedMetaFields: ['trace', 'os', 'process'],
    })
  );

  const server = await new Promise<Server>((resolve, reject) => {
    try {
      const server = app.listen(apiPort, apiHost, () => resolve(server));
    } catch (error) {
      reject(error);
    }
  });

  const addr = server.address();
  if (addr === null) {
    throw new Error('server missing address');
  }
  const addrStr = typeof addr === 'string' ? addr : `${addr.address}:${addr.port}`;
  logger.info(`API server listening on: http://${addrStr}`);
  return {
    expressApp: app,
    server: server,
    address: addrStr,
  };
}
