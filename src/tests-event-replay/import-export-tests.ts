import { ChainID } from '@stacks/transactions';
import * as fs from 'fs';
import { getRawEventRequests } from '../event-replay/event-requests';
import { PgWriteStore } from '../datastore/pg-write-store';
import { exportEventsAsTsv, importEventsFromTsv } from '../event-replay/event-replay';
import { startEventServer } from '../event-stream/event-server';
import { httpPostRequest } from '../helpers';
import { useWithCleanup } from '../tests/test-helpers';
import { migrate } from '../test-utils/test-helpers';
import { PgSqlClient, dangerousDropAllTables, databaseHasData } from '@hirosystems/api-toolkit';
import { getConnectionArgs } from '../datastore/connection';

describe('import/export tests', () => {
  let db: PgWriteStore;

  beforeEach(async () => {
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
    const chainTip = await db.getChainTip();
    expect(chainTip.block_height).toBe(28);
    expect(chainTip.index_block_hash).toBe(
      '0x76cd67a65c0dfd5ea450bb9efe30da89fa125bfc077c953802f718353283a533'
    );
    expect(chainTip.block_hash).toBe(
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
      const newChainTip = await db.getChainTip();
      expect(newChainTip.block_height).toBe(28);
      expect(newChainTip.index_block_hash).toBe(
        '0x76cd67a65c0dfd5ea450bb9efe30da89fa125bfc077c953802f718353283a533'
      );
      expect(newChainTip.block_hash).toBe(
        '0x7682af212d3c1ef62613412f9b5a727269b4548f14eca2e3f941f7ad8b3c11b2'
      );
    } finally {
      fs.rmSync(tmpDir, { force: true, recursive: true });
    }
  });

  test('import with db wipe options', async () => {
    // Migrate first so we have some data.
    await migrate('up');
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
    const args = getConnectionArgs();
    await migrate('up');

    // Having tables counts as having data as this may change across major versions.
    await expect(databaseHasData(args)).resolves.toBe(true);

    // Dropping all tables removes everything.
    await dangerousDropAllTables(args, {
      acknowledgePotentialCatastrophicConsequences: 'yes',
    });
    await expect(databaseHasData(args)).resolves.toBe(false);

    // Cycling migrations leaves the `pgmigrations` table.
    await migrate('up');
    await migrate('down');
    await expect(databaseHasData(args)).resolves.toBe(true);
    await expect(databaseHasData(args, { ignoreMigrationTables: true })).resolves.toBe(false);
  });

  test('Bns import occurs (block 1 genesis)', async () => {
    process.env.BNS_IMPORT_DIR = 'src/tests-bns/import-test-files';
    await importEventsFromTsv('src/tests-event-replay/tsv/mocknet.tsv', 'archival', true, true);
    const configState = await db.getConfigState();
    expect(configState.bns_names_onchain_imported).toBe(true);
    expect(configState.bns_subdomains_imported).toBe(true);
  });

  test('Bns import occurs (block 0 genesis)', async () => {
    process.env.BNS_IMPORT_DIR = 'src/tests-bns/import-test-files';
    await importEventsFromTsv(
      'src/tests-event-replay/tsv/mainnet-block0.tsv',
      'archival',
      true,
      true
    );
    const configState = await db.getConfigState();
    expect(configState.bns_names_onchain_imported).toBe(true);
    expect(configState.bns_subdomains_imported).toBe(true);
  });

  test('BNS import should be skipped for Stacks subnet nodes', async () => {
    process.env.STACKS_NODE_TYPE = 'subnet';
    process.env.BNS_IMPORT_DIR = 'src/tests-bns/import-test-files';
    await importEventsFromTsv('src/tests-event-replay/tsv/mocknet.tsv', 'archival', true, true);
    const configState = await db.getConfigState();
    expect(configState.bns_names_onchain_imported).toBe(false);
    expect(configState.bns_subdomains_imported).toBe(false);
  });
});

describe('IBD', () => {
  let db: PgWriteStore;
  let client: PgSqlClient;

  beforeEach(async () => {
    await migrate('up');
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
    await migrate('down');
  });

  const getIbdInterceptCountFromTsvEvents = async (): Promise<number> => {
    let ibdResponses = 0;
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
        });
        return [eventServer, eventServer.closeAsync] as const;
      },
      async (rawEventsIterator, eventServer) => {
        for await (const rawEvents of rawEventsIterator) {
          for (const rawEvent of rawEvents) {
            const result = await httpPostRequest({
              host: '127.0.0.1',
              port: eventServer.serverAddress.port,
              path: rawEvent.event_path,
              headers: { 'Content-Type': 'application/json' },
              body: Buffer.from(rawEvent.payload, 'utf8'),
              throwOnNotOK: true,
            });
            if (result.response === 'IBD') {
              expect(result.statusCode).toBe(200);
              ibdResponses++;
            }
          }
        }
      }
    );
    return ibdResponses;
  };

  test('IBD mode blocks certain API routes', async () => {
    process.env.IBD_MODE_UNTIL_BLOCK = '1000';
    // TSV has 1 microblock message.
    await expect(getIbdInterceptCountFromTsvEvents()).resolves.toBe(1);
    await expect(db.getChainTip()).resolves.toHaveProperty('block_height', 28);
  });

  test('IBD mode does NOT block certain API routes once the threshold number of blocks are ingested', async () => {
    process.env.IBD_MODE_UNTIL_BLOCK = '1';
    // Microblock processed normally.
    await expect(getIbdInterceptCountFromTsvEvents()).resolves.toBe(0);
    await expect(db.getChainTip()).resolves.toHaveProperty('block_height', 28);
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
      if (response.response === 'IBD') {
        hitIbdRoute = true;
      }
    }
    expect(hitIbdRoute).toBe(true);
  });
});
