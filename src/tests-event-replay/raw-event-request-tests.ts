import * as fs from 'fs';
import { PgWriteStore } from '../datastore/pg-write-store';
import { runMigrations } from '../datastore/migrations';
import { ChainID } from '@stacks/transactions';
import { httpPostRequest } from '../helpers';
import { EventStreamServer, startEventServer } from '../event-stream/event-server';
import { cycleMigrations } from '../datastore/migrations';
import { PgSqlClient } from '../datastore/connection';
import { getRawEventRequests } from '../datastore/event-requests';
import { useWithCleanup } from '../tests/test-helpers';

describe('Events table', () => {
  let db: PgWriteStore;
  let client: PgSqlClient;
  let eventServer: EventStreamServer;

  beforeEach(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgWriteStore.connect({ usageName: 'tests', withNotifier: false });
    client = db.sql;
    eventServer = await startEventServer({
      datastore: db,
      chainId: ChainID.Mainnet,
      serverHost: '127.0.0.1',
      serverPort: 0,
    });
  });

  afterEach(async () => {
    await eventServer.closeAsync();
    await db?.close();
    await runMigrations(undefined, 'down');
  });

  test('If there is an event request error, then the event will not be recorded in the events_observer_request table', async () => {
    const getRawEventCount = async () =>
      await client<Promise<number>[]>`SELECT count(*) from event_observer_requests`;

    await useWithCleanup(
      () => {
        const readStream = fs.createReadStream('src/tests-event-replay/tsv/mainnet.tsv');
        const rawEventsIterator = getRawEventRequests(readStream);
        return [rawEventsIterator, () => readStream.close()] as const;
      },
      async () => {
        const eventServer = await startEventServer({
          datastore: db,
          chainId: ChainID.Mainnet,
          serverHost: '127.0.0.1',
          serverPort: 0,
        });
        return [eventServer, eventServer.closeAsync] as const;
      },
      async (rawEventsIterator, eventServer) => {
        for await (const rawEvents of rawEventsIterator) {
          for (const rawEvent of rawEvents) {
            try {
              if (rawEvent.event_path === '/new_block') {
                const payloadJson = JSON.parse(rawEvent.payload);
                payloadJson.transactions = undefined;
                rawEvent.payload = JSON.stringify(payloadJson);
              }
            } catch (error) {}
            const rawEventRequestCountResultBefore = await getRawEventCount();
            const rawEventRequestCountBefore = rawEventRequestCountResultBefore[0];
            const response = await httpPostRequest({
              host: '127.0.0.1',
              port: eventServer.serverAddress.port,
              path: rawEvent.event_path,
              headers: { 'Content-Type': 'application/json' },
              body: Buffer.from(rawEvent.payload, 'utf8'),
              throwOnNotOK: false,
            });
            if (rawEvent.event_path === '/new_block') {
              expect(response.statusCode).toBe(500);
              const rawEventRequestCountResultAfter = await getRawEventCount();
              const rawEventRequestCountAfter = rawEventRequestCountResultAfter[0];
              expect(rawEventRequestCountBefore).toEqual(rawEventRequestCountAfter);
            }
          }
        }
      }
    );
  });
});
