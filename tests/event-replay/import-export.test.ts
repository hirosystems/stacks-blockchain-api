import * as fs from 'fs';
import { PgWriteStore } from '../../src/datastore/pg-write-store';
import { exportEventsAsTsv, importEventsFromTsv } from '../../src/event-replay/event-replay';
import { createSchema, migrate } from '../utils/test-helpers';
import { dangerousDropAllTables, databaseHasData } from '@stacks/api-toolkit';
import { getConnectionArgs } from '../../src/datastore/connection';
import { ENV } from '../../src/env';

describe('import/export tests', () => {
  let db: PgWriteStore;

  beforeEach(async () => {
    ENV.PG_DATABASE = 'postgres';
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
  });

  afterEach(async () => {
    await db?.close();
  });

  test('event import and export cycle - remote', async () => {
    const args = getConnectionArgs();
    // Import from mocknet TSV
    await createSchema(args);
    await importEventsFromTsv('tests/event-replay/tsv/mocknet.tsv', 'archival', true, true);
    const chainTip = await db.getChainTip(db.sql);
    expect(chainTip.block_height).toBe(28);
    expect(chainTip.index_block_hash).toBe(
      '0x76cd67a65c0dfd5ea450bb9efe30da89fa125bfc077c953802f718353283a533'
    );
    expect(chainTip.block_hash).toBe(
      '0x7682af212d3c1ef62613412f9b5a727269b4548f14eca2e3f941f7ad8b3c11b2'
    );

    // Export into temp TSV
    const tmpDir = 'tests/event-replay/.tmp/remote';
    fs.mkdirSync(tmpDir, { recursive: true });
    await exportEventsAsTsv(`${tmpDir}/export.tsv`);

    // Re-import with exported TSV and check that chain tip matches.
    try {
      await importEventsFromTsv(`${tmpDir}/export.tsv`, 'archival', true, true);
      const newChainTip = await db.getChainTip(db.sql);
      expect(newChainTip.block_height).toBe(28);
      expect(newChainTip.index_block_hash).toBe(
        '0x76cd67a65c0dfd5ea450bb9efe30da89fa125bfc077c953802f718353283a533'
      );
      expect(newChainTip.block_hash).toBe(
        '0x7682af212d3c1ef62613412f9b5a727269b4548f14eca2e3f941f7ad8b3c11b2'
      );
    } finally {
      fs.rmSync(`${tmpDir}/export.tsv`, { force: true });
    }
  });

  test('event import and export cycle - local', async () => {
    const args = getConnectionArgs();
    // Import from mocknet TSV
    await createSchema(args);
    await importEventsFromTsv('tests/event-replay/tsv/mocknet.tsv', 'archival', true, true);
    const chainTip = await db.getChainTip(db.sql);
    expect(chainTip.block_height).toBe(28);
    expect(chainTip.index_block_hash).toBe(
      '0x76cd67a65c0dfd5ea450bb9efe30da89fa125bfc077c953802f718353283a533'
    );
    expect(chainTip.block_hash).toBe(
      '0x7682af212d3c1ef62613412f9b5a727269b4548f14eca2e3f941f7ad8b3c11b2'
    );

    // Export into temp TSV
    const tmpDir = 'tests/event-replay/.tmp/local';
    fs.mkdirSync(tmpDir, { recursive: true });
    await exportEventsAsTsv('local:/root/export.tsv');

    // Re-import with exported TSV and check that chain tip matches.
    try {
      await importEventsFromTsv(`${tmpDir}/export.tsv`, 'archival', true, true);
      const newChainTip = await db.getChainTip(db.sql);
      expect(newChainTip.block_height).toBe(28);
      expect(newChainTip.index_block_hash).toBe(
        '0x76cd67a65c0dfd5ea450bb9efe30da89fa125bfc077c953802f718353283a533'
      );
      expect(newChainTip.block_hash).toBe(
        '0x7682af212d3c1ef62613412f9b5a727269b4548f14eca2e3f941f7ad8b3c11b2'
      );
    } finally {
      fs.rmSync(`${tmpDir}/export.tsv`, { force: true });
    }
  });

  test('import with db wipe options', async () => {
    // Migrate first so we have some data.
    await migrate('up');
    await expect(
      importEventsFromTsv('tests/event-replay/tsv/mocknet.tsv', 'archival', false, false)
    ).rejects.toThrow('contains existing data');

    // Create strange table
    await db.sql`CREATE TABLE IF NOT EXISTS test (a varchar(10))`;
    await expect(
      importEventsFromTsv('tests/event-replay/tsv/mocknet.tsv', 'archival', true, false)
    ).rejects.toThrow('migration cycle failed');

    // Force and test
    await expect(
      importEventsFromTsv('tests/event-replay/tsv/mocknet.tsv', 'archival', true, true)
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
    ENV.BNS_IMPORT_DIR = 'tests/bns/import-test-files';
    await importEventsFromTsv('tests/event-replay/tsv/mocknet.tsv', 'archival', true, true);
    const configState = await db.getConfigState();
    expect(configState.bns_names_onchain_imported).toBe(true);
    expect(configState.bns_subdomains_imported).toBe(true);
  });

  test('Bns import occurs (block 0 genesis)', async () => {
    ENV.BNS_IMPORT_DIR = 'tests/bns/import-test-files';
    await importEventsFromTsv('tests/event-replay/tsv/mainnet-block0.tsv', 'archival', true, true);
    const configState = await db.getConfigState();
    expect(configState.bns_names_onchain_imported).toBe(true);
    expect(configState.bns_subdomains_imported).toBe(true);
  });

  test('BNS import should be skipped for Stacks subnet nodes', async () => {
    ENV.STACKS_NODE_TYPE = 'subnet';
    ENV.BNS_IMPORT_DIR = 'tests/bns/import-test-files';
    await importEventsFromTsv('tests/event-replay/tsv/mocknet.tsv', 'archival', true, true);
    const configState = await db.getConfigState();
    expect(configState.bns_names_onchain_imported).toBe(false);
    expect(configState.bns_subdomains_imported).toBe(false);
  });
});
