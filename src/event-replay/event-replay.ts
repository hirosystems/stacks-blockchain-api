import * as path from 'path';
import * as fs from 'fs';
import {
  parseBurnBlockMessage,
  parseNewBlockMessage,
  startEventServer,
} from '../event-stream/event-server';
import { getApiConfiguredChainID, httpPostRequest, logger } from '../helpers';
import { findTsvBlockHeight, getDbBlockHeight } from './helpers';
import { PgWriteStore } from '../datastore/pg-write-store';
import { cycleMigrations, dangerousDropAllTables } from '../datastore/migrations';
import {
  containsAnyRawEventRequests,
  exportRawEventRequests,
  getRawEventRequests,
} from '../datastore/event-requests';
import { readLines } from './reverse-line-reader';
import {
  createTsvReorgStream,
  getCanonicalEntityList,
  readPreorgTsv,
  TsvEntityData,
} from './tsv-pre-org';
import { Readable, Transform, Writable } from 'stream';
import { pipeline } from 'stream/promises';
import { CoreNodeBlockMessage, CoreNodeBurnBlockMessage } from '../event-stream/core-node-message';
import { ChainID } from '@stacks/transactions';

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
  preorg = 'preorg',
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
  logger.warn(`Export event data to file: ${resolvedFilePath}`);
  const writeStream = fs.createWriteStream(resolvedFilePath);
  logger.warn(`Export started...`);
  await exportRawEventRequests(writeStream);
  logger.warn('Export successful.');
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
    case 'preorg':
      eventImportMode = EventImportMode.preorg;
      break;
    case 'archival':
    case undefined:
      eventImportMode = EventImportMode.archival;
      break;
    default:
      throw new Error(`Invalid event import mode: ${importMode}`);
  }
  const hasData = await containsAnyRawEventRequests();
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

  if (eventImportMode === EventImportMode.preorg) {
    await preOrgTsvInsert(resolvedFilePath);
    return;
  }

  // Look for the TSV's block height and determine the prunable block window.
  const tsvBlockHeight = await findTsvBlockHeight(resolvedFilePath);
  const blockWindowSize = parseInt(
    process.env['STACKS_MEMPOOL_TX_GARBAGE_COLLECTION_THRESHOLD'] ?? '256'
  );
  const prunedBlockHeight = Math.max(tsvBlockHeight - blockWindowSize, 0);
  logger.warn(`Event file's block height: ${tsvBlockHeight}`);
  logger.warn(`Starting event import and playback in ${eventImportMode} mode`);
  if (eventImportMode === EventImportMode.pruned) {
    logger.warn(`Ignoring all prunable events before block height: ${prunedBlockHeight}`);
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

  const readStream = fs.createReadStream(resolvedFilePath);
  const rawEventsIterator = getRawEventRequests(readStream, status => {
    logger.warn(status);
  });
  // Set logger to only output for warnings/errors, otherwise the event replay will result
  // in the equivalent of months/years of API log output.
  logger.level = 'warn';
  // Disable this feature so a redundant export file isn't created while importing from an existing one.
  delete process.env['STACKS_EXPORT_EVENTS_FILE'];
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
          logger.warn(`Resuming prunable event import...`);
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
      }
    }
  }
  await db.finishEventReplay();
  logger.warn(`Event import and playback successful.`);
  await eventServer.closeAsync();
  await db.close();
}

const insertMode: 'single' | 'single2' | 'single3' | 'batch' | 'batch2' | 'stream' = 'single2';

