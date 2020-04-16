import { Server } from 'http';
import * as express from 'express';
import * as compression from 'compression';
import { addAsync, ExpressWithAsync } from '@awaitjs/express';
import { DataStore } from '../datastore/common';
import { createTxRouter } from './routes/tx';
import { createDebugRouter } from './routes/debug';
import { createContractRouter } from './routes/contract';

export function startApiServer(
  datastore: DataStore
): Promise<{ expressApp: ExpressWithAsync; server: Server }> {
  return new Promise(resolve => {
    const app = addAsync(express());

    const apiHost = process.env['STACKS_SIDECAR_API_HOST'];
    const apiPort = Number.parseInt(process.env['STACKS_SIDECAR_API_PORT'] ?? '');
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

    app.use('/tx', createTxRouter(datastore));
    app.use('/contract', createContractRouter(datastore));
    app.use('/debug', createDebugRouter(datastore));
    app.use('/status', (req, res) => {
      res.status(200).json({ status: 'ready' });
    });

    const server = app.listen(apiPort, apiHost, () => {
      const addr = server.address();
      if (addr === null) {
        throw new Error('server missing address');
      }
      const addrStr = typeof addr === 'string' ? addr : `${addr.address}:${addr.port}`;
      console.log(`API server listening on: http://${addrStr}`);
      resolve({ expressApp: app, server: server });
    });
  });
}
