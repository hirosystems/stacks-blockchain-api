import { ChainID } from '@stacks/transactions';
import * as fs from 'fs';
import { PgSqlClient } from '../datastore/connection';
import { getPgClientConfig } from '../datastore/connection-legacy';
import { databaseHasData, getRawEventRequests } from '../datastore/event-requests';
import { cycleMigrations, dangerousDropAllTables, runMigrations } from '../datastore/migrations';
import { PgWriteStore } from '../datastore/pg-write-store';
import { exportEventsAsTsv, importEventsFromTsv } from '../event-replay/event-replay';
import { startEventServer } from '../event-stream/event-server';
import { httpPostRequest } from '../helpers';
import { useWithCleanup } from '../tests/test-helpers';

describe('import/export tests', () => {
  let db: PgWriteStore;

  beforeEach(async () => {
    process.env.PG_DATABASE = 'postgres';
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
  });

  afterEach(async () => {
    await db?.close();
  });

  test('event import and export cycle', async () => {
    // Import from mocknet TSV
    await importEventsFromTsv('src/tests-event-replay/tsv/mocknet.tsv', 'archival', true, true);
    const chainTip = await db.getUnanchoredChainTip();
    expect(chainTip.found).toBe(true);
    expect(chainTip.result?.blockHeight).toBe(28);
    expect(chainTip.result?.indexBlockHash).toBe(
      '0x76cd67a65c0dfd5ea450bb9efe30da89fa125bfc077c953802f718353283a533'
    );
    expect(chainTip.result?.blockHash).toBe(
      '0x7682af212d3c1ef62613412f9b5a727269b4548f14eca2e3f941f7ad8b3c11b2'
    );

    // Export into temp TSV
    const tmpDir = 'src/tests-event-replay/.tmp';
    try {
      fs.mkdirSync(tmpDir);
    } catch (error: any) {
      if (error.code != 'EEXIST') throw error;
    }
    const tmpTsvPath = `${tmpDir}/export.tsv`;
    await exportEventsAsTsv(tmpTsvPath, true);

    // Re-import with exported TSV and check that chain tip matches.
    try {
      await importEventsFromTsv(`${tmpDir}/export.tsv`, 'archival', true, true);
      const newChainTip = await db.getUnanchoredChainTip();
      expect(newChainTip.found).toBe(true);
      expect(newChainTip.result?.blockHeight).toBe(28);
      expect(newChainTip.result?.indexBlockHash).toBe(
        '0x76cd67a65c0dfd5ea450bb9efe30da89fa125bfc077c953802f718353283a533'
      );
      expect(newChainTip.result?.blockHash).toBe(
        '0x7682af212d3c1ef62613412f9b5a727269b4548f14eca2e3f941f7ad8b3c11b2'
      );
    } finally {
      fs.rmSync(tmpDir, { force: true, recursive: true });
    }
  });

  test('import with db wipe options', async () => {
    // Migrate first so we have some data.
    const clientConfig = getPgClientConfig({ usageName: 'cycle-migrations' });
    await runMigrations(clientConfig, 'up', {});
    await expect(
      importEventsFromTsv('src/tests-event-replay/tsv/mocknet.tsv', 'archival', false, false)
    ).rejects.toThrowError('contains existing data');

    // Create strange table
    await db.sql`CREATE TABLE IF NOT EXISTS test (a varchar(10))`;
    await expect(
      importEventsFromTsv('src/tests-event-replay/tsv/mocknet.tsv', 'archival', true, false)
    ).rejects.toThrowError('migration cycle failed');

    // Force and test
    await expect(
      importEventsFromTsv('src/tests-event-replay/tsv/mocknet.tsv', 'archival', true, true)
    ).resolves.not.toThrow();
  });

  test('db contains data', async () => {
    const clientConfig = getPgClientConfig({ usageName: 'cycle-migrations' });
    await runMigrations(clientConfig, 'up', {});

    // Having tables counts as having data as this may change across major versions.
    await expect(databaseHasData()).resolves.toBe(true);

    // Dropping all tables removes everything.
    await dangerousDropAllTables({ acknowledgePotentialCatastrophicConsequences: 'yes' });
    await expect(databaseHasData()).resolves.toBe(false);

    // Cycling migrations leaves the `pgmigrations` table.
    await runMigrations(clientConfig, 'up', {});
    await runMigrations(clientConfig, 'down', {});
    await expect(databaseHasData()).resolves.toBe(true);
    await expect(databaseHasData({ ignoreMigrationTables: true })).resolves.toBe(false);
  });

  test('Bns import occurs', async () => {
    process.env.BNS_IMPORT_DIR = 'src/tests-bns/import-test-files';
    await importEventsFromTsv('src/tests-event-replay/tsv/mocknet.tsv', 'archival', true, true);
    const configState = await db.getConfigState();
    expect(configState.bns_names_onchain_imported).toBe(true);
    expect(configState.bns_subdomains_imported).toBe(true);
  });
});