async function preOrgTsvInsert(filePath: string): Promise<void> {
  const chainID = getApiConfiguredChainID();
  const db = await PgWriteStore.connect({
    usageName: 'import-events',
    skipMigrations: true,
    withNotifier: false,
    isEventReplay: true,
  });
  const startTime = Date.now();

  // Set logger to only output for warnings/errors, otherwise the event replay will result
  // in the equivalent of months/years of API log output.
  logger.level = 'warn';
  // Disable this feature so a redundant export file isn't created while importing from an existing one.
  delete process.env['STACKS_EXPORT_EVENTS_FILE'];

  logger.warn('Indexing canonical data from tsv file...');

  let tsvEntityData: TsvEntityData;
  if (fs.existsSync(filePath + '.entitydata')) {
    tsvEntityData = JSON.parse(fs.readFileSync(filePath + '.entitydata', 'utf8'));
  } else {
    tsvEntityData = await getCanonicalEntityList(filePath);
    fs.writeFileSync(filePath + '.entitydata', JSON.stringify(tsvEntityData));
  }
  logger.warn(`[Tsv entity data]: block height: ${tsvEntityData.indexBlockHashes.length}`);

  const preOrgFilePath = filePath + '-preorg';
  if (!fs.existsSync(preOrgFilePath)) {
    logger.warn(`Writing preorg tsv file: ${preOrgFilePath} ...`);
    const inputLineReader = readLines(filePath);
    const transformStream = createTsvReorgStream(
      tsvEntityData.indexBlockHashes,
      tsvEntityData.burnBlockHashes,
      false
    );
    const outputFileStream = fs.createWriteStream(preOrgFilePath);
    await pipeline(inputLineReader, transformStream, outputFileStream);
  } else {
    logger.warn(`Using existing preorg tsv file: ${preOrgFilePath}`);
  }

  // const tables = await db.getTables();

  // 342 seconds: with disable indexs, then re-indexing
  // 197 seconds: with disabled indexs, but without re-index
  // 655 seconds: with indexes untouched
  logger.warn(`Inserting event data to db...`);
  // await insertRawEvents(tsvEntityData, db, preOrgFilePath);
  // await insertNewBurnBlockEvents(tsvEntityData, db, preOrgFilePath);
  await insertNewBlockEvents(tsvEntityData, db, preOrgFilePath, chainID);

  /*
  const inputLineReader = readLines(filePath);
  const transformStream = createTsvReorgStream(
    result.indexBlockHashes,
    result.burnBlockHashes,
    true
  );

  logger.warn('Writing event data to db...');
  let lastStatusUpdatePercent = 0;

  if (insertMode === 'single') {
    const insertTransformStream = new Transform({
      objectMode: true,
      autoDestroy: true,
      transform: (
        event: { path: string; payload: string; readLineCount: number },
        _encoding,
        callback
      ) => {
        if ((event.readLineCount / result.tsvLineCount) * 100 > lastStatusUpdatePercent + 1) {
          lastStatusUpdatePercent = Math.floor((event.readLineCount / result.tsvLineCount) * 100);
          logger.warn(
            `Raw event requests processed: ${lastStatusUpdatePercent}% (${event.readLineCount} / ${result.tsvLineCount})`
          );
        }
        db.storeRawEventRequest1(event.path, event.payload).then(
          () => callback(),
          (error: Error) => callback(error)
        );
      },
    });
    await pipeline(inputLineReader, transformStream, insertTransformStream);
  } else if (insertMode === 'single2') {
    const preOrgStream = inputLineReader.pipe(transformStream);
    for await (const event of preOrgStream) {
      await db.storeRawEventRequest1(event.path, event.payload);
      const readLineCount: number = event.readLineCount;
      if ((readLineCount / result.tsvLineCount) * 100 > lastStatusUpdatePercent + 1) {
        lastStatusUpdatePercent = Math.floor((readLineCount / result.tsvLineCount) * 100);
        logger.warn(
          `Raw event requests processed: ${lastStatusUpdatePercent}% (${readLineCount} / ${result.tsvLineCount})`
        );
      }
    }
  } else if (insertMode === 'single3') {
    const insertPgStream = new Writable({
      objectMode: true,
      autoDestroy: true,
      write: (
        event: { path: string; payload: string; readLineCount: number },
        _encoding,
        callback
      ) => {
        if ((event.readLineCount / result.tsvLineCount) * 100 > lastStatusUpdatePercent + 1) {
          lastStatusUpdatePercent = Math.floor((event.readLineCount / result.tsvLineCount) * 100);
          logger.warn(
            `Raw event requests processed: ${lastStatusUpdatePercent}% (${event.readLineCount} / ${result.tsvLineCount})`
          );
        }
        db.storeRawEventRequest1(event.path, event.payload).then(
          () => callback(),
          (error: Error) => callback(error)
        );
      },
    });
    await pipeline(inputLineReader, transformStream, insertPgStream);
  } else if (insertMode === 'stream') {
    const insertTransformStream = new Transform({
      objectMode: true,
      autoDestroy: true,
      transform: (
        event: { path: string; payload: string; readLineCount: number },
        _encoding,
        callback
      ) => {
        if ((event.readLineCount / result.tsvLineCount) * 100 > lastStatusUpdatePercent + 1) {
          lastStatusUpdatePercent = Math.floor((event.readLineCount / result.tsvLineCount) * 100);
          logger.warn(
            `Raw event requests processed: ${lastStatusUpdatePercent}% (${event.readLineCount} / ${result.tsvLineCount})`
          );
        }
        insertTransformStream.push(`${event.path}\t${event.payload}\n`);
        callback();
      },
    });
    const insertStream3 = await db.storeRawEventRequest3();
    await pipeline(inputLineReader, transformStream, insertTransformStream, insertStream3);
  } else if (insertMode === 'batch') {
    const preOrgStream = inputLineReader.pipe(transformStream);
    const batchSize = 5;
    let nextInserts: { event_path: string; payload: string }[] = [];
    for await (const event of preOrgStream) {
      nextInserts.push({
        event_path: event.path,
        payload: event.payload,
      });

      if (nextInserts.length === batchSize) {
        await db.storeRawEventRequest2(nextInserts);
        nextInserts = [];
      }

      const readLineCount: number = event.readLineCount;
      if ((readLineCount / result.tsvLineCount) * 100 > lastStatusUpdatePercent + 1) {
        lastStatusUpdatePercent = Math.floor((readLineCount / result.tsvLineCount) * 100);
        logger.warn(
          `Raw event requests processed: ${lastStatusUpdatePercent}% (${readLineCount} / ${result.tsvLineCount})`
        );
      }
    }
    if (nextInserts.length > 0) {
      await db.storeRawEventRequest2(nextInserts);
    }
  } else if (insertMode === 'batch2') {
    const batchSize = 5;
    let nextInserts: { event_path: string; payload: string }[] = [];
    const insertPgStream = new Writable({
      objectMode: true,
      autoDestroy: true,
      write: (
        event: { path: string; payload: string; readLineCount: number },
        _encoding,
        callback
      ) => {
        if ((event.readLineCount / result.tsvLineCount) * 100 > lastStatusUpdatePercent + 1) {
          lastStatusUpdatePercent = Math.floor((event.readLineCount / result.tsvLineCount) * 100);
          logger.warn(
            `Raw event requests processed: ${lastStatusUpdatePercent}% (${event.readLineCount} / ${result.tsvLineCount})`
          );
        }
        nextInserts.push({
          event_path: event.path,
          payload: event.payload,
        });
        if (nextInserts.length === batchSize) {
          db.storeRawEventRequest2(nextInserts).then(
            () => {
              nextInserts = [];
              callback();
            },
            (error: Error) => callback(error)
          );
        } else {
          callback();
        }
      },
      final: callback => {
        if (nextInserts.length > 0) {
          db.storeRawEventRequest2(nextInserts).then(
            () => callback(),
            (error: Error) => callback(error)
          );
        } else {
          callback();
        }
      },
    });
    await pipeline(inputLineReader, transformStream, insertPgStream);
  }
  */

  await db.close();
  const endTime = Date.now();
  logger.warn(`Took: ${Math.round((endTime - startTime) / 1000)} seconds`);
}

