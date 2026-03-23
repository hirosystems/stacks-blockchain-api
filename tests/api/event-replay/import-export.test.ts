import * as fs from 'fs';
import { PgWriteStore } from '../../../src/datastore/pg-write-store.ts';
import { exportEventsAsTsv, importEventsFromTsv } from '../../../src/event-replay/event-replay.ts';
import { createSchema, migrate } from '../../test-helpers.ts';
import { dangerousDropAllTables, databaseHasData } from '@stacks/api-toolkit';
import { getConnectionArgs } from '../../../src/datastore/connection.ts';
import { ENV } from '../../../src/env.ts';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, test } from 'node:test';

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
    await importEventsFromTsv('tests/api/event-replay/tsv/mocknet.tsv', 'archival', true, true);
    const chainTip = await db.getChainTip(db.sql);
    assert.equal(chainTip.block_height, 28);
    assert.equal(
      chainTip.index_block_hash,
      '0x76cd67a65c0dfd5ea450bb9efe30da89fa125bfc077c953802f718353283a533'
    );
    assert.equal(
      chainTip.block_hash,
      '0x7682af212d3c1ef62613412f9b5a727269b4548f14eca2e3f941f7ad8b3c11b2'
    );

    // Export into temp TSV
    const tmpDir = 'tests/api/event-replay/.tmp/remote';
    fs.mkdirSync(tmpDir, { recursive: true });
    await exportEventsAsTsv(`${tmpDir}/export.tsv`);

    // Re-import with exported TSV and check that chain tip matches.
    try {
      await importEventsFromTsv(`${tmpDir}/export.tsv`, 'archival', true, true);
      const newChainTip = await db.getChainTip(db.sql);
      assert.equal(newChainTip.block_height, 28);
      assert.equal(
        newChainTip.index_block_hash,
        '0x76cd67a65c0dfd5ea450bb9efe30da89fa125bfc077c953802f718353283a533'
      );
      assert.equal(
        newChainTip.block_hash,
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
    await importEventsFromTsv('tests/api/event-replay/tsv/mocknet.tsv', 'archival', true, true);
    const chainTip = await db.getChainTip(db.sql);
    assert.equal(chainTip.block_height, 28);
    assert.equal(
      chainTip.index_block_hash,
      '0x76cd67a65c0dfd5ea450bb9efe30da89fa125bfc077c953802f718353283a533'
    );
    assert.equal(
      chainTip.block_hash,
      '0x7682af212d3c1ef62613412f9b5a727269b4548f14eca2e3f941f7ad8b3c11b2'
    );

    // Export into temp TSV
    const tmpDir = 'tests/api/event-replay/.tmp/local';
    fs.mkdirSync(tmpDir, { recursive: true });
    await exportEventsAsTsv('local:/root/export.tsv');

    // Re-import with exported TSV and check that chain tip matches.
    try {
      await importEventsFromTsv(`${tmpDir}/export.tsv`, 'archival', true, true);
      const newChainTip = await db.getChainTip(db.sql);
      assert.equal(newChainTip.block_height, 28);
      assert.equal(
        newChainTip.index_block_hash,
        '0x76cd67a65c0dfd5ea450bb9efe30da89fa125bfc077c953802f718353283a533'
      );
      assert.equal(
        newChainTip.block_hash,
        '0x7682af212d3c1ef62613412f9b5a727269b4548f14eca2e3f941f7ad8b3c11b2'
      );
    } finally {
      fs.rmSync(`${tmpDir}/export.tsv`, { force: true });
    }
  });

  test('import with db wipe options', async () => {
    // Migrate first so we have some data.
    await migrate('up');
    await assert.rejects(
      importEventsFromTsv('tests/api/event-replay/tsv/mocknet.tsv', 'archival', false, false),
      /contains existing data/
    );

    // Create strange table
    await db.sql`CREATE TABLE IF NOT EXISTS test (a varchar(10))`;
    await assert.rejects(
      importEventsFromTsv('tests/api/event-replay/tsv/mocknet.tsv', 'archival', true, false),
      /migration cycle failed/
    );

    // Force and test
    await assert.doesNotReject(
      importEventsFromTsv('tests/api/event-replay/tsv/mocknet.tsv', 'archival', true, true)
    );
  });

  test('db contains data', async () => {
    const args = getConnectionArgs();
    await migrate('up');

    // Having tables counts as having data as this may change across major versions.
    assert.equal(await databaseHasData(args), true);

    // Dropping all tables removes everything.
    await dangerousDropAllTables(args, {
      acknowledgePotentialCatastrophicConsequences: 'yes',
    });
    assert.equal(await databaseHasData(args), false);

    // Cycling migrations leaves the `pgmigrations` table.
    await migrate('up');
    await migrate('down');
    assert.equal(await databaseHasData(args), true);
    assert.equal(await databaseHasData(args, { ignoreMigrationTables: true }), false);
  });

  test('Bns import occurs (block 1 genesis)', async () => {
    ENV.BNS_IMPORT_DIR = 'tests/api/bns/import-test-files';
    await importEventsFromTsv('tests/api/event-replay/tsv/mocknet.tsv', 'archival', true, true);
    const configState = await db.getConfigState();
    assert.equal(configState.bns_names_onchain_imported, true);
    assert.equal(configState.bns_subdomains_imported, true);
  });

  test('Bns import occurs (block 0 genesis)', async () => {
    ENV.BNS_IMPORT_DIR = 'tests/api/bns/import-test-files';
    await importEventsFromTsv('tests/api/event-replay/tsv/mainnet-block0.tsv', 'archival', true, true);
    const configState = await db.getConfigState();
    assert.equal(configState.bns_names_onchain_imported, true);
    assert.equal(configState.bns_subdomains_imported, true);
  });

  test('BNS import should be skipped for Stacks subnet nodes', async () => {
    ENV.STACKS_NODE_TYPE = 'subnet';
    ENV.BNS_IMPORT_DIR = 'tests/api/bns/import-test-files';
    await importEventsFromTsv('tests/api/event-replay/tsv/mocknet.tsv', 'archival', true, true);
    const configState = await db.getConfigState();
    assert.equal(configState.bns_names_onchain_imported, false);
    assert.equal(configState.bns_subdomains_imported, false);
  });
});