describe('IBD', () => {
  let db: PgWriteStore;
  let client: PgSqlClient;
  const ibdRoutes = ['/new_microblocks', '/new_mempool_tx', '/drop_mempool_tx'];

  beforeEach(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    client = db.sql;
  });

  afterEach(async () => {
    process.env.IBD_MODE_UNTIL_BLOCK = undefined;
    await db?.close();
    await runMigrations(undefined, 'down');
  });

  test('IBD mode blocks certain API routes', async () => {
    process.env.IBD_MODE_UNTIL_BLOCK = '1000';
    const ibdRoutesVisited = new Set();

    await useWithCleanup(
      () => {
        const readStream = fs.createReadStream('src/tests-event-replay/tsv/mocknet.tsv');
        const rawEventsIterator = getRawEventRequests(readStream);
        return [rawEventsIterator, () => readStream.close()] as const;
      },
      async () => {
        const eventServer = await startEventServer({
          datastore: db,
          chainId: ChainID.Mainnet,
          serverHost: '127.0.0.1',
          serverPort: 0,
          httpLogLevel: 'debug',
        });
        return [eventServer, eventServer.closeAsync] as const;
      },
      async (rawEventsIterator, eventServer) => {
        for await (const rawEvents of rawEventsIterator) {
          for (const rawEvent of rawEvents) {
            ibdRoutesVisited.add(rawEvent.event_path);
            const response = await httpPostRequest({
              host: '127.0.0.1',
              port: eventServer.serverAddress.port,
              path: rawEvent.event_path,
              headers: { 'Content-Type': 'application/json' },
              body: Buffer.from(rawEvent.payload, 'utf8'),
              throwOnNotOK: true,
            });
            if (ibdRoutes.includes(rawEvent.event_path)) {
              expect(response.statusCode).toBe(200);
              expect(response.response).toBe('IBD mode active.');
            }
          }
        }
      }
    );
    expect(ibdRoutesVisited.size).toBeGreaterThan(0);
  });

  test('IBD mode does NOT block certain API routes once the threshold number of blocks are ingested', async () => {
    process.env.IBD_MODE_UNTIL_BLOCK = '1';

    const ibdRoutesVisited = new Set();

    await useWithCleanup(
      () => {
        const readStream = fs.createReadStream('src/tests-event-replay/tsv/mocknet.tsv');
        const rawEventsIterator = getRawEventRequests(readStream);
        return [rawEventsIterator, () => readStream.close()] as const;
      },
      async () => {
        const eventServer = await startEventServer({
          datastore: db,
          chainId: ChainID.Mainnet,
          serverHost: '127.0.0.1',
          serverPort: 0,
          httpLogLevel: 'debug',
        });
        return [eventServer, eventServer.closeAsync] as const;
      },
      async (rawEventsIterator, eventServer) => {
        for await (const rawEvents of rawEventsIterator) {
          for (const rawEvent of rawEvents) {
            ibdRoutesVisited.add(rawEvent.event_path);
            const response = await httpPostRequest({
              host: '127.0.0.1',
              port: eventServer.serverAddress.port,
              path: rawEvent.event_path,
              headers: { 'Content-Type': 'application/json' },
              body: Buffer.from(rawEvent.payload, 'utf8'),
              throwOnNotOK: true,
            });
            if (ibdRoutes.includes(rawEvent.event_path)) {
              const chainTip = await db.getChainTip(client, false);
              const ibdThreshold = Number.parseInt(process.env.IBD_MODE_UNTIL_BLOCK as string);
              if (chainTip.blockHeight < ibdThreshold) {
                expect(response.statusCode).toBe(200);
                expect(response.response).toBe('IBD mode active.');
              } else {
                expect(response.statusCode).toBe(200);
                expect(response.response).not.toBe('IBD mode active.');
              }
            }
          }
        }
      }
    );
    expect(ibdRoutesVisited.size).toBeGreaterThan(0);
  });

  test('IBD mode prevents refreshing materialized views', async () => {
    process.env.IBD_MODE_UNTIL_BLOCK = '1000';
    const result = await db.refreshMaterializedView('fizzbuzz', client);
    expect(result).toBe(undefined);
  });

  test('IBD mode covers prune mode', async () => {
    // Import from mocknet TSV
    const responses = await importEventsFromTsv(
      'src/tests-event-replay/tsv/mocknet.tsv',
      'pruned',
      true,
      true,
      1000
    );
    let hitIbdRoute = false;
    for (const response of responses) {
      console.log({ response });
      if (response.response === 'IBD mode active.') {
        hitIbdRoute = true;
        expect(
          ['/new_mempool_tx', '/drop_mempool_tx', '/new_microblocks'].includes(
            (response as any)?.req?.path
          )
        ).toBe(true);
      }
    }
    expect(hitIbdRoute).toBe(true);
  });
});
