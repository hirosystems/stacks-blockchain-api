import * as fs from 'fs';
import { ChainID } from '@stacks/transactions';
import { pipeline } from 'stream/promises';
import {
  CoreNodeAttachmentMessage,
  CoreNodeBlockMessage,
  CoreNodeBurnBlockMessage,
} from '../event-stream/core-node-message';
import {
  parseAttachmentMessage,
  parseBurnBlockMessage,
  parseNewBlockMessage,
} from '../event-stream/event-server';
import { PgWriteStore } from '../datastore/pg-write-store';
import {
  createTimeTracker,
  getApiConfiguredChainID,
  I32_MAX,
  logger,
  stopwatch,
  TimeTracker,
} from '../helpers';
import { readLines } from './reverse-line-reader';
import {
  createTsvReorgStream,
  getCanonicalEntityList,
  readPreorgTsv,
  TsvEntityData,
} from './tsv-pre-org';

export async function preOrgTsvImport(filePath: string): Promise<void> {
  const chainID = getApiConfiguredChainID();
  const db = await PgWriteStore.connect({
    usageName: 'import-events',
    skipMigrations: true,
    withNotifier: false,
    isEventReplay: true,
  });
  const startTime = stopwatch();

  // Set logger to only output for warnings/errors, otherwise the event replay will result
  // in the equivalent of months/years of API log output.
  logger.level = 'info';
  // Disable this feature so a redundant export file isn't created while importing from an existing one.
  delete process.env['STACKS_EXPORT_EVENTS_FILE'];

  logger.info('Indexing canonical data from tsv file...');

  let tsvEntityData: TsvEntityData;
  if (fs.existsSync(filePath + '.entitydata')) {
    tsvEntityData = JSON.parse(fs.readFileSync(filePath + '.entitydata', 'utf8'));
  } else {
    const scanTsvEntityDataSw = stopwatch();
    tsvEntityData = await getCanonicalEntityList(filePath);
    logger.info(
      `Scanning tsv for canonical data took ${scanTsvEntityDataSw.getElapsedSeconds(2)} seconds`
    );
    fs.writeFileSync(filePath + '.entitydata', JSON.stringify(tsvEntityData));
  }
  logger.info(`Tsv entity data block height: ${tsvEntityData.indexBlockHashes.length}`);

  const preOrgFilePath = filePath + '-preorg';
  if (fs.existsSync(preOrgFilePath)) {
    logger.info(`Using existing preorg tsv file: ${preOrgFilePath}`);
  } else {
    logger.info(`Writing preorg tsv file: ${preOrgFilePath} ...`);
    const reorgFileSw = stopwatch();
    const inputLineReader = readLines(filePath);
    const transformStream = createTsvReorgStream(
      tsvEntityData.indexBlockHashes,
      tsvEntityData.burnBlockHashes,
      false
    );
    const outputFileStream = fs.createWriteStream(preOrgFilePath);
    await pipeline(inputLineReader, transformStream, outputFileStream);
    logger.info(`Writing preorg tsv file took ${reorgFileSw.getElapsedSeconds(2)} seconds`);
  }

  const pgInfoMaxParallelWorkers = await db.sql`SHOW max_parallel_maintenance_workers`;
  logger.info(
    `Using max_parallel_maintenance_workers: ${pgInfoMaxParallelWorkers[0].max_parallel_maintenance_workers}`
  );

  const pgInfoMaxWorkingMem = await db.sql`SHOW maintenance_work_mem`;
  logger.info(`Using maintenance_work_mem: ${pgInfoMaxWorkingMem[0].maintenance_work_mem}`);

  logger.info(`Inserting event data to db...`);
  const timeTracker = createTimeTracker();
  await insertNewBurnBlockEvents(tsvEntityData, db, preOrgFilePath, timeTracker);
  await insertNewAttachmentEvents(tsvEntityData, db, preOrgFilePath, timeTracker);
  await insertRawEvents(tsvEntityData, db, preOrgFilePath, timeTracker);
  await insertNewBlockEvents(tsvEntityData, db, preOrgFilePath, chainID, timeTracker);

  console.table(timeTracker.getDurations(2));

  await db.close();
  logger.info(`Event import took: ${startTime.getElapsedSeconds(2)} seconds`);
}

