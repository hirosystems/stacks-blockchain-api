import * as express from 'express';
import * as compression from 'compression';
import { DataStore } from '../datastore/common';

import { txidRouter } from './routes/txid';

const port = process.env.API_SERVER || 3999;

export function startApiServer(datastore: DataStore): Promise<express.Express> {
  console.log(datastore);
  return new Promise(resolve => {
    const app = express();

    app.set('db', datastore);

    app.use(compression());
    app.disable('x-powered-by');

    app.use('/txid', txidRouter);

    app.listen(port, () => {
      console.log('API server listening on :' + port);
      resolve();
    });

    return app;
  });
}
