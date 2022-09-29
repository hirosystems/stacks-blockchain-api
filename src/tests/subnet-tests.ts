import * as fs from 'fs';
import * as supertest from 'supertest';
import { httpPostRequest, logger } from '../helpers';
import { cycleMigrations, runMigrations } from '../datastore/migrations';
import { PgWriteStore } from '../datastore/pg-write-store';
import { useWithCleanup } from './test-helpers';
import { getRawEventRequests } from '../datastore/event-requests';
import { startEventServer } from '../event-stream/event-server';
import { ChainID } from '@stacks/transactions';
import { startApiServer } from '../api/init';

describe('subnet tests', () => {
  let db: PgWriteStore;

  beforeEach(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
  });

  test('NFT use case', async () => {
    await useWithCleanup(
      () => {
        const origLevel = logger.level;
        logger.level = 'error';
        return [, () => (logger.level = origLevel)] as const;
      },
      () => {
        const readStream = fs.createReadStream(
          'src/tests/event-replay-logs/subnet-nft-use-case.tsv'
        );
        const rawEventsIterator = getRawEventRequests(readStream);
        return [rawEventsIterator, () => readStream.close()] as const;
      },
      async () => {
        const eventServer = await startEventServer({
          datastore: db,
          chainId: ChainID.Testnet,
          serverHost: '127.0.0.1',
          serverPort: 0,
          httpLogLevel: 'debug',
        });
        return [eventServer, eventServer.closeAsync] as const;
      },
      async () => {
        const apiServer = await startApiServer({
          datastore: db,
          chainId: ChainID.Testnet,
          httpLogLevel: 'debug',
        });
        return [apiServer, apiServer.terminate] as const;
      },
      async (_, rawEventsIterator, eventServer, api) => {
        for await (const rawEvents of rawEventsIterator) {
          for (const rawEvent of rawEvents) {
            await httpPostRequest({
              host: '127.0.0.1',
              port: eventServer.serverAddress.port,
              path: rawEvent.event_path,
              headers: { 'Content-Type': 'application/json' },
              body: Buffer.from(rawEvent.payload, 'utf8'),
              throwOnNotOK: true,
            });
          }
        }
        // test that the out-of-order microblocks were not stored
        // const mbHash1 = '0xb714e75a7dae26fee0e77788317a0c84e513d1d8647a376b21b1c864e55c135a';
        // const mbResult1 = await supertest(api.server).get(`/extended/v1/microblock/${mbHash1}`);
        // expect(mbResult1.status).toBe(404);
        // const mbHash2 = '0xab9112694f13f7b04996d4b4554af5b5890271fa4e0c9099e67353b42dcf9989';
        // const mbResult2 = await supertest(api.server).get(`/extended/v1/microblock/${mbHash2}`);
        // expect(mbResult2.status).toBe(404);
      }
    );
  });

  afterEach(async () => {
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
