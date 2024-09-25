import * as fs from 'fs';
import { PgWriteStore } from '../../src/datastore/pg-write-store';
import { ChainID } from '@stacks/transactions';
import { httpPostRequest } from '../../src/helpers';
import { EventStreamServer, startEventServer } from '../../src/event-stream/event-server';
import { getRawEventRequests } from '../../src/event-replay/event-requests';
import { useWithCleanup } from '../api/test-helpers';
import { PgSqlClient } from '@hirosystems/api-toolkit';
import { migrate } from '../utils/test-helpers';

describe('Events table', () => {
  let db: PgWriteStore;
  let client: PgSqlClient;
  let eventServer: EventStreamServer;

  beforeEach(async () => {
    await migrate('up');
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
    await migrate('down');
  });

  test('If there is an event request error, then the event will not be recorded in the events_observer_request table', async () => {
    const getRawEventCount = async () =>
      await client<Promise<number>[]>`SELECT count(*) from event_observer_requests`;

    await useWithCleanup(
      () => {
        const readStream = fs.createReadStream('tests/event-replay/tsv/mainnet.tsv');
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

  test('Large event requests are stored correctly', async () => {
    const getRawEventCount = async () => {
      const [row] = await client<{ count: string }[]>`SELECT count(*) from event_observer_requests`;
      return Number(row.count);
    };

    await useWithCleanup(
      async () => {
        const eventServer = await startEventServer({
          datastore: db,
          chainId: ChainID.Mainnet,
          serverHost: '127.0.0.1',
          serverPort: 0,
        });
        return [eventServer, eventServer.closeAsync] as const;
      },
      async eventServer => {
        // split the tsv file into lines, split each line by tab, find the first line that has a cell value of `/new_block`
        const sampleTsv = fs
          .readFileSync('tests/event-replay/tsv/mainnet-block0.tsv', 'utf8')
          .split('\n')
          .map(line => line.split('\t'))
          .find(line => line[2] === '/new_block');
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const sampleNewBlock = JSON.parse(sampleTsv![3]);
        console.log(sampleTsv);
        // Create a huge JSON object, 10000 nodes, 20 layers deep, some nodes containing 4 megabytes of data
        function generateNestedObject(depth: number, nodesPerLevel: number, currentDepth = 1): any {
          if (currentDepth > depth) {
            // Return a leaf object instead of trying to link back to the top-level node
            return { info: `Leaf at depth ${currentDepth}` };
          }
          // Create a new object for each call to ensure uniqueness
          const currentNode: any = {};
          for (let i = 0; i < nodesPerLevel; i++) {
            currentNode[`node_${currentDepth}_${i}`] =
              currentDepth === depth
                ? { info: `Simulated large node leaf at ${currentDepth}_${i}` }
                : generateNestedObject(depth, nodesPerLevel, currentDepth + 1);
          }
          return currentNode;
        }
        let hugeJsonObject = generateNestedObject(10, 3);
        hugeJsonObject = Object.assign(hugeJsonObject, sampleNewBlock);
        hugeJsonObject['very_large_value'] = 'x'.repeat(100 * 1024 * 1024); // 100 megabytes
        const rawEvent = {
          event_path: '/new_block',
          payload: JSON.stringify(hugeJsonObject),
        };
        const rawEventRequestCountBefore = await getRawEventCount();
        const response = await httpPostRequest({
          host: '127.0.0.1',
          port: eventServer.serverAddress.port,
          path: rawEvent.event_path,
          headers: { 'Content-Type': 'application/json' },
          body: Buffer.from(rawEvent.payload, 'utf8'),
          throwOnNotOK: false,
        });
        expect(response.statusCode).toBe(200);
        const rawEventRequestCountAfter = await getRawEventCount();
        expect(rawEventRequestCountAfter).toEqual(rawEventRequestCountBefore + 1);
      }
    );
  });
});