async function insertRawEvents(tsvEntityData: TsvEntityData, db: PgWriteStore, filePath: string) {
  const preOrgStream = readPreorgTsv(filePath);
  let lastStatusUpdatePercent = 0;
  await db.sql.begin(async sql => {
    for await (const event of preOrgStream) {
      await db.storeRawEventRequest1(event.path, event.payload, sql);
      const readLineCount: number = event.readLineCount;
      if ((readLineCount / tsvEntityData.tsvLineCount) * 100 > lastStatusUpdatePercent + 10) {
        lastStatusUpdatePercent = Math.floor((readLineCount / tsvEntityData.tsvLineCount) * 100);
        logger.warn(
          `Raw event requests processed: ${lastStatusUpdatePercent}% (${readLineCount} / ${tsvEntityData.tsvLineCount})`
        );
      }
    }
  });
}

async function insertNewBlockEvents(
  tsvEntityData: TsvEntityData,
  db: PgWriteStore,
  filePath: string,
  chainID: ChainID
) {
  const preOrgStream = readPreorgTsv(filePath, '/new_block');
  let lastStatusUpdatePercent = 0;
  const tables = [
    'blocks',
    'microblocks',
    'txs',
    'stx_events',
    'principal_stx_txs',
    'contract_logs',
    'stx_lock_events',
    'ft_events',
    'nft_events',
    'smart_contracts',
    'zonefiles',
    'names',
    'namespaces',
  ];
  const newBlockInsertStartTime = Date.now();
  await db.sql.begin(async sql => {
    // Temporarily disable indexing and contraints on tables to speed up insertion
    await db.toggleTableIndexes(sql, tables, false);

    for await (const event of preOrgStream) {
      const newBlockMsg: CoreNodeBlockMessage = JSON.parse(event.payload);
      const dbData = parseNewBlockMessage(chainID, newBlockMsg);
      // INSERT INTO blocks
      await db.updateBlock(sql, dbData.block, true);
      if (dbData.microblocks.length > 0) {
        // INSERT INTO microblocks
        await db.insertMicroblock(sql, dbData.microblocks);
      }
      if (dbData.txs.length > 0) {
        for (const entry of dbData.txs) {
          // INSERT INTO txs
          await db.updateTx(sql, entry.tx, true);

          // INSERT INTO stx_events
          await db.updateBatchStxEvents(sql, entry.tx, entry.stxEvents);

          // INSERT INTO principal_stx_txs
          await db.updatePrincipalStxTxs(sql, entry.tx, entry.stxEvents, true);

          // INSERT INTO contract_logs
          await db.updateBatchSmartContractEvent(sql, entry.tx, entry.contractLogEvents);

          // INSERT INTO stx_lock_events
          for (const stxLockEvent of entry.stxLockEvents) {
            await db.updateStxLockEvent(sql, entry.tx, stxLockEvent);
          }
        }
      }

      // INSERT INTO ft_events
      // INSERT INTO nft_events
      // INSERT INTO smart_contracts
      // INSERT INTO zonefiles
      // INSERT INTO names
      // INSERT INTO namespaces

      const readLineCount: number = event.readLineCount;
      if ((readLineCount / tsvEntityData.tsvLineCount) * 100 > lastStatusUpdatePercent + 10) {
        lastStatusUpdatePercent = Math.floor((readLineCount / tsvEntityData.tsvLineCount) * 100);
        logger.warn(
          `Processed '/new_block' events: ${lastStatusUpdatePercent}% (${readLineCount} / ${tsvEntityData.tsvLineCount})`
        );
      }
    }

    logger.warn(`Re-enabling indexs...`);
    await db.toggleTableIndexes(sql, tables, true);
  });
  logger.warn(
    `Inserting /new_block data took ${Math.round(
      (Date.now() - newBlockInsertStartTime) / 1000
    )} seconds`
  );

  const reindexStartTime = Date.now();
  for (const table of tables) {
    logger.warn(`Re-indexing table "${table}"...`);
    await db.sql`REINDEX TABLE ${db.sql(table)}`;
  }
  logger.warn(
    `Re-indexing /new_block tables took ${Math.round(
      (Date.now() - reindexStartTime) / 1000
    )} seconds`
  );
}