async function insertRawEvents(
  tsvEntityData: TsvEntityData,
  db: PgWriteStore,
  filePath: string,
  timeTracker: TimeTracker
) {
  const preOrgStream = readPreorgTsv(filePath);
  let lastStatusUpdatePercent = 0;
  const tables = ['event_observer_requests'];
  const newBlockInsertSw = stopwatch();
  await db.sql.begin(async sql => {
    // Temporarily disable indexing and contraints on tables to speed up insertion
    await db.toggleTableIndexes(sql, tables, false);

    for await (const event of preOrgStream) {
      // INSERT INTO event_observer_requests
      await timeTracker.track('storeRawEventRequest', () =>
        db.storeRawEventRequest1(event.path, event.payload, sql)
      );
      const readLineCount: number = event.readLineCount;
      if ((readLineCount / tsvEntityData.tsvLineCount) * 100 > lastStatusUpdatePercent + 20) {
        lastStatusUpdatePercent = Math.floor((readLineCount / tsvEntityData.tsvLineCount) * 100);
        logger.info(
          `Raw event requests processed: ${lastStatusUpdatePercent}% (${readLineCount} / ${tsvEntityData.tsvLineCount})`
        );
      }
    }

    logger.info(`Re-enabling indexs on ${tables.join(', ')}...`);
    await db.toggleTableIndexes(sql, tables, true);
  });

  logger.info(`Inserting all event data took ${newBlockInsertSw.getElapsedSeconds(2)} seconds`);

  const reindexSw = stopwatch();
  for (const table of tables) {
    logger.info(`Reindexing table ${table}...`);
    await timeTracker.track(`reindex ${table}`, () => db.sql`REINDEX TABLE ${db.sql(table)}`);
  }
  logger.info(`Reindexing event_observer_requests took ${reindexSw.getElapsedSeconds(2)} seconds`);
}

