import { Readable, Writable } from 'stream';
import { pipeline } from 'stream/promises';
import { PgWriteStore } from '../../../datastore/pg-write-store';
import { logger } from '../../../logger';
import { DatasetStore } from '../dataset/store';
import { EventStreamServer, startEventServer } from '../../../event-stream/event-server';
import { getApiConfiguredChainID, httpPostRequest } from '../../../helpers';

const chainID = getApiConfiguredChainID();

const processRequests = (eventServer: EventStreamServer) => {
  return new Writable({
    objectMode: true,
    write: async (data, _encoding, next) => {
      await httpPostRequest({
        host: '127.0.0.1',
        port: eventServer.serverAddress.port,
        path: data.method,
        headers: { 'Content-Type': 'application/json' },
        body: data.payload,
        throwOnNotOK: true,
      });

      next();
    },
  });
};

export const processRemainderEvents = async (db: PgWriteStore, dataset: DatasetStore) => {
  logger.info({ component: 'event-replay' }, 'REMAINDER events processing started');

  const eventServer = await startEventServer({
    datastore: db,
    chainId: chainID,
    serverHost: '127.0.0.1',
    serverPort: 0,
  });

  const eventStream = await dataset.remainderEvents();
  const process = processRequests(eventServer);

  await pipeline(
    Readable.from(eventStream),
    process.on('finish', async () => {
      await eventServer.closeAsync();
    })
  );
};
