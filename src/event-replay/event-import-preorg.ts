import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as tty from 'tty';
import { ChainID } from '@stacks/transactions';
import { finished } from 'stream/promises';
import {
  CoreNodeAttachmentMessage,
  CoreNodeBlockMessage,
  CoreNodeBurnBlockMessage,
} from '../event-stream/core-node-message';
import {
  parseAttachmentMessage,
  parseBurnBlockMessage,
  parseNewBlockMessage,
  startEventServer,
} from '../event-stream/event-server';
import { PgWriteStore } from '../datastore/pg-write-store';
import {
  batchIterate,
  createTimeTracker,
  getApiConfiguredChainID,
  httpPostRequest,
  humanFileSize,
  I32_MAX,
  logger,
  stopwatch,
  TimeTracker,
} from '../helpers';
import { readLines } from './reverse-line-reader';
import {
  createTsvReorgStream,
  getCanonicalEntityList,
  readTsvLines,
  TsvEntityData,
} from './tsv-pre-org';
import {
  BnsNameInsertValues,
  BnsZonefileInsertValues,
  DataStoreTxEventData,
  DbBlock,
  DbMicroblock,
  DbTx,
  FtEventInsertValues,
  NftEventInsertValues,
  PrincipalStxTxsInsertValues,
  RawEventRequestInsertValues,
  SmartContractEventInsertValues,
  StxEventInsertValues,
} from '../datastore/common';
import { getMempoolTxGarbageCollectionThreshold, validateZonefileHash } from '../datastore/helpers';

