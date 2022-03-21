import * as path from 'path';
import * as fs from 'fs';
import { cycleMigrations, dangerousDropAllTables, PgDataStore } from '../datastore/postgres-store';
import { startEventServer } from '../event-stream/event-server';
import { getApiConfiguredChainID, httpPostRequest, logger } from '../helpers';

/**
 * Exports all Stacks node events stored in the `event_observer_requests` table to a TSV file.
 * @param file - Path to TSV file to write
 * @param overwriteFile - If we should overwrite the file if it exists
 */
export async function exportEventsTsv(
  file?: string,
  overwriteFile: boolean = false
): Promise<void> {
  if (!file) {
    throw new Error(`A file path should be specified with the --file option`);
  }
  const filePath = path.resolve(file);
  if (fs.existsSync(filePath) && overwriteFile !== true) {
    throw new Error(
      `A file already exists at ${filePath}. Add --overwrite-file to truncate an existing file`
    );
  }
  console.log(`Export event data to file: ${filePath}`);
  const writeStream = fs.createWriteStream(filePath);
  console.log(`Export started...`);
  await PgDataStore.exportRawEventRequests(writeStream);
  console.log('Export successful.');
}

/**
 * Imports Stacks node events from a TSV file and ingests them through the Event Server.
 * @param file - Path to TSV file to read
 * @param wipeDb - If we should wipe the DB before importing
 * @param force - If we should force drop all tables
 */
export async function importEventsTsv(
  file?: string,
  wipeDb: boolean = false,
  force: boolean = false
): Promise<void> {
  if (!file) {
    throw new Error(`A file path should be specified with the --file option`);
  }
  const filePath = path.resolve(file);
  if (!fs.existsSync(filePath)) {
    throw new Error(`File does not exist: ${filePath}`);
  }
  const hasData = await PgDataStore.containsAnyRawEventRequests();
  if (!wipeDb && hasData) {
    throw new Error(`Database contains existing data. Add --wipe-db to drop the existing tables.`);
  }

  if (force) {
    await dangerousDropAllTables({ acknowledgePotentialCatastrophicConsequences: 'yes' });
  }

  // This performs a "migration down" which drops the tables, then re-creates them.
  // If there's a breaking change in the migration files, this will throw, and the pg database needs wiped manually,
  // or the `--force` option can be used.
  await cycleMigrations({ dangerousAllowDataLoss: true });

  const db = await PgDataStore.connect({
    usageName: 'import-events',
    skipMigrations: true,
    withNotifier: false,
    eventReplay: true,
  });
  const eventServer = await startEventServer({
    datastore: db,
    chainId: getApiConfiguredChainID(),
    serverHost: '127.0.0.1',
    serverPort: 0,
    httpLogLevel: 'debug',
  });

  const readStream = fs.createReadStream(filePath);
  const rawEventsIterator = PgDataStore.getRawEventRequests(readStream, status => {
    console.log(status);
  });
  // Set logger to only output for warnings/errors, otherwise the event replay will result
  // in the equivalent of months/years of API log output.
  logger.level = 'warn';
  // Disable this feature so a redundant export file isn't created while importing from an existing one.
  delete process.env['STACKS_EXPORT_EVENTS_FILE'];
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
  await db.finishEventReplay();
  console.log(`Event import and playback successful.`);
  await eventServer.closeAsync();
  await db.close();
}
