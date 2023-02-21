import * as path from 'path';
import * as fs from 'fs';
import { startEventServer } from '../event-stream/event-server';
import { getApiConfiguredChainID, httpPostRequest, logger } from '../helpers';
import { findTsvBlockHeight, getDbBlockHeight } from './helpers';
import { importV1TokenOfferingData } from '../import-v1';
import {
  databaseHasData,
  exportRawEventRequests,
  getRawEventRequests,
} from '../datastore/event-requests';
import { cycleMigrations, dangerousDropAllTables } from '../datastore/migrations';
import { PgWriteStore } from '../datastore/pg-write-store';

enum EventImportMode {
  /**
   * The Event Server will ingest and process every single Stacks node event contained in the TSV file
   * from block 0 to the latest block. This is the default mode.
   */
  archival = 'archival',
  /**
   * The Event Server will ingore certain "prunable" events (see `PRUNABLE_EVENT_PATHS`) from
   * the imported TSV file if they are received outside of a block window, usually set to
   * TSV's `block_height` - 256.
   * This allows the import to be faster at the expense of historical blockchain information.
   */
  pruned = 'pruned',
}

/**
 * Event paths that will be ignored during `EventImportMode.pruned` if received outside of the
 * pruned block window.
 */
const PRUNABLE_EVENT_PATHS = ['/new_mempool_tx', '/drop_mempool_tx', '/new_microblocks'];

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
  const resolvedFilePath = path.resolve(filePath);
  if (fs.existsSync(resolvedFilePath) && overwriteFile !== true) {
    throw new Error(
      `A file already exists at ${resolvedFilePath}. Add --overwrite-file to truncate an existing file`
    );
  }
  console.log(`Export event data to file: ${resolvedFilePath}`);
  const writeStream = fs.createWriteStream(resolvedFilePath);
  console.log(`Export started...`);
  await exportRawEventRequests(writeStream);
  console.log('Export successful.');
}

/**
 * Imports Stacks node events from a TSV file and ingests them through the Event Server.
 * @param filePath - Path to TSV file to read
 * @param importMode - Event import mode
 * @param wipeDb - If we should wipe the DB before importing
 * @param force - If we should force drop all tables
 */
export async function importEventsFromTsv(
  filePath?: string,
  importMode?: string,
  wipeDb: boolean = false,
  force: boolean = false
): Promise<void> {
  if (!filePath) {
    throw new Error(`A file path should be specified with the --file option`);
  }
  const resolvedFilePath = path.resolve(filePath);
  if (!fs.existsSync(resolvedFilePath)) {
    throw new Error(`File does not exist: ${resolvedFilePath}`);
  }
  let eventImportMode: EventImportMode;
  switch (importMode) {
    case 'pruned':
      eventImportMode = EventImportMode.pruned;
      break;
    case 'archival':
    case undefined:
      eventImportMode = EventImportMode.archival;
      break;
    default:
      throw new Error(`Invalid event import mode: ${importMode}`);
  }
  const hasData = await databaseHasData();
  if (!wipeDb && hasData) {
    throw new Error(`Database contains existing data. Add --wipe-db to drop the existing tables.`);
  }
  if (force) {
    await dangerousDropAllTables({ acknowledgePotentialCatastrophicConsequences: 'yes' });
  }

  try {
    await cycleMigrations({ dangerousAllowDataLoss: true, checkForEmptyData: true });
  } catch (error) {
    logger.error(error);
    throw new Error(
      `DB migration cycle failed, possibly due to an incompatible API version upgrade. Add --wipe-db --force or perform a manual DB wipe before importing.`
    );
  }

  // Look for the TSV's block height and determine the prunable block window.
  const tsvBlockHeight = await findTsvBlockHeight(resolvedFilePath);
  const blockWindowSize = parseInt(
    process.env['STACKS_MEMPOOL_TX_GARBAGE_COLLECTION_THRESHOLD'] ?? '256'
  );
  const prunedBlockHeight = Math.max(tsvBlockHeight - blockWindowSize, 0);
  console.log(`Event file's block height: ${tsvBlockHeight}`);
  console.log(`Starting event import and playback in ${eventImportMode} mode`);
  if (eventImportMode === EventImportMode.pruned) {
    console.log(`Ignoring all prunable events before block height: ${prunedBlockHeight}`);
  }

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
    httpLogLevel: 'debug',
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
  let blockHeight = 0;
  let isPruneFinished = false;
  for await (const rawEvents of rawEventsIterator) {
    for (const rawEvent of rawEvents) {
      if (eventImportMode === EventImportMode.pruned) {
        if (PRUNABLE_EVENT_PATHS.includes(rawEvent.event_path) && blockHeight < prunedBlockHeight) {
          // Prunable events are ignored here.
          continue;
        }
        if (blockHeight == prunedBlockHeight && !isPruneFinished) {
          isPruneFinished = true;
          console.log(`Resuming prunable event import...`);
        }
      }
      await httpPostRequest({
        host: '127.0.0.1',
        port: eventServer.serverAddress.port,
        path: rawEvent.event_path,
        headers: { 'Content-Type': 'application/json' },
        body: Buffer.from(rawEvent.payload, 'utf8'),
        throwOnNotOK: true,
      });
      if (rawEvent.event_path === '/new_block') {
        blockHeight = await getDbBlockHeight(db);
        if (blockHeight % 1000 === 0) {
          console.log(`Event file block height reached: ${blockHeight}`);
        }
      }
    }
  }
  await db.finishEventReplay();
  console.log(`Event import and playback successful.`);
  await eventServer.closeAsync();
  await db.close();
}