export async function preOrgTsvImport(filePath: string): Promise<void> {
  const timeTracker = createTimeTracker();

  if (process.env.NODE_ENV !== 'production') {
    logger.warn(
      `For best performance run with NODE_ENV=production, currenly running with NODE_ENV=${process.env.NODE_ENV}`
    );
  }

  const pgIndexMethodEnvVar = 'PG_IDENT_INDEX_TYPE';
  const pgIndexMethod = process.env[pgIndexMethodEnvVar];
  logger.info(`Running with \`${pgIndexMethodEnvVar}=${pgIndexMethod ?? 'btree'}\``);
  logger.info(
    `For fasted event import use \`${pgIndexMethodEnvVar}=btree\`, for serving production traffic use \`${pgIndexMethodEnvVar}=hash\``
  );

  const chainID = getApiConfiguredChainID();
  const db = await PgWriteStore.connect({
    usageName: 'import-events',
    skipMigrations: true,
    withNotifier: false,
    isEventReplay: true,
  });
  const startTime = stopwatch();

  // Set logger to only output for info or above, otherwise the event replay will result
  // in the equivalent of months/years of verbose API log output.
  logger.level = 'info';
  // Disable this feature so a redundant export file isn't created while importing from an existing one.
  delete process.env['STACKS_EXPORT_EVENTS_FILE'];

  const fileStat = await fsPromises.stat(filePath);

  const preorgTmpFilePrefix = `/tmp/stacks-api-event-import-${fileStat.mtime.toISOString()}`;
  const tsvEntityDataFilePath = preorgTmpFilePrefix + '.canonical-metadata.json';

  let tsvEntityData: TsvEntityData;
  if (fs.existsSync(tsvEntityDataFilePath)) {
    logger.info(`Using existing canonical metadata file: ${tsvEntityDataFilePath}`);
    tsvEntityData = JSON.parse(fs.readFileSync(tsvEntityDataFilePath, 'utf8'));
  } else {
    logger.info('Indexing canonical metadata from tsv file...');
    const scanTsvEntityDataSw = stopwatch();
    tsvEntityData = await timeTracker.track('getCanonicalEntityList', () =>
      getCanonicalEntityList(filePath)
    );
    logger.info(
      `Scanning tsv for canonical data took ${scanTsvEntityDataSw.getElapsedSeconds(2)} seconds`
    );
    logger.info(`Writing canonical metadata file: ${tsvEntityDataFilePath} ...`);
    await timeTracker.track('write entity file', () =>
      fsPromises.writeFile(tsvEntityDataFilePath, JSON.stringify(tsvEntityData))
    );
  }

  logger.info(
    `Tsv line count: ${tsvEntityData.tsvLineCount}, ` +
      `file size: ${humanFileSize(fileStat.size)}, ` +
      `block height: ${tsvEntityData.stacksBlockHashes.length}`
  );

  const blockWindowSize = getMempoolTxGarbageCollectionThreshold();
  const preorgBlockHeight = Math.max(tsvEntityData.stacksBlockHashes.length - blockWindowSize, 0);
  logger.info(
    `Pre-org importing events up to block ${preorgBlockHeight}, inserting the remaining as is`
  );

  const preOrgFilePath = preorgTmpFilePrefix + '-preorg.tsv';
  const remainingFilePath = preorgTmpFilePrefix + '-remaining.tsv';
  if (fs.existsSync(preOrgFilePath)) {
    logger.info(`Using existing preorg tsv file: ${preOrgFilePath}`);
  } else {
    logger.info(`Writing preorg tsv file: ${preOrgFilePath} ...`);
    const reorgFileSw = stopwatch();
    const inputLineReader = readLines(filePath);
    const transformStream = createTsvReorgStream({
      canonicalStacksBlockHashes: tsvEntityData.stacksBlockHashes,
      canonicalBurnBlockHashes: tsvEntityData.burnBlockHashes,
      preorgBlockHeight,
      outputCells: false,
    });
    const outputFileStream = fs.createWriteStream(preOrgFilePath);
    const remainderOutputFileStream = fs.createWriteStream(remainingFilePath);
    // First, pipe data to a 'preorg' file while it is being preprocessed (pruned & reorg'd)
    inputLineReader.pipe(transformStream).pipe(outputFileStream);
    void timeTracker.track('tsv preorg output', () => finished(outputFileStream));
    // Second, when max reorg block is find, end writing to 'preorg' file and start writing the unmodified data to the 'remainder' file
    transformStream.on('blockFound', () => {
      logger.info(`Writing unprocessed remainder events to tsv ${remainingFilePath} ...`);
      transformStream.unpipe();
      outputFileStream.end();
      transformStream.pipe(remainderOutputFileStream);
    });
    await timeTracker.track('tsv remainder output', () => finished(remainderOutputFileStream));

    logger.info(`Processing tsv data took ${reorgFileSw.getElapsedSeconds(2)} seconds`);
  }

  const pgParallelWorkers = await db.sql`SHOW max_parallel_maintenance_workers`;
  const pgMaxWorkingMem = await db.sql`SHOW maintenance_work_mem`;
  logger.info(
    `Using pgconf: maintenance_work_mem=${pgMaxWorkingMem[0].maintenance_work_mem}, max_parallel_maintenance_workers=${pgParallelWorkers[0].max_parallel_maintenance_workers}`
  );

  logger.info(`Inserting event data to db...`);
  // Running inserts in parallel saves ~20% on local testing
  await Promise.all([
    insertNewBurnBlockEvents(tsvEntityData, db, preOrgFilePath, timeTracker),
    insertNewAttachmentEvents(tsvEntityData, db, preOrgFilePath, timeTracker),
    insertRawEvents(tsvEntityData, db, preOrgFilePath, timeTracker),
    insertNewBlockEvents(tsvEntityData, db, preOrgFilePath, chainID, timeTracker),
  ]);

  logger.info(`Inserting non-org'd events after block ${preorgBlockHeight}...`);
  await importRemainderEvents(db, remainingFilePath, chainID, timeTracker);

  logger.info(`Refreshing materialized views...`);
  const finishReplaySw = stopwatch();
  await timeTracker.track('finishEventReplay', () => db.finishEventReplay());
  logger.info(`Refreshing materialized views took: ${finishReplaySw.getElapsedSeconds(2)} seconds`);

  if (tty.isatty(1)) {
  console.log('Tracked function times:');
  console.table(timeTracker.getDurations(3));
  } else {
    logger.info(`Tracked function times`, timeTracker.getDurations(3));
  }

  await db.close();
  logger.info(`Event import took: ${startTime.getElapsedSeconds(2)} seconds`);
}

