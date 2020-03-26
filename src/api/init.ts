import * as express from 'express';
import * as compression from 'compression';
import { addAsync } from '@awaitjs/express';
import { DataStore } from '../datastore/common';

import { txidRouter } from './routes/txid';
import { Server } from 'http';

export function startApiServer(datastore: DataStore): Promise<{ expressApp: express.Express; server: Server }> {
  return new Promise(resolve => {
    const app = addAsync(express());

    app.set('db', datastore);

    app.use(compression());
    app.disable('x-powered-by');

    app.use('/txid', txidRouter);

    const apiHost = process.env['STACKS_SIDECAR_API_HOST'];
    const apiPort = Number.parseInt(process.env['STACKS_SIDECAR_API_PORT'] ?? '');
    if (!apiHost) {
      throw new Error(`STACKS_SIDECAR_API_HOST must be specified, e.g. "STACKS_SIDECAR_API_HOST=127.0.0.1"`);
    }
    if (!apiPort) {
      throw new Error(`STACKS_SIDECAR_API_PORT must be specified, e.g. "STACKS_SIDECAR_API_PORT=3999"`);
    }

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
