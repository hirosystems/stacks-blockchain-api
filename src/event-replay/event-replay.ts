import * as fs from 'fs';
import * as path from 'path';
import { exportRawEventRequests, getRawEventRequests } from './event-requests.js';
import { PgWriteStore } from '../datastore/pg-write-store.js';
import { startEventServer } from '../event-stream/event-server.js';
import { getApiConfiguredChainID, HttpClientResponse, httpPostRequest } from '../helpers.js';
import { importV1TokenOfferingData } from '../import-v1/index.js';
import { findTsvBlockHeight, getDbBlockHeight } from './helpers.js';
import {
  cycleMigrations,
  dangerousDropAllTables,
  databaseHasData,
  logger,
} from '@stacks/api-toolkit';
import { MIGRATIONS_DIR } from '../datastore/pg-store.js';
import { PgServer, getConnectionArgs } from '../datastore/connection.js';

/**
 * Exports all Stacks node events stored in the `event_observer_requests` table to a TSV file.
 * @param filePath - Path to TSV file to write
 * @param overwriteFile - If we should overwrite the file
 */
export async function exportEventsAsTsv(
  filePath?: string,
  overwriteFile: boolean = false
): Promise<void> {
  if (!filePath) {
    throw new Error(`A file path should be specified with the --file option`);
  }
  const isLocal = filePath.startsWith('local:');
  if (isLocal) {
    filePath = filePath.replace(/^local:/, '');
    if (!path.isAbsolute(filePath)) {
      throw new Error(`The file path must be absolute`);
    }
  } else {
    const resolvedFilePath = path.resolve(filePath);
    if (fs.existsSync(resolvedFilePath) && overwriteFile !== true) {
      throw new Error(
        `A file already exists at ${resolvedFilePath}. Add --overwrite-file to truncate an existing file`
      );
    }
  }

  console.log(`Exporting event data to ${filePath}`);
  console.log(`Export started...`);
  await exportRawEventRequests(filePath, isLocal);
  console.log('Export successful.');
}

/**
 * Imports Stacks node events from a TSV file and ingests them through the Event Server.
 * @param filePath - Path to TSV file to read
 * @param wipeDb - If we should wipe the DB before importing
 * @param force - If we should force drop all tables
 */
export async function importEventsFromTsv(
  filePath?: string,
  wipeDb: boolean = false,
  force: boolean = false
): Promise<HttpClientResponse[]> {
  if (!filePath) {
    throw new Error(`A file path should be specified with the --file option`);
  }
  const resolvedFilePath = path.resolve(filePath);
  if (!fs.existsSync(resolvedFilePath)) {
    throw new Error(`File does not exist: ${resolvedFilePath}`);
  }
  const connectionArgs = getConnectionArgs(PgServer.primary);
  const hasData = await databaseHasData(connectionArgs);
  if (!wipeDb && hasData) {
    throw new Error(`Database contains existing data. Add --wipe-db to drop the existing tables.`);
  }
  if (force) {
    await dangerousDropAllTables(connectionArgs, {
      acknowledgePotentialCatastrophicConsequences: 'yes',
    });
  }

  try {
    await cycleMigrations(MIGRATIONS_DIR, connectionArgs, {
      dangerousAllowDataLoss: true,
      checkForEmptyData: true,
    });
  } catch (error) {
    logger.error(error);
    throw new Error(
      `DB migration cycle failed, possibly due to an incompatible API version upgrade. Add --wipe-db --force or perform a manual DB wipe before importing.`,
      { cause: error }
    );
  }

  const tsvBlockHeight = await findTsvBlockHeight(resolvedFilePath);
  console.log(`Event file's block height: ${tsvBlockHeight}`);
  console.log(`Starting event import and playback`);

  const db = await PgWriteStore.connect({
    usageName: 'import-events',
    skipMigrations: true,
    withNotifier: false,
    isEventReplay: true,
  });
  const eventServer = await startEventServer({
    datastore: db,
    chainId: getApiConfiguredChainID(),
    serverHost: '127.0.0.1',
    serverPort: 0,
  });

  await importV1TokenOfferingData(db);

  // Import TSV chain data
  const readStream = fs.createReadStream(resolvedFilePath);
  const rawEventsIterator = getRawEventRequests(readStream, status => {
    console.log(status);
  });
  // Set logger to only output for warnings/errors, otherwise the event replay will result
  // in the equivalent of months/years of API log output.
  logger.level = 'warn';
  // The current import block height. Will be updated with every `/new_block` event.
  let blockHeight: number;
  const responses = [];
  for await (const rawEvents of rawEventsIterator) {
    for (const rawEvent of rawEvents) {
      const response = await httpPostRequest({
        host: '127.0.0.1',
        port: eventServer.serverAddress.port,
        path: rawEvent.event_path,
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(rawEvent.payload, 'utf8'),
        throwOnNotOK: true,
      });
      if (rawEvent.event_path === '/new_block') {
        blockHeight = await getDbBlockHeight(db);
        if (blockHeight && blockHeight % 1000 === 0) {
          console.log(`Event file block height reached: ${blockHeight}`);
        }
      }
      responses.push(response);
    }
  }
  console.log(`Event import and playback successful.`);
  await eventServer.closeAsync();
  await db.close();
  return responses;
}