async function importRemainderEvents(
  db: PgWriteStore,
  remainderFilePath: string,
  chainID: ChainID,
  timeTracker: TimeTracker
) {
  const importRemainderSw = stopwatch();
  const eventServer = await startEventServer({
    datastore: db,
    chainId: chainID,
    serverHost: '127.0.0.1',
    serverPort: 0,
    httpLogLevel: 'debug',
  });
  const lineStream = readTsvLines(remainderFilePath);
  for await (const event of lineStream) {
    if (!event) {
      continue;
    }
    await timeTracker.track(`POST ${event.path}`, () =>
      httpPostRequest({
        host: '127.0.0.1',
        port: eventServer.serverAddress.port,
        path: event.path,
        headers: { 'Content-Type': 'application/json' },
        body: event.payload,
        throwOnNotOK: true,
      })
    );
  }
  await eventServer.closeAsync();
  const elapsed = importRemainderSw.getElapsedSeconds(2);
  logger.info(`Event import for remainder non-org'd data took ${elapsed} seconds`);
}

async function insertRawEvents(
  tsvEntityData: TsvEntityData,
  db: PgWriteStore,
  filePath: string,
  timeTracker: TimeTracker
) {
  const preOrgStream = readTsvLines(filePath);
  let lastStatusUpdatePercent = 0;
  const newBlockInsertSw = stopwatch();

  await db.sql.begin(async sql => {
    // individual inserts: 90 seconds
    // batches of 1000: 90 seconds
    // batches of 5000: 95 seconds
    // batches of 1000 w/ text instead of json data type: 67 seconds
    const dbRawEventBatchInserter = createBatchInserter<RawEventRequestInsertValues>(
      1000,
      async entries => {
        await timeTracker.track('insertRawEventRequestBatch', () =>
          db.insertRawEventRequestBatch(sql, entries)
        );
      }
    );

    for await (const event of preOrgStream) {
      // INSERT INTO event_observer_requests
      await dbRawEventBatchInserter.push([{ event_path: event.path, payload: event.payload }]);

      const readLineCount: number = event.readLineCount;
      if ((readLineCount / tsvEntityData.tsvLineCount) * 100 > lastStatusUpdatePercent + 20) {
        lastStatusUpdatePercent = Math.floor((readLineCount / tsvEntityData.tsvLineCount) * 100);
        logger.info(
          `Raw event requests processed: ${lastStatusUpdatePercent}% (${readLineCount} / ${tsvEntityData.tsvLineCount})`
        );
      }
    }

    await dbRawEventBatchInserter.flush();
    logger.info(`Raw event requests processed: 100%`);
  });

  logger.info(`Inserting raw event data took ${newBlockInsertSw.getElapsedSeconds(2)} seconds`);
}

