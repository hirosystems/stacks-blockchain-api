import { ChainID } from '@stacks/transactions';
import { bnsNameCV, httpPostRequest } from '../../helpers';
import { EventStreamServer, startEventServer } from '../../event-stream/event-server';
import { TestBlockBuilder, TestMicroblockStreamBuilder } from '../../test-utils/test-builders';
import { DbAssetEventTypeId, DbBnsZoneFile } from '../../datastore/common';
import { PgWriteStore } from '../../datastore/pg-write-store';
import { cycleMigrations, runMigrations } from '../../datastore/migrations';
import { PgSqlClient } from '../../datastore/connection';
import { CoreNodeBlockMessage } from 'src/event-stream/core-node-message';
import { getRawEventRequests } from 'src/datastore/event-requests';

describe('BNS event server tests', () => {
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
      httpLogLevel: 'debug',
    });
  });

  afterEach(async () => {
    await eventServer.closeAsync();
    await db?.close();
    await runMigrations(undefined, 'down');
  });

  test('If there is an event request error, then the event will not be recorded in the events_observer_request table', async () => {
    const routes = [
      '/new_block',
      '/new_burn_block',
      '/new_mempool_tx',
      '/drop_mempool_tx',
      '/attachments/new',
      '/new_microblocks',
    ];
    const invalidBody = {};
    const getRawEventCount = async () =>
      await client<Promise<number>[]>`SELECT count(*) from event_observer_requests`;

    for (const route of routes) {
      const rawEventRequestCountResultBefore = await getRawEventCount();
      const rawEventRequestCountBefore = rawEventRequestCountResultBefore[0];
      const post = await httpPostRequest({
        host: '127.0.0.1',
        port: eventServer.serverAddress.port,
        path: route,
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(JSON.stringify(invalidBody), 'utf8'),
        throwOnNotOK: false,
      });
      expect(post.statusCode).toBe(500);
      const rawEventRequestCountResultAfter = await getRawEventCount();
      const rawEventRequestCountAfter = rawEventRequestCountResultAfter[0];
      expect(rawEventRequestCountBefore).toEqual(rawEventRequestCountAfter);
    }
  });
});