async function insertNewBlockEvents(
  tsvEntityData: TsvEntityData,
  db: PgWriteStore,
  filePath: string,
  chainID: ChainID,
  timeTracker: TimeTracker
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
    'names',
    'namespaces',
  ];
  const newBlockInsertSw = stopwatch();
  await db.sql.begin(async sql => {
    // Temporarily disable indexing and contraints on tables to speed up insertion
    await db.toggleTableIndexes(sql, tables, false);

    for await (const event of preOrgStream) {
      const newBlockMsg: CoreNodeBlockMessage = JSON.parse(event.payload);
      const dbData = parseNewBlockMessage(chainID, newBlockMsg);
      // INSERT INTO blocks
      await timeTracker.track('updateBlock', () => db.updateBlock(sql, dbData.block, true));
      if (dbData.microblocks.length > 0) {
        // INSERT INTO microblocks
        await timeTracker.track('insertMicroblock', () =>
          db.insertMicroblock(sql, dbData.microblocks)
        );
      }
      if (dbData.txs.length > 0) {
        for (const entry of dbData.txs) {
          // INSERT INTO txs
          await timeTracker.track('updateTx', () => db.updateTx(sql, entry.tx, true));

          // INSERT INTO stx_events
          await timeTracker.track('updateBatchStxEvents', () =>
            db.updateBatchStxEvents(sql, entry.tx, entry.stxEvents)
          );

          // INSERT INTO principal_stx_txs
          await timeTracker.track('updatePrincipalStxTxs', () =>
            db.updatePrincipalStxTxs(sql, entry.tx, entry.stxEvents, true)
          );

          // INSERT INTO contract_logs
          await timeTracker.track('updateBatchSmartContractEvent', () =>
            db.updateBatchSmartContractEvent(sql, entry.tx, entry.contractLogEvents)
          );

          // INSERT INTO stx_lock_events
          for (const stxLockEvent of entry.stxLockEvents) {
            await timeTracker.track('updateStxLockEvent', () =>
              db.updateStxLockEvent(sql, entry.tx, stxLockEvent)
            );
          }

          // INSERT INTO ft_events
          for (const ftEvent of entry.ftEvents) {
            await timeTracker.track('updateFtEvent', () =>
              db.updateFtEvent(sql, entry.tx, ftEvent)
            );
          }

          // INSERT INTO nft_events
          for (const nftEvent of entry.nftEvents) {
            await timeTracker.track('updateNftEvent', () =>
              db.updateNftEvent(sql, entry.tx, nftEvent)
            );
          }

          // INSERT INTO smart_contracts
          for (const smartContract of entry.smartContracts) {
            await timeTracker.track('updateSmartContract', () =>
              db.updateSmartContract(sql, entry.tx, smartContract)
            );
          }

          // INSERT INTO names
          for (const bnsName of entry.names) {
            await timeTracker.track('updateNames', () =>
              db.updateNames(sql, entry.tx, bnsName, true)
            );
          }

          // INSERT INTO namespaces
          for (const namespace of entry.namespaces) {
            await timeTracker.track('updateNamespaces', () =>
              db.updateNamespaces(sql, entry.tx, namespace)
            );
          }
        }
      }

      const readLineCount: number = event.readLineCount;
      if ((readLineCount / tsvEntityData.tsvLineCount) * 100 > lastStatusUpdatePercent + 20) {
        lastStatusUpdatePercent = Math.floor((readLineCount / tsvEntityData.tsvLineCount) * 100);
        logger.info(
          `Processed '/new_block' events: ${lastStatusUpdatePercent}% (${readLineCount} / ${tsvEntityData.tsvLineCount})`
        );
      }
    }

    logger.info(`Re-enabling indexs on ${tables.join(', ')}...`);
    await db.toggleTableIndexes(sql, tables, true);
  });
  logger.info(`Inserting /new_block data took ${newBlockInsertSw.getElapsedSeconds(2)} seconds`);

  const reindexSw = stopwatch();
  for (const table of tables) {
    logger.info(`Reindexing table ${table}...`);
    await timeTracker.track(`reindex ${table}`, () => db.sql`REINDEX TABLE ${db.sql(table)}`);
  }
  logger.info(`Reindexing /new_block tables took ${reindexSw.getElapsedSeconds(2)} seconds`);
}

async function insertNewAttachmentEvents(
  tsvEntityData: TsvEntityData,
  db: PgWriteStore,
  filePath: string,
  timeTracker: TimeTracker
) {
  const preOrgStream = readPreorgTsv(filePath, '/attachments/new');
  let lastStatusUpdatePercent = 0;
  const tables = ['zonefiles', 'subdomains'];
  const newBlockInsertSw = stopwatch();
  await db.sql.begin(async sql => {
    // Temporarily disable indexing and contraints on tables to speed up insertion
    await db.toggleTableIndexes(sql, tables, false);

    for await (const event of preOrgStream) {
      const attatchmentMsg: CoreNodeAttachmentMessage[] = JSON.parse(event.payload);
      const attachments = parseAttachmentMessage(attatchmentMsg);

      for (const entry of attachments.zoneFiles) {
        // INSERT INTO zonefiles
        // TODO: probably remove this since `updateBatchSubdomains` inserts into both the subdomains and zonefile tables
        // await db.insertZonefileContent(sql, entry.zonefile, entry.zonefileHash);
      }

      for (const subdomain of attachments.subdomains) {
        // TODO: the `microblock_*` and `parent_index_block_hash` fields need populated
        // this could potentially done by scanning the tsv file in `getCanonicalEntityList(..)`,
        // otherwise, this would need a second pass after indexes are applied. Pros/cons to both
        // approaches.
        const blockData = {
          index_block_hash: subdomain.index_block_hash ?? '',
          parent_index_block_hash: '',
          microblock_hash: '',
          microblock_sequence: I32_MAX,
          microblock_canonical: true,
        };
        // INSERT INTO zonefiles
        // INSERT INTO subdomains
        await timeTracker.track('updateBatchSubdomains', () =>
          db.updateBatchSubdomains(sql, blockData, [subdomain], true)
        );
      }

      const readLineCount: number = event.readLineCount;
      if ((readLineCount / tsvEntityData.tsvLineCount) * 100 > lastStatusUpdatePercent + 20) {
        lastStatusUpdatePercent = Math.floor((readLineCount / tsvEntityData.tsvLineCount) * 100);
        logger.info(
          `Processed '/attachments/new' events: ${lastStatusUpdatePercent}% (${readLineCount} / ${tsvEntityData.tsvLineCount})`
        );
      }
    }

    logger.info(`Re-enabling indexs on ${tables.join(', ')}...`);
    await db.toggleTableIndexes(sql, tables, true);
  });
  logger.info(
    `Inserting /attachments/new data took ${newBlockInsertSw.getElapsedSeconds(2)} seconds`
  );

  const reindexSw = stopwatch();
  for (const table of tables) {
    logger.info(`Reindexing table ${table}...`);
    await timeTracker.track(`reindex ${table}`, () => db.sql`REINDEX TABLE ${db.sql(table)}`);
  }
  logger.info(`Reindexing /attachments/new tables took ${reindexSw.getElapsedSeconds(2)} seconds`);
}