async function insertNewBlockEvents(
  tsvEntityData: TsvEntityData,
  db: PgWriteStore,
  filePath: string,
  chainID: ChainID,
  timeTracker: TimeTracker
) {
  const preOrgStream = readTsvLines(filePath, '/new_block');
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
    'zonefiles',
  ];
  const blockInsertSw = stopwatch();
  await db.sql.begin(async sql => {
    // Temporarily disable indexing and constraints on tables to speed up insertion
    await db.toggleTableIndexes(sql, tables, false);

    let blocksInserted = 0;

    const batchInserters: BatchInserter[] = [];

    // single inserts: 14 seconds
    // batches of 1000: 0.81 seconds
    const dbBlockBatchInserter = createBatchInserter<DbBlock>(1000, entries =>
      timeTracker.track('insertBlockBatch', () => db.insertBlockBatch(sql, entries))
    );
    batchInserters.push(dbBlockBatchInserter);

    // single inserts: 4.6 seconds
    // batches of 1000: 1.2 seconds
    const dbMicroblockBatchInserter = createBatchInserter<DbMicroblock>(1000, entries =>
      timeTracker.track('insertMicroblock', () => db.insertMicroblock(sql, entries))
    );
    batchInserters.push(dbMicroblockBatchInserter);

    // batches of 500: 94 seconds
    // batches of 1000: 85 seconds
    // batches of 1500: 80 seconds
    const dbTxBatchInserter = createBatchInserter<DbTx>(1000, entries =>
      timeTracker.track('insertTxBatch', () => db.insertTxBatch(sql, entries))
    );
    batchInserters.push(dbTxBatchInserter);

    // batches of 1000: 31 seconds
    const dbStxEventBatchInserter = createBatchInserter<StxEventInsertValues>(1000, entries =>
      timeTracker.track('insertStxEventBatch', () => db.insertStxEventBatch(sql, entries))
    );
    batchInserters.push(dbStxEventBatchInserter);

    // batches of 1000: 56 seconds
    const dbPrincipalStxTxBatchInserter = createBatchInserter<PrincipalStxTxsInsertValues>(
      1000,
      entries =>
        timeTracker.track('insertPrincipalStxTxsBatch', () =>
          db.insertPrincipalStxTxsBatch(sql, entries)
        )
    );
    batchInserters.push(dbPrincipalStxTxBatchInserter);

    // batches of 1000: 14 seconds
    const dbFtEventBatchInserter = createBatchInserter<FtEventInsertValues>(1000, entries =>
      timeTracker.track('insertFtEventBatch', () => db.insertFtEventBatch(sql, entries))
    );
    batchInserters.push(dbFtEventBatchInserter);

    // batches of 1000: 15 seconds
    const dbNftEventBatchInserter = createBatchInserter<NftEventInsertValues>(1000, entries =>
      timeTracker.track('insertNftEventBatch', () => db.insertNftEventBatch(sql, entries))
    );
    batchInserters.push(dbNftEventBatchInserter);

    // batches of 1000: 18 seconds
    const dbContractEventBatchInserter = createBatchInserter<SmartContractEventInsertValues>(
      1000,
      entries =>
        timeTracker.track('insertContractEventBatch', () =>
          db.insertContractEventBatch(sql, entries)
        )
    );
    batchInserters.push(dbContractEventBatchInserter);

    // single inserts: 10 seconds
    // batches of 1000: 0.6 seconds
    const dbNameBatchInserter = createBatchInserter<BnsNameInsertValues>(1000, entries =>
      timeTracker.track('insertNameBatch', () => db.insertNameBatch(sql, entries))
    );
    batchInserters.push(dbNameBatchInserter);

    // batches of 1000: 0.1 seconds
    const dbZonefileBatchInserter = createBatchInserter<BnsZonefileInsertValues>(1000, entries =>
      timeTracker.track('insertZonefileBatch', () => db.insertZonefileBatch(sql, entries))
    );
    batchInserters.push(dbZonefileBatchInserter);

    const processStxEvents = async (entry: DataStoreTxEventData) => {
      // string key: `principal, tx_id, index_block_hash, microblock_hash`
      const alreadyInsertedRowKeys = new Set<string>();
      const values: PrincipalStxTxsInsertValues[] = [];
      const push = (principal: string) => {
        // Check if this row has already been inserted by comparing the same columns used in the
        // sql unique constraint defined on the table. This prevents later errors during re-indexing
        // when the table indexes/constraints are temporarily disabled during inserts.
        const constraintKey = `${principal},${entry.tx.tx_id},${entry.tx.index_block_hash},${entry.tx.microblock_hash}`;
        if (!alreadyInsertedRowKeys.has(constraintKey)) {
          alreadyInsertedRowKeys.add(constraintKey);
          values.push({
            principal: principal,
            tx_id: entry.tx.tx_id,
            block_height: entry.tx.block_height,
            index_block_hash: entry.tx.index_block_hash,
            microblock_hash: entry.tx.microblock_hash,
            microblock_sequence: entry.tx.microblock_sequence,
            tx_index: entry.tx.tx_index,
            canonical: entry.tx.canonical,
            microblock_canonical: entry.tx.microblock_canonical,
          });
        }
      };

      const principals = new Set<string>();

      // Insert tx data
      [
        entry.tx.sender_address,
        entry.tx.token_transfer_recipient_address,
        entry.tx.contract_call_contract_id,
        entry.tx.smart_contract_contract_id,
      ]
        .filter((p): p is string => !!p)
        .forEach(p => principals.add(p));

      // Insert stx_event data
      entry.stxEvents.forEach(event => {
        if (event.sender) {
          principals.add(event.sender);
        }
        if (event.recipient) {
          principals.add(event.recipient);
        }
      });

      principals.forEach(principal => push(principal));
      await dbPrincipalStxTxBatchInserter.push(values);
    };

    for await (const event of preOrgStream) {
      blocksInserted++;
      const newBlockMsg: CoreNodeBlockMessage = JSON.parse(event.payload);
      const dbData = parseNewBlockMessage(chainID, newBlockMsg);

      // INSERT INTO blocks
      await dbBlockBatchInserter.push([dbData.block]);

      if (dbData.microblocks.length > 0) {
        // INSERT INTO microblocks
        await dbMicroblockBatchInserter.push(dbData.microblocks);
      }

      if (dbData.txs.length > 0) {
        for (const entry of dbData.txs) {
          // INSERT INTO txs
          await dbTxBatchInserter.push([entry.tx]);

          // INSERT INTO stx_events
          await dbStxEventBatchInserter.push(
            entry.stxEvents.map(stxEvent => ({
              event_index: stxEvent.event_index,
              tx_id: stxEvent.tx_id,
              tx_index: stxEvent.tx_index,
              block_height: stxEvent.block_height,
              index_block_hash: entry.tx.index_block_hash,
              parent_index_block_hash: entry.tx.parent_index_block_hash,
              microblock_hash: entry.tx.microblock_hash,
              microblock_sequence: entry.tx.microblock_sequence,
              microblock_canonical: entry.tx.microblock_canonical,
              canonical: stxEvent.canonical,
              asset_event_type_id: stxEvent.asset_event_type_id,
              sender: stxEvent.sender ?? null,
              recipient: stxEvent.recipient ?? null,
              amount: stxEvent.amount,
            }))
          );

          // INSERT INTO principal_stx_txs
          await processStxEvents(entry);

          // INSERT INTO contract_logs
          await dbContractEventBatchInserter.push(
            entry.contractLogEvents.map(contractEvent => ({
              event_index: contractEvent.event_index,
              tx_id: contractEvent.tx_id,
              tx_index: contractEvent.tx_index,
              block_height: contractEvent.block_height,
              index_block_hash: entry.tx.index_block_hash,
              parent_index_block_hash: entry.tx.parent_index_block_hash,
              microblock_hash: entry.tx.microblock_hash,
              microblock_sequence: entry.tx.microblock_sequence,
              microblock_canonical: entry.tx.microblock_canonical,
              canonical: contractEvent.canonical,
              contract_identifier: contractEvent.contract_identifier,
              topic: contractEvent.topic,
              value: contractEvent.value,
            }))
          );

          // INSERT INTO stx_lock_events
          for (const stxLockEvent of entry.stxLockEvents) {
            await timeTracker.track('updateStxLockEvent', () =>
              db.updateStxLockEvent(sql, entry.tx, stxLockEvent)
            );
          }

          // INSERT INTO ft_events
          await dbFtEventBatchInserter.push(
            entry.ftEvents.map(ftEvent => ({
              event_index: ftEvent.event_index,
              tx_id: ftEvent.tx_id,
              tx_index: ftEvent.tx_index,
              block_height: ftEvent.block_height,
              index_block_hash: entry.tx.index_block_hash,
              parent_index_block_hash: entry.tx.parent_index_block_hash,
              microblock_hash: entry.tx.microblock_hash,
              microblock_sequence: entry.tx.microblock_sequence,
              microblock_canonical: entry.tx.microblock_canonical,
              canonical: ftEvent.canonical,
              asset_event_type_id: ftEvent.asset_event_type_id,
              sender: ftEvent.sender ?? null,
              recipient: ftEvent.recipient ?? null,
              asset_identifier: ftEvent.asset_identifier,
              amount: ftEvent.amount.toString(),
            }))
          );

          // INSERT INTO nft_events
          await dbNftEventBatchInserter.push(
            entry.nftEvents.map(nftEvent => ({
              tx_id: nftEvent.tx_id,
              index_block_hash: entry.tx.index_block_hash,
              parent_index_block_hash: entry.tx.parent_index_block_hash,
              microblock_hash: entry.tx.microblock_hash,
              microblock_sequence: entry.tx.microblock_sequence,
              microblock_canonical: entry.tx.microblock_canonical,
              sender: nftEvent.sender ?? null,
              recipient: nftEvent.recipient ?? null,
              event_index: nftEvent.event_index,
              tx_index: nftEvent.tx_index,
              block_height: nftEvent.block_height,
              canonical: nftEvent.canonical,
              asset_event_type_id: nftEvent.asset_event_type_id,
              asset_identifier: nftEvent.asset_identifier,
              value: nftEvent.value,
            }))
          );

          // INSERT INTO smart_contracts
          for (const smartContract of entry.smartContracts) {
            await timeTracker.track('updateSmartContract', () =>
              db.updateSmartContract(sql, entry.tx, smartContract)
            );
          }

          // INSERT INTO names
          await dbNameBatchInserter.push(
            entry.names.map(bnsName => ({
              name: bnsName.name,
              address: bnsName.address,
              registered_at: bnsName.registered_at,
              expire_block: bnsName.expire_block,
              zonefile_hash: validateZonefileHash(bnsName.zonefile_hash),
              namespace_id: bnsName.namespace_id,
              tx_index: bnsName.tx_index,
              tx_id: bnsName.tx_id,
              status: bnsName.status ?? null,
              canonical: bnsName.canonical,
              index_block_hash: entry.tx.index_block_hash,
              parent_index_block_hash: entry.tx.parent_index_block_hash,
              microblock_hash: entry.tx.microblock_hash,
              microblock_sequence: entry.tx.microblock_sequence,
              microblock_canonical: entry.tx.microblock_canonical,
            }))
          );

          // INSERT INTO zonefiles
          await dbZonefileBatchInserter.push(
            entry.names.map(bnsName => ({
              zonefile: bnsName.zonefile,
              zonefile_hash: validateZonefileHash(bnsName.zonefile_hash),
            }))
          );

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
        const insertsPerSecond = (blocksInserted / blockInsertSw.getElapsedSeconds()).toFixed(2);
        lastStatusUpdatePercent = Math.floor((readLineCount / tsvEntityData.tsvLineCount) * 100);
        logger.info(
          `Processed '/new_block' events: ${lastStatusUpdatePercent}%, ${insertsPerSecond} blocks/sec`
        );
      }
    }

    for (const batchInserter of batchInserters) {
      await batchInserter.flush();
    }

    logger.info(`Processed '/new_block' events: 100%`);

    logger.info(`Re-enabling indexes on ${tables.join(', ')}...`);
    await db.toggleTableIndexes(sql, tables, true);
  });
  logger.info(`Inserting /new_block data took ${blockInsertSw.getElapsedSeconds(2)} seconds`);

  const reindexSw = stopwatch();
  // one at a time indexing: 97.57
  // parallel indexing: 56.16
  await Promise.all(
    tables.map(table => {
    logger.info(`Reindexing table ${table}...`);
      return timeTracker.track(`reindex ${table}`, () => db.sql`REINDEX TABLE ${db.sql(table)}`);
    })
  );
  logger.info(`Reindexing /new_block tables took ${reindexSw.getElapsedSeconds(2)} seconds`);
}