async function insertNewBurnBlockEvents(
  tsvEntityData: TsvEntityData,
  db: PgWriteStore,
  filePath: string
) {
  const preOrgStream = readPreorgTsv(filePath, '/new_burn_block');
  let lastStatusUpdatePercent = 0;
  await db.sql.begin(async sql => {
    await sql`
      UPDATE pg_index
      SET indisready = false, indisvalid = false
      WHERE indrelid = ANY (
        SELECT oid FROM pg_class
        WHERE relname IN ('burnchain_rewards', 'reward_slot_holders')
      )
    `;
    for await (const event of preOrgStream) {
      const burnBlockMsg: CoreNodeBurnBlockMessage = JSON.parse(event.payload);
      const burnBlockData = parseBurnBlockMessage(burnBlockMsg);

      if (burnBlockData.rewards.length > 0) {
        await db.updateBurnchainRewards({
          burnchainBlockHash: burnBlockMsg.burn_block_hash,
          burnchainBlockHeight: burnBlockMsg.burn_block_height,
          rewards: burnBlockData.rewards,
          skipReorg: true,
          sqlTx: sql,
        });
      }
      if (burnBlockData.slotHolders.length > 0) {
        await db.updateBurnchainRewardSlotHolders({
          burnchainBlockHash: burnBlockMsg.burn_block_hash,
          burnchainBlockHeight: burnBlockMsg.burn_block_height,
          slotHolders: burnBlockData.slotHolders,
          skipReorg: true,
          sqlTx: sql,
        });
      }

      const readLineCount: number = event.readLineCount;
      if ((readLineCount / tsvEntityData.tsvLineCount) * 100 > lastStatusUpdatePercent + 10) {
        lastStatusUpdatePercent = Math.floor((readLineCount / tsvEntityData.tsvLineCount) * 100);
        logger.warn(
          `Processed '/new_burn_block' events: ${lastStatusUpdatePercent}% (${readLineCount} / ${tsvEntityData.tsvLineCount})`
        );
      }
    }
  });
  logger.warn(`Re-indexing burn block tables...`);
  await db.sql`REINDEX TABLE burnchain_rewards`;
  await db.sql`REINDEX TABLE reward_slot_holders`;
}