async function insertNewBurnBlockEvents(
  tsvEntityData: TsvEntityData,
  db: PgWriteStore,
  filePath: string,
  timeTracker: TimeTracker
) {
  const preOrgStream = readPreorgTsv(filePath, '/new_burn_block');
  let lastStatusUpdatePercent = 0;
  const tables = ['burnchain_rewards', 'reward_slot_holders'];
  const newBurnBlockInsertSw = stopwatch();
  await db.sql.begin(async sql => {
    // Temporarily disable indexing and contraints on tables to speed up insertion
    await db.toggleTableIndexes(sql, tables, false);

    for await (const event of preOrgStream) {
      const burnBlockMsg: CoreNodeBurnBlockMessage = JSON.parse(event.payload);
      const burnBlockData = parseBurnBlockMessage(burnBlockMsg);

      if (burnBlockData.rewards.length > 0) {
        await timeTracker.track('updateBurnchainRewards', () =>
          db.updateBurnchainRewards({
            burnchainBlockHash: burnBlockMsg.burn_block_hash,
            burnchainBlockHeight: burnBlockMsg.burn_block_height,
            rewards: burnBlockData.rewards,
            skipReorg: true,
            sqlTx: sql,
          })
        );
      }
      if (burnBlockData.slotHolders.length > 0) {
        await timeTracker.track('updateBurnchainRewardSlotHolders', () =>
          db.updateBurnchainRewardSlotHolders({
            burnchainBlockHash: burnBlockMsg.burn_block_hash,
            burnchainBlockHeight: burnBlockMsg.burn_block_height,
            slotHolders: burnBlockData.slotHolders,
            skipReorg: true,
            sqlTx: sql,
          })
        );
      }

      const readLineCount: number = event.readLineCount;
      if ((readLineCount / tsvEntityData.tsvLineCount) * 100 > lastStatusUpdatePercent + 20) {
        lastStatusUpdatePercent = Math.floor((readLineCount / tsvEntityData.tsvLineCount) * 100);
        logger.info(
          `Processed '/new_burn_block' events: ${lastStatusUpdatePercent}% (${readLineCount} / ${tsvEntityData.tsvLineCount})`
        );
      }
    }

    logger.info(`Re-enabling indexs on ${tables.join(', ')}...`);
    await db.toggleTableIndexes(sql, tables, true);
  });
  logger.info(
    `Inserting /new_burn_block data took ${newBurnBlockInsertSw.getElapsedSeconds(2)} seconds`
  );

  const reindexSw = stopwatch();
  for (const table of tables) {
    logger.info(`Reindexing table ${table}...`);
    await timeTracker.track(`reindex ${table}`, () => db.sql`REINDEX TABLE ${db.sql(table)}`);
  }
  logger.info(`Reindexing /new_burn_block tables took ${reindexSw.getElapsedSeconds(2)} seconds`);
}
