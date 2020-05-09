import { Server } from 'http';
import * as express from 'express';
import * as compression from 'compression';
import * as cors from 'cors';
import { addAsync, ExpressWithAsync } from '@awaitjs/express';
import { DataStore } from '../datastore/common';
import { createTxRouter } from './routes/tx';
import { createDebugRouter } from './routes/debug';
import { createContractRouter } from './routes/contract';
import { createCoreNodeRpcProxyRouter } from './routes/core-node-rpc-proxy';
import { createBlockRouter } from './routes/block';
import { createFaucetRouter } from './routes/faucets';

export interface ApiServer {
  expressApp: ExpressWithAsync;
  server: Server;
  address: string;
}

export async function startApiServer(datastore: DataStore): Promise<ApiServer> {
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

  app.use(compression());
  app.disable('x-powered-by');

  // Setup sidecar API v1 routes
  app.use(
    '/sidecar/v1',
    (() => {
      const router = addAsync(express.Router());
      router.use(cors());
      router.use('/tx', createTxRouter(datastore));
      router.use('/block', createBlockRouter(datastore));
      router.use('/contract', createContractRouter(datastore));
      router.use('/debug', createDebugRouter(datastore));
      router.use('/status', (req, res) => res.status(200).json({ status: 'ready' }));
      router.use('/faucets', createFaucetRouter());
      return router;
    })()
  );

  // Setup direct proxy to core-node RPC endpoints (/v2)
  app.use('/v2', createCoreNodeRpcProxyRouter());

  // TODO: last chance middleware error logging

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
  return {
    expressApp: app,
    server: server,
    address: addrStr,
  };
}