async function insertNewAttachmentEvents(
  tsvEntityData: TsvEntityData,
  db: PgWriteStore,
  filePath: string,
  timeTracker: TimeTracker
) {
  const preOrgStream = readTsvLines(filePath, '/attachments/new');
  let lastStatusUpdatePercent = 0;
  const tables = ['zonefiles', 'subdomains'];
  const newBlockInsertSw = stopwatch();
  await db.sql.begin(async sql => {
    // Temporarily disable indexing and constraints on tables to speed up insertion
    await db.toggleTableIndexes(sql, tables, false);

    for await (const event of preOrgStream) {
      const attatchmentMsg: CoreNodeAttachmentMessage[] = JSON.parse(event.payload);
      const attachments = parseAttachmentMessage(attatchmentMsg);

      for (const subdomain of attachments.subdomains) {
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const indexBlockHash = subdomain.index_block_hash!;
        const blockEntityData = tsvEntityData.stacksBlockHashes[subdomain.block_height - 1];
        const parentIndexBlockHash = tsvEntityData.stacksBlockHashes[subdomain.block_height - 2][0];
        const microblocks = blockEntityData[1];
        const microblockIndex = microblocks.findIndex(
          (mb, index) => index > 0 && mb[1].includes(subdomain.tx_id)
        );

        // derive from entity hash index
        subdomain.tx_index = blockEntityData[1]
          .flatMap(m => m[1])
          .findIndex(tx => tx === subdomain.tx_id);

        const blockData = {
          index_block_hash: indexBlockHash,
          parent_index_block_hash: parentIndexBlockHash,
          microblock_hash: microblockIndex !== -1 ? microblocks[microblockIndex][0] : '',
          microblock_sequence: microblockIndex !== -1 ? microblockIndex - 1 : I32_MAX,
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
        logger.info(`Processed '/attachments/new' events: ${lastStatusUpdatePercent}%`);
      }
    }
    logger.info(`Processed '/attachments/new' events: 100%`);

    logger.info(`Re-enabling indexes on ${tables.join(', ')}...`);
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
  const preOrgStream = readTsvLines(filePath, '/new_burn_block');
  let lastStatusUpdatePercent = 0;
  const tables = ['burnchain_rewards', 'reward_slot_holders'];
  const newBurnBlockInsertSw = stopwatch();
  await db.sql.begin(async sql => {
    // Temporarily disable indexing and constraints on tables to speed up insertion
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
        logger.info(`Processed '/new_burn_block' events: ${lastStatusUpdatePercent}%`);
      }
    }
    logger.info(`Processed '/new_burn_block' events: 100%`);

    logger.info(`Re-enabling indexes on ${tables.join(', ')}...`);
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

interface BatchInserter<T = any> {
  push(entries: T[]): Promise<void>;
  flush(): Promise<void>;
}

function createBatchInserter<T>(
  batchSize: number,
  insertFn: (entries: T[]) => Promise<void>
): BatchInserter<T> {
  const entryBuffer: T[] = [];
  return {
    async push(entries: T[]) {
      entries.length === 1
        ? entryBuffer.push(entries[0])
        : entries.forEach(e => entryBuffer.push(e));
      if (entryBuffer.length === batchSize) {
        await insertFn(entryBuffer);
        entryBuffer.length = 0;
      } else if (entryBuffer.length > batchSize) {
        for (const batch of batchIterate(entryBuffer, batchSize)) {
          await insertFn(batch);
        }
        entryBuffer.length = 0;
      }
    },
    async flush() {
      if (entryBuffer.length > 0) {
        await insertFn(entryBuffer);
        entryBuffer.length = 0;
      }
    },
  };
}
