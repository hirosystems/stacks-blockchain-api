import * as fs from 'fs';
import { Readable, Writable } from 'stream';
import { ClientBase, Pool, QueryConfig } from 'pg';
import * as pgCopyStreams from 'pg-copy-streams';
import * as PgCursor from 'pg-cursor';
import {
  bufferToHexPrefixString,
  hexToBuffer,
  logger,
  logError,
  getOrAdd,
  batchIterate,
  pipelineAsync,
  isProdEnv,
} from '../helpers';
import {
  DbBlock,
  DbTx,
  DbStxEvent,
  DbFtEvent,
  DbNftEvent,
  DbTxTypeId,
  DbSmartContractEvent,
  DbSmartContract,
  DataStoreBlockUpdateData,
  DbMempoolTx,
  DbStxLockEvent,
  DbMinerReward,
  DbBurnchainReward,
  DbTxStatus,
  DbRewardSlotHolder,
  DbBnsName,
  DbBnsNamespace,
  DbBnsSubdomain,
  DbConfigState,
  DbTokenOfferingLocked,
  DataStoreMicroblockUpdateData,
  DbMicroblock,
  DataStoreTxEventData,
  DbRawEventRequest,
  DbNonFungibleTokenMetadata,
  DbFungibleTokenMetadata,
  DbTokenMetadataQueueEntry,
} from './common';
import { isProcessableTokenMetadata } from '../event-stream/tokens-contract-handler';
import { ClarityAbi } from '@stacks/transactions';
import {
  BlockQueryResult,
  BLOCK_COLUMNS,
  MempoolTxQueryResult,
  MEMPOOL_TX_COLUMNS,
  MicroblockQueryResult,
  MICROBLOCK_COLUMNS,
  parseBlockQueryResult,
  parseMempoolTxQueryResult,
  parseMicroblockQueryResult,
  parseTxQueryResult,
  TxQueryResult,
  TX_COLUMNS,
  TX_METADATA_TABLES,
  UpdatedEntities,
  validateZonefileHash,
} from './helpers';
import { PgNotifier } from './pg-notifier';
import { PgStore } from './pg-store';
import { connectPgPool, getPgClientConfig, PgServer } from './connection';
import { runMigrations } from './migrations';

class MicroblockGapError extends Error {
  constructor(message: string) {
    super(message);
    this.message = message;
    this.name = this.constructor.name;
  }
}

/**
 * Extends `PgStore` to provide data insertion functions. These added features are usually called by
 * the `EventServer` upon receiving blockchain events from a Stacks node. It also deals with chain data
 * re-orgs and Postgres NOTIFY message broadcasts when important data is written into the DB.
 */
export class PgWriteStore extends PgStore {
  readonly isEventReplay: boolean;
  private cachedParameterizedInsertStrings = new Map<string, string>();

  constructor(
    pool: Pool,
    notifier: PgNotifier | undefined = undefined,
    isEventReplay: boolean = false
  ) {
    super(pool, notifier);
    this.isEventReplay = isEventReplay;
  }

  static async connect({
    usageName,
    skipMigrations = false,
    withNotifier = true,
    isEventReplay = false,
  }: {
    usageName: string;
    skipMigrations?: boolean;
    withNotifier?: boolean;
    isEventReplay?: boolean;
  }): Promise<PgWriteStore> {
    const pool = await connectPgPool({ usageName: usageName, pgServer: PgServer.primary });
    if (!skipMigrations) {
      await runMigrations(
        getPgClientConfig({
          usageName: `${usageName}:schema-migrations`,
          pgServer: PgServer.primary,
        })
      );
    }
    const notifier = withNotifier ? PgNotifier.create(usageName) : undefined;
    const store = new PgWriteStore(pool, notifier, isEventReplay);
    await store.connectPgNotifier();
    return store;
  }

  async getChainTip(
    client: ClientBase
  ): Promise<{ blockHeight: number; blockHash: string; indexBlockHash: string }> {
    if (!this.isEventReplay) {
      return super.getChainTip(client);
    }
    const currentTipBlock = await client.query<{
      block_height: number;
      block_hash: Buffer;
      index_block_hash: Buffer;
    }>(
      // The `chain_tip` materialized view is not available during event replay.
      // Since `getChainTip()` is used heavily during event ingestion, we'll fall back to
      // a classic query.
      `
      SELECT block_height, block_hash, index_block_hash
      FROM blocks
      WHERE canonical = true AND block_height = (SELECT MAX(block_height) FROM blocks)
      `
    );
    const height = currentTipBlock.rows[0]?.block_height ?? 0;
    return {
      blockHeight: height,
      blockHash: bufferToHexPrefixString(currentTipBlock.rows[0]?.block_hash ?? Buffer.from([])),
      indexBlockHash: bufferToHexPrefixString(
        currentTipBlock.rows[0]?.index_block_hash ?? Buffer.from([])
      ),
    };
  }

  private generateParameterizedInsertString({
    columnCount,
    rowCount,
  }: {
    columnCount: number;
    rowCount: number;
  }): string {
    const cacheKey = `${columnCount}x${rowCount}`;
    const existing = this.cachedParameterizedInsertStrings.get(cacheKey);
    if (existing !== undefined) {
      return existing;
    }
    const params: string[][] = [];
    let i = 1;
    for (let r = 0; r < rowCount; r++) {
      params[r] = Array<string>(columnCount);
      for (let c = 0; c < columnCount; c++) {
        params[r][c] = `\$${i++}`;
      }
    }
    const stringRes = params.map(r => `(${r.join(',')})`).join(',');
    this.cachedParameterizedInsertStrings.set(cacheKey, stringRes);
    return stringRes;
  }

  async storeRawEventRequest(eventPath: string, payload: string): Promise<void> {
    // To avoid depending on the DB more than once and to allow the query transaction to settle,
    // we'll take the complete insert result and move that to the output TSV file instead of taking
    // only the `id` and performing a `COPY` of that row later.
    const insertResult = await this.queryTx(async client => {
      return await client.query<{
        id: string;
        receive_timestamp: string;
        event_path: string;
        payload: string;
      }>(
        `INSERT INTO event_observer_requests(
          event_path, payload
        ) values($1, $2)
        RETURNING id, receive_timestamp::text, event_path, payload::text`,
        [eventPath, payload]
      );
    });
    if (insertResult.rowCount !== 1) {
      throw new Error(
        `Unexpected row count ${insertResult.rowCount} when storing event_observer_requests entry`
      );
    }
    const exportEventsFile = process.env['STACKS_EXPORT_EVENTS_FILE'];
    if (exportEventsFile) {
      const result = insertResult.rows[0];
      const tsvRow = [result.id, result.receive_timestamp, result.event_path, result.payload];
      fs.appendFileSync(exportEventsFile, tsvRow.join('\t') + '\n');
    }
  }

  static async exportRawEventRequests(targetStream: Writable): Promise<void> {
    const pg = await this.connect({
      usageName: 'export-raw-events',
      skipMigrations: true,
      withNotifier: false,
    });
    try {
      await pg.query(async client => {
        const copyQuery = pgCopyStreams.to(
          `
          COPY (SELECT id, receive_timestamp, event_path, payload FROM event_observer_requests ORDER BY id ASC)
          TO STDOUT ENCODING 'UTF8'
          `
        );
        const queryStream = client.query(copyQuery);
        await pipelineAsync(queryStream, targetStream);
      });
    } finally {
      await pg.close();
    }
  }

  static async *getRawEventRequests(
    readStream: Readable,
    onStatusUpdate?: (msg: string) => void
  ): AsyncGenerator<DbRawEventRequest[], void, unknown> {
    // 1. Pipe input stream into a temp table
    // 2. Use `pg-cursor` to async read rows from temp table (order by `id` ASC)
    // 3. Drop temp table
    // 4. Close db connection
    const pg = await this.connect({
      usageName: 'get-raw-events',
      skipMigrations: true,
      withNotifier: false,
    });
    try {
      const client = await pg.sql.connect();
      try {
        await client.query('BEGIN');
        await client.query(`
          CREATE TEMPORARY TABLE temp_event_observer_requests(
            id bigint PRIMARY KEY,
            receive_timestamp timestamptz NOT NULL,
            event_path text NOT NULL,
            payload jsonb NOT NULL
          ) ON COMMIT DROP
        `);
        // Use a `temp_raw_tsv` table first to store the raw TSV data as it might come with duplicate
        // rows which would trigger the `PRIMARY KEY` constraint in `temp_event_observer_requests`.
        // We will "upsert" from the former to the latter before event ingestion.
        await client.query(`
          CREATE TEMPORARY TABLE temp_raw_tsv
          (LIKE temp_event_observer_requests)
          ON COMMIT DROP
        `);
        onStatusUpdate?.('Importing raw event requests into temporary table...');
        const importStream = client.query(pgCopyStreams.from(`COPY temp_raw_tsv FROM STDIN`));
        await pipelineAsync(readStream, importStream);
        await client.query(`
          INSERT INTO temp_event_observer_requests
          SELECT *
          FROM temp_raw_tsv
          ON CONFLICT DO NOTHING;
        `);
        const totalRowCountQuery = await client.query<{ count: string }>(
          `SELECT COUNT(id) count FROM temp_event_observer_requests`
        );
        const totalRowCount = parseInt(totalRowCountQuery.rows[0].count);
        let lastStatusUpdatePercent = 0;
        onStatusUpdate?.('Streaming raw event requests from temporary table...');
        const cursor = new PgCursor<{ id: string; event_path: string; payload: string }>(
          `
          SELECT id, event_path, payload::text
          FROM temp_event_observer_requests
          ORDER BY id ASC
          `
        );
        const cursorQuery = client.query(cursor);
        const rowBatchSize = 100;
        let rowsReadCount = 0;
        let rows: DbRawEventRequest[] = [];
        do {
          rows = await new Promise<DbRawEventRequest[]>((resolve, reject) => {
            cursorQuery.read(rowBatchSize, (error, rows) => {
              if (error) {
                reject(error);
              } else {
                rowsReadCount += rows.length;
                if ((rowsReadCount / totalRowCount) * 100 > lastStatusUpdatePercent + 1) {
                  lastStatusUpdatePercent = Math.floor((rowsReadCount / totalRowCount) * 100);
                  onStatusUpdate?.(
                    `Raw event requests processed: ${lastStatusUpdatePercent}% (${rowsReadCount} / ${totalRowCount})`
                  );
                }
                resolve(rows);
              }
            });
          });
          if (rows.length > 0) {
            yield rows;
          }
        } while (rows.length > 0);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        client.release();
      }
    } finally {
      await pg.close();
    }
  }

  static async containsAnyRawEventRequests(): Promise<boolean> {
    const pg = await this.connect({
      usageName: 'contains-raw-events-check',
      skipMigrations: true,
      withNotifier: false,
    });
    try {
      return await pg.query(async client => {
        try {
          const result = await client.query('SELECT id from event_observer_requests LIMIT 1');
          return result.rowCount > 0;
        } catch (error: any) {
          if (error.message?.includes('does not exist')) {
            return false;
          }
          throw error;
        }
      });
    } finally {
      await pg.close();
    }
  }

  async update(data: DataStoreBlockUpdateData): Promise<void> {
    const tokenMetadataQueueEntries: DbTokenMetadataQueueEntry[] = [];
    await this.queryTx(async client => {
      const chainTip = await this.getChainTip(client);
      await this.handleReorg(client, data.block, chainTip.blockHeight);
      // If the incoming block is not of greater height than current chain tip, then store data as non-canonical.
      const isCanonical = data.block.block_height > chainTip.blockHeight;
      if (!isCanonical) {
        data.block = { ...data.block, canonical: false };
        data.microblocks = data.microblocks.map(mb => ({ ...mb, canonical: false }));
        data.txs = data.txs.map(tx => ({
          tx: { ...tx.tx, canonical: false },
          stxLockEvents: tx.stxLockEvents.map(e => ({ ...e, canonical: false })),
          stxEvents: tx.stxEvents.map(e => ({ ...e, canonical: false })),
          ftEvents: tx.ftEvents.map(e => ({ ...e, canonical: false })),
          nftEvents: tx.nftEvents.map(e => ({ ...e, canonical: false })),
          contractLogEvents: tx.contractLogEvents.map(e => ({ ...e, canonical: false })),
          smartContracts: tx.smartContracts.map(e => ({ ...e, canonical: false })),
          names: tx.names.map(e => ({ ...e, canonical: false })),
          namespaces: tx.namespaces.map(e => ({ ...e, canonical: false })),
        }));
        data.minerRewards = data.minerRewards.map(mr => ({ ...mr, canonical: false }));
      } else {
        // When storing newly mined canonical txs, remove them from the mempool table.
        const candidateTxIds = data.txs.map(d => d.tx.tx_id);
        const removedTxsResult = await this.pruneMempoolTxs(client, candidateTxIds);
        if (removedTxsResult.removedTxs.length > 0) {
          logger.verbose(
            `Removed ${removedTxsResult.removedTxs.length} txs from mempool table during new block ingestion`
          );
        }
      }

      //calculate total execution cost of the block
      const totalCost = data.txs.reduce(
        (previousValue, currentValue) => {
          const {
            execution_cost_read_count,
            execution_cost_read_length,
            execution_cost_runtime,
            execution_cost_write_count,
            execution_cost_write_length,
          } = previousValue;

          return {
            execution_cost_read_count:
              execution_cost_read_count + currentValue.tx.execution_cost_read_count,
            execution_cost_read_length:
              execution_cost_read_length + currentValue.tx.execution_cost_read_length,
            execution_cost_runtime: execution_cost_runtime + currentValue.tx.execution_cost_runtime,
            execution_cost_write_count:
              execution_cost_write_count + currentValue.tx.execution_cost_write_count,
            execution_cost_write_length:
              execution_cost_write_length + currentValue.tx.execution_cost_write_length,
          };
        },
        {
          execution_cost_read_count: 0,
          execution_cost_read_length: 0,
          execution_cost_runtime: 0,
          execution_cost_write_count: 0,
          execution_cost_write_length: 0,
        }
      );

      data.block.execution_cost_read_count = totalCost.execution_cost_read_count;
      data.block.execution_cost_read_length = totalCost.execution_cost_read_length;
      data.block.execution_cost_runtime = totalCost.execution_cost_runtime;
      data.block.execution_cost_write_count = totalCost.execution_cost_write_count;
      data.block.execution_cost_write_length = totalCost.execution_cost_write_length;

      let batchedTxData: DataStoreTxEventData[] = data.txs;

      // Find microblocks that weren't already inserted via the unconfirmed microblock event.
      // This happens when a stacks-node is syncing and receives confirmed microblocks with their anchor block at the same time.
      if (data.microblocks.length > 0) {
        const existingMicroblocksQuery = await client.query<{ microblock_hash: Buffer }>(
          `
          SELECT microblock_hash
          FROM microblocks
          WHERE parent_index_block_hash = $1 AND microblock_hash = ANY($2)
          `,
          [
            hexToBuffer(data.block.parent_index_block_hash),
            data.microblocks.map(mb => hexToBuffer(mb.microblock_hash)),
          ]
        );
        const existingMicroblockHashes = new Set(
          existingMicroblocksQuery.rows.map(r => bufferToHexPrefixString(r.microblock_hash))
        );

        const missingMicroblocks = data.microblocks.filter(
          mb => !existingMicroblockHashes.has(mb.microblock_hash)
        );
        if (missingMicroblocks.length > 0) {
          const missingMicroblockHashes = new Set(missingMicroblocks.map(mb => mb.microblock_hash));
          const missingTxs = data.txs.filter(entry =>
            missingMicroblockHashes.has(entry.tx.microblock_hash)
          );
          await this.insertMicroblockData(client, missingMicroblocks, missingTxs);

          // Clear already inserted microblock txs from the anchor-block update data to avoid duplicate inserts.
          batchedTxData = batchedTxData.filter(entry => {
            return !missingMicroblockHashes.has(entry.tx.microblock_hash);
          });
        }
      }

      // When processing an immediately-non-canonical block, do not orphan and possible existing microblocks
      // which may be still considered canonical by the canonical block at this height.
      if (isCanonical) {
        const { acceptedMicroblockTxs, orphanedMicroblockTxs } = await this.updateMicroCanonical(
          client,
          {
            isCanonical: isCanonical,
            blockHeight: data.block.block_height,
            blockHash: data.block.block_hash,
            indexBlockHash: data.block.index_block_hash,
            parentIndexBlockHash: data.block.parent_index_block_hash,
            parentMicroblockHash: data.block.parent_microblock_hash,
            parentMicroblockSequence: data.block.parent_microblock_sequence,
            burnBlockTime: data.block.burn_block_time,
          }
        );

        // Identify any micro-orphaned txs that also didn't make it into this anchor block, and restore them into the mempool
        const orphanedAndMissingTxs = orphanedMicroblockTxs.filter(
          tx => !data.txs.find(r => tx.tx_id === r.tx.tx_id)
        );
        const restoredMempoolTxs = await this.restoreMempoolTxs(
          client,
          orphanedAndMissingTxs.map(tx => tx.tx_id)
        );
        restoredMempoolTxs.restoredTxs.forEach(txId => {
          logger.info(`Restored micro-orphaned tx to mempool ${txId}`);
        });

        // Clear accepted microblock txs from the anchor-block update data to avoid duplicate inserts.
        batchedTxData = batchedTxData.filter(entry => {
          const matchingTx = acceptedMicroblockTxs.find(tx => tx.tx_id === entry.tx.tx_id);
          return !matchingTx;
        });
      }

      // TODO(mb): sanity tests on tx_index on batchedTxData, re-normalize if necessary

      // TODO(mb): copy the batchedTxData to outside the sql transaction fn so they can be emitted in txUpdate event below

      const blocksUpdated = await this.updateBlock(client, data.block);
      if (blocksUpdated !== 0) {
        for (const minerRewards of data.minerRewards) {
          await this.updateMinerReward(client, minerRewards);
        }
        for (const entry of batchedTxData) {
          await this.updateTx(client, entry.tx);
          await this.updateBatchStxEvents(client, entry.tx, entry.stxEvents);
          await this.updatePrincipalStxTxs(client, entry.tx, entry.stxEvents);
          await this.updateBatchSmartContractEvent(client, entry.tx, entry.contractLogEvents);
          for (const stxLockEvent of entry.stxLockEvents) {
            await this.updateStxLockEvent(client, entry.tx, stxLockEvent);
          }
          for (const ftEvent of entry.ftEvents) {
            await this.updateFtEvent(client, entry.tx, ftEvent);
          }
          for (const nftEvent of entry.nftEvents) {
            await this.updateNftEvent(client, entry.tx, nftEvent);
          }
          for (const smartContract of entry.smartContracts) {
            await this.updateSmartContract(client, entry.tx, smartContract);
          }
          for (const bnsName of entry.names) {
            await this.updateNames(client, entry.tx, bnsName);
          }
          for (const namespace of entry.namespaces) {
            await this.updateNamespaces(client, entry.tx, namespace);
          }
        }
        await this.refreshNftCustody(client, batchedTxData);
        await this.refreshMaterializedView(client, 'chain_tip');
        const deletedMempoolTxs = await this.deleteGarbageCollectedMempoolTxs(client);
        if (deletedMempoolTxs.deletedTxs.length > 0) {
          logger.verbose(`Garbage collected ${deletedMempoolTxs.deletedTxs.length} mempool txs`);
        }

        const tokenContractDeployments = data.txs
          .filter(entry => entry.tx.type_id === DbTxTypeId.SmartContract)
          .filter(entry => entry.tx.status === DbTxStatus.Success)
          .filter(entry => entry.smartContracts[0].abi && entry.smartContracts[0].abi !== 'null')
          .map(entry => {
            const smartContract = entry.smartContracts[0];
            const contractAbi: ClarityAbi = JSON.parse(smartContract.abi as string);
            const queueEntry: DbTokenMetadataQueueEntry = {
              queueId: -1,
              txId: entry.tx.tx_id,
              contractId: smartContract.contract_id,
              contractAbi: contractAbi,
              blockHeight: entry.tx.block_height,
              processed: false,
            };
            return queueEntry;
          })
          .filter(entry => isProcessableTokenMetadata(entry.contractAbi));
        for (const pendingQueueEntry of tokenContractDeployments) {
          const queueEntry = await this.updateTokenMetadataQueue(client, pendingQueueEntry);
          tokenMetadataQueueEntries.push(queueEntry);
        }
      }
    });

    // Skip sending `PgNotifier` updates altogether if we're in the genesis block since this block is the
    // event replay of the v1 blockchain.
    if ((data.block.block_height > 1 || !isProdEnv) && this.notifier) {
      await this.notifier.sendBlock({ blockHash: data.block.block_hash });
      for (const tx of data.txs) {
        await this.notifier.sendTx({ txId: tx.tx.tx_id });
      }
      await this.emitAddressTxUpdates(data.txs);
      for (const tokenMetadataQueueEntry of tokenMetadataQueueEntries) {
        await this.notifier.sendTokenMetadata({ queueId: tokenMetadataQueueEntry.queueId });
      }
    }
  }

  async updateMinerReward(client: ClientBase, minerReward: DbMinerReward): Promise<number> {
    const result = await client.query(
      `
      INSERT INTO miner_rewards(
        block_hash, index_block_hash, from_index_block_hash, mature_block_height, canonical, recipient, coinbase_amount, tx_fees_anchored, tx_fees_streamed_confirmed, tx_fees_streamed_produced
      ) values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      `,
      [
        hexToBuffer(minerReward.block_hash),
        hexToBuffer(minerReward.index_block_hash),
        hexToBuffer(minerReward.from_index_block_hash),
        minerReward.mature_block_height,
        minerReward.canonical,
        minerReward.recipient,
        minerReward.coinbase_amount,
        minerReward.tx_fees_anchored,
        minerReward.tx_fees_streamed_confirmed,
        minerReward.tx_fees_streamed_produced,
      ]
    );
    return result.rowCount;
  }

  async updateBlock(client: ClientBase, block: DbBlock): Promise<number> {
    const result = await client.query(
      `
      INSERT INTO blocks(
        block_hash, index_block_hash,
        parent_index_block_hash, parent_block_hash, parent_microblock_hash, parent_microblock_sequence,
        block_height, burn_block_time, burn_block_hash, burn_block_height, miner_txid, canonical,
        execution_cost_read_count, execution_cost_read_length, execution_cost_runtime,
        execution_cost_write_count, execution_cost_write_length
      ) values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
      ON CONFLICT (index_block_hash)
      DO NOTHING
      `,
      [
        hexToBuffer(block.block_hash),
        hexToBuffer(block.index_block_hash),
        hexToBuffer(block.parent_index_block_hash),
        hexToBuffer(block.parent_block_hash),
        hexToBuffer(block.parent_microblock_hash),
        block.parent_microblock_sequence,
        block.block_height,
        block.burn_block_time,
        hexToBuffer(block.burn_block_hash),
        block.burn_block_height,
        hexToBuffer(block.miner_txid),
        block.canonical,
        block.execution_cost_read_count,
        block.execution_cost_read_length,
        block.execution_cost_runtime,
        block.execution_cost_write_count,
        block.execution_cost_write_length,
      ]
    );
    return result.rowCount;
  }

  async updateBurnchainRewardSlotHolders({
    burnchainBlockHash,
    burnchainBlockHeight,
    slotHolders,
  }: {
    burnchainBlockHash: string;
    burnchainBlockHeight: number;
    slotHolders: DbRewardSlotHolder[];
  }): Promise<void> {
    await this.queryTx(async client => {
      const existingSlotHolders = await client.query<{
        address: string;
      }>(
        `
        UPDATE reward_slot_holders
        SET canonical = false
        WHERE canonical = true AND (burn_block_hash = $1 OR burn_block_height >= $2)
        RETURNING address
        `,
        [hexToBuffer(burnchainBlockHash), burnchainBlockHeight]
      );
      if (existingSlotHolders.rowCount > 0) {
        logger.warn(
          `Invalidated ${existingSlotHolders.rowCount} burnchain reward slot holders after fork detected at burnchain block ${burnchainBlockHash}`
        );
      }
      if (slotHolders.length === 0) {
        return;
      }
      const insertParams = this.generateParameterizedInsertString({
        rowCount: slotHolders.length,
        columnCount: 5,
      });
      const values: any[] = [];
      slotHolders.forEach(val => {
        values.push(
          val.canonical,
          hexToBuffer(val.burn_block_hash),
          val.burn_block_height,
          val.address,
          val.slot_index
        );
      });
      const result = await client.query(
        `
        INSERT INTO reward_slot_holders(
          canonical, burn_block_hash, burn_block_height, address, slot_index
        ) VALUES ${insertParams}
        `,
        values
      );
      if (result.rowCount !== slotHolders.length) {
        throw new Error(
          `Unexpected row count after inserting reward slot holders: ${result.rowCount} vs ${slotHolders.length}`
        );
      }
    });
  }

  async updateMicroblocks(data: DataStoreMicroblockUpdateData): Promise<void> {
    try {
      await this.updateMicroblocksInternal(data);
    } catch (error) {
      if (error instanceof MicroblockGapError) {
        // Log and ignore this error for now, see https://github.com/blockstack/stacks-blockchain/issues/2850
        // for more details.
        // In theory it would be possible for the API to cache out-of-order microblock data and use it to
        // restore data in this condition, but it would require several changes to sensitive re-org code,
        // as well as introduce a new kind of statefulness and responsibility to the API.
        logger.warn(error.message);
      } else {
        throw error;
      }
    }
  }

  async updateMicroblocksInternal(data: DataStoreMicroblockUpdateData): Promise<void> {
    await this.queryTx(async client => {
      // Sanity check: ensure incoming microblocks have a `parent_index_block_hash` that matches the API's
      // current known canonical chain tip. We assume this holds true so incoming microblock data is always
      // treated as being built off the current canonical anchor block.
      const chainTip = await this.getChainTip(client);
      const nonCanonicalMicroblock = data.microblocks.find(
        mb => mb.parent_index_block_hash !== chainTip.indexBlockHash
      );
      // Note: the stacks-node event emitter can send old microblocks that have already been processed by a previous anchor block.
      // Log warning and return, nothing to do.
      if (nonCanonicalMicroblock) {
        logger.info(
          `Failure in microblock ingestion, microblock ${nonCanonicalMicroblock.microblock_hash} ` +
            `points to parent index block hash ${nonCanonicalMicroblock.parent_index_block_hash} rather ` +
            `than the current canonical tip's index block hash ${chainTip.indexBlockHash}.`
        );
        return;
      }

      // The block height is just one after the current chain tip height
      const blockHeight = chainTip.blockHeight + 1;
      const dbMicroblocks = data.microblocks.map(mb => {
        const dbMicroBlock: DbMicroblock = {
          canonical: true,
          microblock_canonical: true,
          microblock_hash: mb.microblock_hash,
          microblock_sequence: mb.microblock_sequence,
          microblock_parent_hash: mb.microblock_parent_hash,
          parent_index_block_hash: mb.parent_index_block_hash,
          parent_burn_block_height: mb.parent_burn_block_height,
          parent_burn_block_hash: mb.parent_burn_block_hash,
          parent_burn_block_time: mb.parent_burn_block_time,
          block_height: blockHeight,
          parent_block_height: chainTip.blockHeight,
          parent_block_hash: chainTip.blockHash,
          index_block_hash: '', // Empty until microblock is confirmed in an anchor block
          block_hash: '', // Empty until microblock is confirmed in an anchor block
        };
        return dbMicroBlock;
      });

      const txs: DataStoreTxEventData[] = [];

      for (const entry of data.txs) {
        // Note: the properties block_hash and burn_block_time are empty here because the anchor block with that data doesn't yet exist.
        const dbTx: DbTx = {
          ...entry.tx,
          parent_block_hash: chainTip.blockHash,
          block_height: blockHeight,
        };

        // Set all the `block_height` properties for the related tx objects, since it wasn't known
        // when creating the objects using only the stacks-node message payload.
        txs.push({
          tx: dbTx,
          stxEvents: entry.stxEvents.map(e => ({ ...e, block_height: blockHeight })),
          contractLogEvents: entry.contractLogEvents.map(e => ({
            ...e,
            block_height: blockHeight,
          })),
          stxLockEvents: entry.stxLockEvents.map(e => ({ ...e, block_height: blockHeight })),
          ftEvents: entry.ftEvents.map(e => ({ ...e, block_height: blockHeight })),
          nftEvents: entry.nftEvents.map(e => ({ ...e, block_height: blockHeight })),
          smartContracts: entry.smartContracts.map(e => ({ ...e, block_height: blockHeight })),
          names: entry.names.map(e => ({ ...e, registered_at: blockHeight })),
          namespaces: entry.namespaces.map(e => ({ ...e, ready_block: blockHeight })),
        });
      }

      await this.insertMicroblockData(client, dbMicroblocks, txs);

      // Find any microblocks that have been orphaned by this latest microblock chain tip.
      // This function also checks that each microblock parent hash points to an existing microblock in the db.
      const currentMicroblockTip = dbMicroblocks[dbMicroblocks.length - 1];
      const unanchoredMicroblocksAtTip = await this.findUnanchoredMicroblocksAtChainTip(
        client,
        currentMicroblockTip.parent_index_block_hash,
        blockHeight,
        currentMicroblockTip
      );
      if ('microblockGap' in unanchoredMicroblocksAtTip) {
        // Throw in order to trigger a SQL tx rollback to undo and db writes so far, but catch, log, and ignore this specific error.
        throw new MicroblockGapError(
          `Gap in parent microblock stream for ${currentMicroblockTip.microblock_hash}, missing microblock ${unanchoredMicroblocksAtTip.missingMicroblockHash}, the oldest microblock ${unanchoredMicroblocksAtTip.oldestParentMicroblockHash} found in the chain has sequence ${unanchoredMicroblocksAtTip.oldestParentMicroblockSequence} rather than 0`
        );
      }
      const { orphanedMicroblocks } = unanchoredMicroblocksAtTip;
      if (orphanedMicroblocks.length > 0) {
        // Handle microblocks reorgs here, these _should_ only be micro-forks off the same same
        // unanchored chain tip, e.g. a leader orphaning it's own unconfirmed microblocks
        const microOrphanResult = await this.handleMicroReorg(client, {
          isCanonical: true,
          isMicroCanonical: false,
          indexBlockHash: '',
          blockHash: '',
          burnBlockTime: -1,
          microblocks: orphanedMicroblocks,
        });
        const microOrphanedTxs = microOrphanResult.updatedTxs;
        // Restore any micro-orphaned txs into the mempool
        const restoredMempoolTxs = await this.restoreMempoolTxs(
          client,
          microOrphanedTxs.map(tx => tx.tx_id)
        );
        restoredMempoolTxs.restoredTxs.forEach(txId => {
          logger.info(`Restored micro-orphaned tx to mempool ${txId}`);
        });
      }

      const candidateTxIds = data.txs.map(d => d.tx.tx_id);
      const removedTxsResult = await this.pruneMempoolTxs(client, candidateTxIds);
      if (removedTxsResult.removedTxs.length > 0) {
        logger.verbose(
          `Removed ${removedTxsResult.removedTxs.length} microblock-txs from mempool table during microblock ingestion`
        );
      }

      await this.refreshNftCustody(client, txs, true);
      await this.refreshMaterializedView(client, 'chain_tip');

      if (this.notifier) {
        for (const microblock of dbMicroblocks) {
          await this.notifier.sendMicroblock({ microblockHash: microblock.microblock_hash });
        }
        for (const tx of txs) {
          await this.notifier.sendTx({ txId: tx.tx.tx_id });
        }
        await this.emitAddressTxUpdates(txs);
      }
    });
  }

  async updateStxLockEvent(client: ClientBase, tx: DbTx, event: DbStxLockEvent) {
    await client.query(
      `
      INSERT INTO stx_lock_events(
        event_index, tx_id, tx_index, block_height, index_block_hash,
        parent_index_block_hash, microblock_hash, microblock_sequence, microblock_canonical,
        canonical, locked_amount, unlock_height, locked_address
      ) values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `,
      [
        event.event_index,
        hexToBuffer(event.tx_id),
        event.tx_index,
        event.block_height,
        hexToBuffer(tx.index_block_hash),
        hexToBuffer(tx.parent_index_block_hash),
        hexToBuffer(tx.microblock_hash),
        tx.microblock_sequence,
        tx.microblock_canonical,
        event.canonical,
        event.locked_amount,
        event.unlock_height,
        event.locked_address,
      ]
    );
  }

  async updateBatchStxEvents(client: ClientBase, tx: DbTx, events: DbStxEvent[]) {
    const batchSize = 500; // (matt) benchmark: 21283 per second (15 seconds)
    for (const eventBatch of batchIterate(events, batchSize)) {
      const columnCount = 14;
      const insertParams = this.generateParameterizedInsertString({
        rowCount: eventBatch.length,
        columnCount,
      });
      const values: any[] = [];
      for (const event of eventBatch) {
        values.push(
          event.event_index,
          hexToBuffer(event.tx_id),
          event.tx_index,
          event.block_height,
          hexToBuffer(tx.index_block_hash),
          hexToBuffer(tx.parent_index_block_hash),
          hexToBuffer(tx.microblock_hash),
          tx.microblock_sequence,
          tx.microblock_canonical,
          event.canonical,
          event.asset_event_type_id,
          event.sender,
          event.recipient,
          event.amount
        );
      }
      const insertQuery = `INSERT INTO stx_events(
        event_index, tx_id, tx_index, block_height, index_block_hash,
        parent_index_block_hash, microblock_hash, microblock_sequence, microblock_canonical,
        canonical, asset_event_type_id, sender, recipient, amount
      ) VALUES ${insertParams}`;
      const insertQueryName = `insert-batch-stx-events_${columnCount}x${eventBatch.length}`;
      const insertStxEventQuery: QueryConfig = {
        name: insertQueryName,
        text: insertQuery,
        values,
      };
      const res = await client.query(insertStxEventQuery);
      if (res.rowCount !== eventBatch.length) {
        throw new Error(`Expected ${eventBatch.length} inserts, got ${res.rowCount}`);
      }
    }
  }

  /**
   * Update the `principal_stx_tx` table with the latest `tx_id`s that resulted in a STX
   * transfer relevant to a principal (stx address or contract id).
   * @param client - DB client
   * @param tx - Transaction
   * @param events - Transaction STX events
   */
  async updatePrincipalStxTxs(client: ClientBase, tx: DbTx, events: DbStxEvent[]) {
    const txIdBuffer = hexToBuffer(tx.tx_id);
    const indexBlockHashBuffer = hexToBuffer(tx.index_block_hash);
    const microblockHashBuffer = hexToBuffer(tx.microblock_hash);
    const insertPrincipalStxTxs = async (principals: string[]) => {
      principals = [...new Set(principals)]; // Remove duplicates
      const columnCount = 9;
      const insertParams = this.generateParameterizedInsertString({
        rowCount: principals.length,
        columnCount,
      });
      const values: any[] = [];
      for (const principal of principals) {
        values.push(
          principal,
          txIdBuffer,
          tx.block_height,
          indexBlockHashBuffer,
          microblockHashBuffer,
          tx.microblock_sequence,
          tx.tx_index,
          tx.canonical,
          tx.microblock_canonical
        );
      }
      const insertQuery = `
        INSERT INTO principal_stx_txs
          (principal, tx_id,
            block_height, index_block_hash, microblock_hash, microblock_sequence, tx_index,
            canonical, microblock_canonical)
        VALUES ${insertParams}
        ON CONFLICT ON CONSTRAINT unique_principal_tx_id_index_block_hash_microblock_hash DO NOTHING`;
      const insertQueryName = `insert-batch-principal_stx_txs_${columnCount}x${principals.length}`;
      const insertQueryConfig: QueryConfig = {
        name: insertQueryName,
        text: insertQuery,
        values,
      };
      await client.query(insertQueryConfig);
    };
    // Insert tx data
    await insertPrincipalStxTxs(
      [
        tx.sender_address,
        tx.token_transfer_recipient_address,
        tx.contract_call_contract_id,
        tx.smart_contract_contract_id,
      ].filter((p): p is string => !!p) // Remove undefined
    );
    // Insert stx_event data
    const batchSize = 500;
    for (const eventBatch of batchIterate(events, batchSize)) {
      const principals: string[] = [];
      for (const event of eventBatch) {
        if (event.sender) principals.push(event.sender);
        if (event.recipient) principals.push(event.recipient);
      }
      await insertPrincipalStxTxs(principals);
    }
  }

  async updateBatchSubdomains(
    client: ClientBase,
    blockData: {
      index_block_hash: string;
      parent_index_block_hash: string;
      microblock_hash: string;
      microblock_sequence: number;
      microblock_canonical: boolean;
    },
    subdomains: DbBnsSubdomain[]
  ) {
    // bns insertion variables
    const columnCount = 18;
    const insertParams = this.generateParameterizedInsertString({
      rowCount: subdomains.length,
      columnCount,
    });
    const values: any[] = [];
    // zonefile insertion variables
    const zonefilesColumnCount = 2;
    const zonefileInsertParams = this.generateParameterizedInsertString({
      rowCount: subdomains.length,
      columnCount: zonefilesColumnCount,
    });
    const zonefileValues: string[] = [];
    for (const subdomain of subdomains) {
      let txIndex = subdomain.tx_index;
      if (txIndex === -1) {
        const txQuery = await client.query<{ tx_index: number }>(
          `
          SELECT tx_index from txs
          WHERE tx_id = $1 AND index_block_hash = $2 AND block_height = $3
          LIMIT 1
          `,
          [
            hexToBuffer(subdomain.tx_id),
            hexToBuffer(blockData.index_block_hash),
            subdomain.block_height,
          ]
        );
        if (txQuery.rowCount === 0) {
          logger.warn(`Could not find tx index for subdomain entry: ${JSON.stringify(subdomain)}`);
          txIndex = 0;
        } else {
          txIndex = txQuery.rows[0].tx_index;
        }
      }
      // preparing bns values for insertion
      values.push(
        subdomain.name,
        subdomain.namespace_id,
        subdomain.fully_qualified_subdomain,
        subdomain.owner,
        validateZonefileHash(subdomain.zonefile_hash),
        subdomain.parent_zonefile_hash,
        subdomain.parent_zonefile_index,
        subdomain.block_height,
        txIndex,
        subdomain.zonefile_offset,
        subdomain.resolver,
        subdomain.canonical,
        hexToBuffer(subdomain.tx_id),
        hexToBuffer(blockData.index_block_hash),
        hexToBuffer(blockData.parent_index_block_hash),
        hexToBuffer(blockData.microblock_hash),
        blockData.microblock_sequence,
        blockData.microblock_canonical
      );
      // preparing zonefile values for insertion
      zonefileValues.push(subdomain.zonefile, validateZonefileHash(subdomain.zonefile_hash));
    }
    // bns insertion query
    const insertQuery = `INSERT INTO subdomains (
        name, namespace_id, fully_qualified_subdomain, owner,
        zonefile_hash, parent_zonefile_hash, parent_zonefile_index, block_height, tx_index,
        zonefile_offset, resolver, canonical, tx_id,
        index_block_hash, parent_index_block_hash, microblock_hash, microblock_sequence, microblock_canonical
      ) VALUES ${insertParams}`;
    const insertQueryName = `insert-batch-subdomains_${columnCount}x${subdomains.length}`;
    const insertBnsSubdomainsEventQuery: QueryConfig = {
      name: insertQueryName,
      text: insertQuery,
      values,
    };
    // zonefile insertion query
    const zonefileInsertQuery = `INSERT INTO zonefiles (zonefile, zonefile_hash) VALUES ${zonefileInsertParams}`;
    const insertZonefileQueryName = `insert-batch-zonefiles_${columnCount}x${subdomains.length}`;
    const insertZonefilesEventQuery: QueryConfig = {
      name: insertZonefileQueryName,
      text: zonefileInsertQuery,
      values: zonefileValues,
    };
    try {
      // checking for bns insertion errors
      const bnsRes = await client.query(insertBnsSubdomainsEventQuery);
      if (bnsRes.rowCount !== subdomains.length) {
        throw new Error(`Expected ${subdomains.length} inserts, got ${bnsRes.rowCount} for BNS`);
      }
      // checking for zonefile insertion errors
      const zonefilesRes = await client.query(insertZonefilesEventQuery);
      if (zonefilesRes.rowCount !== subdomains.length) {
        throw new Error(
          `Expected ${subdomains.length} inserts, got ${zonefilesRes.rowCount} for zonefiles`
        );
      }
    } catch (e: any) {
      logError(`subdomain errors ${e.message}`, e);
      throw e;
    }
  }

  async resolveBnsSubdomains(
    blockData: {
      index_block_hash: string;
      parent_index_block_hash: string;
      microblock_hash: string;
      microblock_sequence: number;
      microblock_canonical: boolean;
    },
    data: DbBnsSubdomain[]
  ): Promise<void> {
    if (data.length == 0) return;
    await this.queryTx(async client => {
      await this.updateBatchSubdomains(client, blockData, data);
    });
  }

  async updateStxEvent(client: ClientBase, tx: DbTx, event: DbStxEvent) {
    const insertStxEventQuery: QueryConfig = {
      name: 'insert-stx-event',
      text: `
        INSERT INTO stx_events(
          event_index, tx_id, tx_index, block_height, index_block_hash,
          parent_index_block_hash, microblock_hash, microblock_sequence, microblock_canonical,
          canonical, asset_event_type_id, sender, recipient, amount
        ) values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      `,
      values: [
        event.event_index,
        hexToBuffer(event.tx_id),
        event.tx_index,
        event.block_height,
        hexToBuffer(tx.index_block_hash),
        hexToBuffer(tx.parent_index_block_hash),
        hexToBuffer(tx.microblock_hash),
        tx.microblock_sequence,
        tx.microblock_canonical,
        event.canonical,
        event.asset_event_type_id,
        event.sender,
        event.recipient,
        event.amount,
      ],
    };
    await client.query(insertStxEventQuery);
  }

  async updateFtEvent(client: ClientBase, tx: DbTx, event: DbFtEvent) {
    await client.query(
      `
      INSERT INTO ft_events(
        event_index, tx_id, tx_index, block_height, index_block_hash,
        parent_index_block_hash, microblock_hash, microblock_sequence, microblock_canonical,
        canonical, asset_event_type_id, sender, recipient, asset_identifier, amount
      ) values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      `,
      [
        event.event_index,
        hexToBuffer(event.tx_id),
        event.tx_index,
        event.block_height,
        hexToBuffer(tx.index_block_hash),
        hexToBuffer(tx.parent_index_block_hash),
        hexToBuffer(tx.microblock_hash),
        tx.microblock_sequence,
        tx.microblock_canonical,
        event.canonical,
        event.asset_event_type_id,
        event.sender,
        event.recipient,
        event.asset_identifier,
        event.amount,
      ]
    );
  }

  async updateNftEvent(client: ClientBase, tx: DbTx, event: DbNftEvent) {
    await client.query(
      `
      INSERT INTO nft_events(
        event_index, tx_id, tx_index, block_height, index_block_hash,
        parent_index_block_hash, microblock_hash, microblock_sequence, microblock_canonical,
        canonical, asset_event_type_id, sender, recipient, asset_identifier, value
      ) values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      `,
      [
        event.event_index,
        hexToBuffer(event.tx_id),
        event.tx_index,
        event.block_height,
        hexToBuffer(tx.index_block_hash),
        hexToBuffer(tx.parent_index_block_hash),
        hexToBuffer(tx.microblock_hash),
        tx.microblock_sequence,
        tx.microblock_canonical,
        event.canonical,
        event.asset_event_type_id,
        event.sender,
        event.recipient,
        event.asset_identifier,
        event.value,
      ]
    );
  }

  async updateBatchSmartContractEvent(
    client: ClientBase,
    tx: DbTx,
    events: DbSmartContractEvent[]
  ) {
    const batchSize = 500; // (matt) benchmark: 21283 per second (15 seconds)
    for (const eventBatch of batchIterate(events, batchSize)) {
      const columnCount = 13;
      const insertParams = this.generateParameterizedInsertString({
        rowCount: eventBatch.length,
        columnCount,
      });
      const values: any[] = [];
      for (const event of eventBatch) {
        values.push(
          event.event_index,
          hexToBuffer(event.tx_id),
          event.tx_index,
          event.block_height,
          hexToBuffer(tx.index_block_hash),
          hexToBuffer(tx.parent_index_block_hash),
          hexToBuffer(tx.microblock_hash),
          tx.microblock_sequence,
          tx.microblock_canonical,
          event.canonical,
          event.contract_identifier,
          event.topic,
          event.value
        );
      }
      const insertQueryText = `INSERT INTO contract_logs(
        event_index, tx_id, tx_index, block_height, index_block_hash,
        parent_index_block_hash, microblock_hash, microblock_sequence, microblock_canonical,
        canonical, contract_identifier, topic, value
      ) VALUES ${insertParams}`;
      const insertQueryName = `insert-batch-smart-contract-events_${columnCount}x${eventBatch.length}`;
      const insertQuery: QueryConfig = {
        name: insertQueryName,
        text: insertQueryText,
        values,
      };
      const res = await client.query(insertQuery);
      if (res.rowCount !== eventBatch.length) {
        throw new Error(`Expected ${eventBatch.length} inserts, got ${res.rowCount}`);
      }
    }
  }

  async updateSmartContractEvent(client: ClientBase, tx: DbTx, event: DbSmartContractEvent) {
    await client.query(
      `
      INSERT INTO contract_logs(
        event_index, tx_id, tx_index, block_height, index_block_hash,
        parent_index_block_hash, microblock_hash, microblock_sequence, microblock_canonical,
        canonical, contract_identifier, topic, value
      ) values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      `,
      [
        event.event_index,
        hexToBuffer(event.tx_id),
        event.tx_index,
        event.block_height,
        hexToBuffer(tx.index_block_hash),
        hexToBuffer(tx.parent_index_block_hash),
        hexToBuffer(tx.microblock_hash),
        tx.microblock_sequence,
        tx.microblock_canonical,
        event.canonical,
        event.contract_identifier,
        event.topic,
        event.value,
      ]
    );
  }

  async updateMicroCanonical(
    client: ClientBase,
    blockData: {
      isCanonical: boolean;
      blockHeight: number;
      blockHash: string;
      indexBlockHash: string;
      parentIndexBlockHash: string;
      parentMicroblockHash: string;
      parentMicroblockSequence: number;
      burnBlockTime: number;
    }
  ): Promise<{
    acceptedMicroblockTxs: DbTx[];
    orphanedMicroblockTxs: DbTx[];
    acceptedMicroblocks: string[];
    orphanedMicroblocks: string[];
  }> {
    // Find the parent microblock if this anchor block points to one. If not, perform a sanity check for expected block headers in this case:
    // > Anchored blocks that do not have parent microblock streams will have their parent microblock header hashes set to all 0's, and the parent microblock sequence number set to 0.
    let acceptedMicroblockTip: DbMicroblock | undefined;
    if (BigInt(blockData.parentMicroblockHash) === 0n) {
      if (blockData.parentMicroblockSequence !== 0) {
        throw new Error(
          `Anchor block has a parent microblock sequence of ${blockData.parentMicroblockSequence} but the microblock parent of ${blockData.parentMicroblockHash}.`
        );
      }
      acceptedMicroblockTip = undefined;
    } else {
      const microblockTipQuery = await client.query<MicroblockQueryResult>(
        `
        SELECT ${MICROBLOCK_COLUMNS} FROM microblocks
        WHERE parent_index_block_hash = $1 AND microblock_hash = $2
        `,
        [hexToBuffer(blockData.parentIndexBlockHash), hexToBuffer(blockData.parentMicroblockHash)]
      );
      if (microblockTipQuery.rowCount === 0) {
        throw new Error(
          `Could not find microblock ${blockData.parentMicroblockHash} while processing anchor block chain tip`
        );
      }
      acceptedMicroblockTip = parseMicroblockQueryResult(microblockTipQuery.rows[0]);
    }

    // Identify microblocks that were either accepted or orphaned by this anchor block.
    const unanchoredMicroblocksAtTip = await this.findUnanchoredMicroblocksAtChainTip(
      client,
      blockData.parentIndexBlockHash,
      blockData.blockHeight,
      acceptedMicroblockTip
    );
    if ('microblockGap' in unanchoredMicroblocksAtTip) {
      throw new Error(
        `Gap in parent microblock stream for block ${blockData.blockHash}, missing microblock ${unanchoredMicroblocksAtTip.missingMicroblockHash}, the oldest microblock ${unanchoredMicroblocksAtTip.oldestParentMicroblockHash} found in the chain has sequence ${unanchoredMicroblocksAtTip.oldestParentMicroblockSequence} rather than 0`
      );
    }

    const { acceptedMicroblocks, orphanedMicroblocks } = unanchoredMicroblocksAtTip;

    let orphanedMicroblockTxs: DbTx[] = [];
    if (orphanedMicroblocks.length > 0) {
      const microOrphanResult = await this.handleMicroReorg(client, {
        isCanonical: blockData.isCanonical,
        isMicroCanonical: false,
        indexBlockHash: blockData.indexBlockHash,
        blockHash: blockData.blockHash,
        burnBlockTime: blockData.burnBlockTime,
        microblocks: orphanedMicroblocks,
      });
      orphanedMicroblockTxs = microOrphanResult.updatedTxs;
    }
    let acceptedMicroblockTxs: DbTx[] = [];
    if (acceptedMicroblocks.length > 0) {
      const microAcceptResult = await this.handleMicroReorg(client, {
        isCanonical: blockData.isCanonical,
        isMicroCanonical: true,
        indexBlockHash: blockData.indexBlockHash,
        blockHash: blockData.blockHash,
        burnBlockTime: blockData.burnBlockTime,
        microblocks: acceptedMicroblocks,
      });
      acceptedMicroblockTxs = microAcceptResult.updatedTxs;
    }

    return {
      acceptedMicroblockTxs,
      orphanedMicroblockTxs,
      acceptedMicroblocks,
      orphanedMicroblocks,
    };
  }

  async updateZoneContent(zonefile: string, zonefile_hash: string, tx_id: string): Promise<void> {
    await this.queryTx(async client => {
      // inserting zonefile into zonefiles table
      const validZonefileHash = validateZonefileHash(zonefile_hash);
      await client.query(
        `
        UPDATE zonefiles
        SET zonefile = $1
        WHERE zonefile_hash = $2
        `,
        [zonefile, validZonefileHash]
      );
    });
    await this.notifier?.sendName({ nameInfo: tx_id });
  }

  async updateBurnchainRewards({
    burnchainBlockHash,
    burnchainBlockHeight,
    rewards,
  }: {
    burnchainBlockHash: string;
    burnchainBlockHeight: number;
    rewards: DbBurnchainReward[];
  }): Promise<void> {
    return this.queryTx(async client => {
      const existingRewards = await client.query<{
        reward_recipient: string;
        reward_amount: string;
      }>(
        `
        UPDATE burnchain_rewards
        SET canonical = false
        WHERE canonical = true AND (burn_block_hash = $1 OR burn_block_height >= $2)
        RETURNING reward_recipient, reward_amount
        `,
        [hexToBuffer(burnchainBlockHash), burnchainBlockHeight]
      );
      if (existingRewards.rowCount > 0) {
        logger.warn(
          `Invalidated ${existingRewards.rowCount} burnchain rewards after fork detected at burnchain block ${burnchainBlockHash}`
        );
      }

      for (const reward of rewards) {
        const rewardInsertResult = await client.query(
          `
          INSERT into burnchain_rewards(
            canonical, burn_block_hash, burn_block_height, burn_amount, reward_recipient, reward_amount, reward_index
          ) values($1, $2, $3, $4, $5, $6, $7)
          `,
          [
            true,
            hexToBuffer(reward.burn_block_hash),
            reward.burn_block_height,
            reward.burn_amount,
            reward.reward_recipient,
            reward.reward_amount,
            reward.reward_index,
          ]
        );
        if (rewardInsertResult.rowCount !== 1) {
          throw new Error(`Failed to insert burnchain reward at block ${reward.burn_block_hash}`);
        }
      }
    });
  }

  async updateTx(client: ClientBase, tx: DbTx): Promise<number> {
    const result = await client.query(
      `
      INSERT INTO txs(
        ${TX_COLUMNS}
      ) values(
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
        $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37,
        $38, $39, $40, $41, $42, $43
      )
      ON CONFLICT ON CONSTRAINT unique_tx_id_index_block_hash_microblock_hash DO NOTHING
      `,
      [
        hexToBuffer(tx.tx_id),
        tx.raw_tx,
        tx.tx_index,
        hexToBuffer(tx.index_block_hash),
        hexToBuffer(tx.parent_index_block_hash),
        hexToBuffer(tx.block_hash),
        hexToBuffer(tx.parent_block_hash),
        tx.block_height,
        tx.burn_block_time,
        tx.parent_burn_block_time,
        tx.type_id,
        tx.anchor_mode,
        tx.status,
        tx.canonical,
        tx.post_conditions,
        tx.nonce,
        tx.fee_rate,
        tx.sponsored,
        tx.sponsor_nonce,
        tx.sponsor_address,
        tx.sender_address,
        tx.origin_hash_mode,
        tx.microblock_canonical,
        tx.microblock_sequence,
        hexToBuffer(tx.microblock_hash),
        tx.token_transfer_recipient_address,
        tx.token_transfer_amount,
        tx.token_transfer_memo,
        tx.smart_contract_contract_id,
        tx.smart_contract_source_code,
        tx.contract_call_contract_id,
        tx.contract_call_function_name,
        tx.contract_call_function_args,
        tx.poison_microblock_header_1,
        tx.poison_microblock_header_2,
        tx.coinbase_payload,
        hexToBuffer(tx.raw_result),
        tx.event_count,
        tx.execution_cost_read_count,
        tx.execution_cost_read_length,
        tx.execution_cost_runtime,
        tx.execution_cost_write_count,
        tx.execution_cost_write_length,
      ]
    );
    return result.rowCount;
  }

  async updateMempoolTxs({ mempoolTxs: txs }: { mempoolTxs: DbMempoolTx[] }): Promise<void> {
    const updatedTxs: DbMempoolTx[] = [];
    await this.queryTx(async client => {
      const chainTip = await this.getChainTip(client);
      for (const tx of txs) {
        const result = await client.query(
          `
          INSERT INTO mempool_txs(
            ${MEMPOOL_TX_COLUMNS}
          ) values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27)
          ON CONFLICT ON CONSTRAINT unique_tx_id
          DO NOTHING
          `,
          [
            tx.pruned,
            hexToBuffer(tx.tx_id),
            tx.raw_tx,
            tx.type_id,
            tx.anchor_mode,
            tx.status,
            tx.receipt_time,
            chainTip.blockHeight,
            tx.post_conditions,
            tx.nonce,
            tx.fee_rate,
            tx.sponsored,
            tx.sponsor_nonce,
            tx.sponsor_address,
            tx.sender_address,
            tx.origin_hash_mode,
            tx.token_transfer_recipient_address,
            tx.token_transfer_amount,
            tx.token_transfer_memo,
            tx.smart_contract_contract_id,
            tx.smart_contract_source_code,
            tx.contract_call_contract_id,
            tx.contract_call_function_name,
            tx.contract_call_function_args,
            tx.poison_microblock_header_1,
            tx.poison_microblock_header_2,
            tx.coinbase_payload,
          ]
        );
        if (result.rowCount !== 1) {
          const errMsg = `A duplicate transaction was attempted to be inserted into the mempool_txs table: ${tx.tx_id}`;
          logger.warn(errMsg);
        } else {
          updatedTxs.push(tx);
        }
      }
      await this.refreshMaterializedView(client, 'mempool_digest');
    });
    for (const tx of updatedTxs) {
      await this.notifier?.sendTx({ txId: tx.tx_id });
    }
  }

  async dropMempoolTxs({ status, txIds }: { status: DbTxStatus; txIds: string[] }): Promise<void> {
    let updatedTxs: DbMempoolTx[] = [];
    await this.queryTx(async client => {
      const txIdBuffers = txIds.map(txId => hexToBuffer(txId));
      const updateResults = await client.query<MempoolTxQueryResult>(
        `
        UPDATE mempool_txs
        SET pruned = true, status = $2
        WHERE tx_id = ANY($1)
        RETURNING ${MEMPOOL_TX_COLUMNS}
        `,
        [txIdBuffers, status]
      );
      updatedTxs = updateResults.rows.map(r => parseMempoolTxQueryResult(r));
      await this.refreshMaterializedView(client, 'mempool_digest');
    });
    for (const tx of updatedTxs) {
      await this.notifier?.sendTx({ txId: tx.tx_id });
    }
  }

  async updateTokenMetadataQueue(
    client: ClientBase,
    entry: DbTokenMetadataQueueEntry
  ): Promise<DbTokenMetadataQueueEntry> {
    const queryResult = await client.query<{ queue_id: number }>(
      `
      INSERT INTO token_metadata_queue(
        tx_id, contract_id, contract_abi, block_height, processed
      ) values($1, $2, $3, $4, $5)
      RETURNING queue_id
      `,
      [
        hexToBuffer(entry.txId),
        entry.contractId,
        JSON.stringify(entry.contractAbi),
        entry.blockHeight,
        false,
      ]
    );
    const result: DbTokenMetadataQueueEntry = {
      ...entry,
      queueId: queryResult.rows[0].queue_id,
    };
    return result;
  }

  async updateSmartContract(client: ClientBase, tx: DbTx, smartContract: DbSmartContract) {
    await client.query(
      `
      INSERT INTO smart_contracts(
        tx_id, canonical, contract_id, block_height, index_block_hash, source_code, abi,
        parent_index_block_hash, microblock_hash, microblock_sequence, microblock_canonical
      ) values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
      [
        hexToBuffer(smartContract.tx_id),
        smartContract.canonical,
        smartContract.contract_id,
        smartContract.block_height,
        hexToBuffer(tx.index_block_hash),
        smartContract.source_code,
        smartContract.abi,
        hexToBuffer(tx.parent_index_block_hash),
        hexToBuffer(tx.microblock_hash),
        tx.microblock_sequence,
        tx.microblock_canonical,
      ]
    );
  }

  async updateNames(
    client: ClientBase,
    blockData: {
      index_block_hash: string;
      parent_index_block_hash: string;
      microblock_hash: string;
      microblock_sequence: number;
      microblock_canonical: boolean;
    },
    bnsName: DbBnsName
  ) {
    const {
      name,
      address,
      registered_at,
      expire_block,
      zonefile,
      zonefile_hash,
      namespace_id,
      tx_id,
      tx_index,
      status,
      canonical,
    } = bnsName;
    // inserting remaining names information in names table
    const validZonefileHash = validateZonefileHash(zonefile_hash);
    await client.query(
      `
        INSERT INTO zonefiles (zonefile, zonefile_hash)
        VALUES ($1, $2)
        `,
      [zonefile, validZonefileHash]
    );
    await client.query(
      `
        INSERT INTO names(
          name, address, registered_at, expire_block, zonefile_hash, namespace_id,
          tx_index, tx_id, status, canonical,
          index_block_hash, parent_index_block_hash, microblock_hash, microblock_sequence, microblock_canonical
        ) values($1, $2, $3, $4, $5, $6, $7, $8,$9, $10, $11, $12, $13, $14, $15)
        `,
      [
        name,
        address,
        registered_at,
        expire_block,
        validZonefileHash,
        namespace_id,
        tx_index,
        hexToBuffer(tx_id),
        status,
        canonical,
        hexToBuffer(blockData.index_block_hash),
        hexToBuffer(blockData.parent_index_block_hash),
        hexToBuffer(blockData.microblock_hash),
        blockData.microblock_sequence,
        blockData.microblock_canonical,
      ]
    );
  }

  async updateNamespaces(
    client: ClientBase,
    blockData: {
      index_block_hash: string;
      parent_index_block_hash: string;
      microblock_hash: string;
      microblock_sequence: number;
      microblock_canonical: boolean;
    },
    bnsNamespace: DbBnsNamespace
  ) {
    const {
      namespace_id,
      launched_at,
      address,
      reveal_block,
      ready_block,
      buckets,
      base,
      coeff,
      nonalpha_discount,
      no_vowel_discount,
      lifetime,
      status,
      tx_id,
      tx_index,
      canonical,
    } = bnsNamespace;

    await client.query(
      `
      INSERT INTO namespaces(
        namespace_id, launched_at, address, reveal_block, ready_block, buckets,
        base,coeff, nonalpha_discount,no_vowel_discount, lifetime, status, tx_index,
        tx_id, canonical,
        index_block_hash, parent_index_block_hash, microblock_hash, microblock_sequence, microblock_canonical
      ) values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
      `,
      [
        namespace_id,
        launched_at,
        address,
        reveal_block,
        ready_block,
        buckets,
        base,
        coeff,
        nonalpha_discount,
        no_vowel_discount,
        lifetime,
        status,
        tx_index,
        hexToBuffer(tx_id ?? ''),
        canonical,
        hexToBuffer(blockData.index_block_hash),
        hexToBuffer(blockData.parent_index_block_hash),
        hexToBuffer(blockData.microblock_hash),
        blockData.microblock_sequence,
        blockData.microblock_canonical,
      ]
    );
  }

  async updateFtMetadata(ftMetadata: DbFungibleTokenMetadata, dbQueueId: number): Promise<number> {
    const {
      token_uri,
      name,
      description,
      image_uri,
      image_canonical_uri,
      contract_id,
      symbol,
      decimals,
      tx_id,
      sender_address,
    } = ftMetadata;

    const rowCount = await this.queryTx(async client => {
      const result = await client.query(
        `
        INSERT INTO ft_metadata(
          token_uri, name, description, image_uri, image_canonical_uri, contract_id, symbol, decimals, tx_id, sender_address
        ) values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          token_uri,
          name,
          description,
          image_uri,
          image_canonical_uri,
          contract_id,
          symbol,
          decimals,
          hexToBuffer(tx_id),
          sender_address,
        ]
      );
      await client.query(
        `
        UPDATE token_metadata_queue
        SET processed = true
        WHERE queue_id = $1
        `,
        [dbQueueId]
      );
      return result.rowCount;
    });
    await this.notifier?.sendTokens({ contractID: contract_id });
    return rowCount;
  }

  async updateNFtMetadata(
    nftMetadata: DbNonFungibleTokenMetadata,
    dbQueueId: number
  ): Promise<number> {
    const {
      token_uri,
      name,
      description,
      image_uri,
      image_canonical_uri,
      contract_id,
      tx_id,
      sender_address,
    } = nftMetadata;
    const rowCount = await this.queryTx(async client => {
      const result = await client.query(
        `
        INSERT INTO nft_metadata(
          token_uri, name, description, image_uri, image_canonical_uri, contract_id, tx_id, sender_address
        ) values($1, $2, $3, $4, $5, $6, $7, $8)
        `,
        [
          token_uri,
          name,
          description,
          image_uri,
          image_canonical_uri,
          contract_id,
          hexToBuffer(tx_id),
          sender_address,
        ]
      );
      await client.query(
        `
        UPDATE token_metadata_queue
        SET processed = true
        WHERE queue_id = $1
        `,
        [dbQueueId]
      );
      return result.rowCount;
    });
    await this.notifier?.sendTokens({ contractID: contract_id });
    return rowCount;
  }

  async updateBatchTokenOfferingLocked(client: ClientBase, lockedInfos: DbTokenOfferingLocked[]) {
    const columnCount = 3;
    const insertParams = this.generateParameterizedInsertString({
      rowCount: lockedInfos.length,
      columnCount,
    });
    const values: any[] = [];
    for (const lockedInfo of lockedInfos) {
      values.push(lockedInfo.address, lockedInfo.value, lockedInfo.block);
    }
    const insertQuery = `INSERT INTO token_offering_locked (
      address, value, block
      ) VALUES ${insertParams}`;
    const insertQueryName = `insert-batch-token-offering-locked_${columnCount}x${lockedInfos.length}`;
    const insertLockedInfosQuery: QueryConfig = {
      name: insertQueryName,
      text: insertQuery,
      values,
    };
    try {
      const res = await client.query(insertLockedInfosQuery);
      if (res.rowCount !== lockedInfos.length) {
        throw new Error(`Expected ${lockedInfos.length} inserts, got ${res.rowCount}`);
      }
    } catch (e: any) {
      logError(`Locked Info errors ${e.message}`, e);
      throw e;
    }
  }

  async getConfigState(): Promise<DbConfigState> {
    const queryResult = await this.sql.query(`SELECT * FROM config_state`);
    const result: DbConfigState = {
      bns_names_onchain_imported: queryResult.rows[0].bns_names_onchain_imported,
      bns_subdomains_imported: queryResult.rows[0].bns_subdomains_imported,
      token_offering_imported: queryResult.rows[0].token_offering_imported,
    };
    return result;
  }

  async updateConfigState(configState: DbConfigState, client?: ClientBase): Promise<void> {
    const queryResult = await (client ?? this.sql).query(
      `
      UPDATE config_state SET
      bns_names_onchain_imported = $1,
      bns_subdomains_imported = $2,
      token_offering_imported = $3
      `,
      [
        configState.bns_names_onchain_imported,
        configState.bns_subdomains_imported,
        configState.token_offering_imported,
      ]
    );
    if (queryResult.rowCount !== 1) {
      throw new Error(`Unexpected config update row count: ${queryResult.rowCount}`);
    }
  }

  async emitAddressTxUpdates(txs: DataStoreTxEventData[]) {
    // Record all addresses that had an associated tx.
    const addressTxUpdates = new Map<string, number>();
    for (const entry of txs) {
      const tx = entry.tx;
      const addAddressTx = (addr: string | undefined) => {
        if (addr) {
          getOrAdd(addressTxUpdates, addr, () => tx.block_height);
        }
      };
      addAddressTx(tx.sender_address);
      entry.stxLockEvents.forEach(event => {
        addAddressTx(event.locked_address);
      });
      entry.stxEvents.forEach(event => {
        addAddressTx(event.sender);
        addAddressTx(event.recipient);
      });
      entry.ftEvents.forEach(event => {
        addAddressTx(event.sender);
        addAddressTx(event.recipient);
      });
      entry.nftEvents.forEach(event => {
        addAddressTx(event.sender);
        addAddressTx(event.recipient);
      });
      entry.smartContracts.forEach(event => {
        addAddressTx(event.contract_id);
      });
      switch (tx.type_id) {
        case DbTxTypeId.ContractCall:
          addAddressTx(tx.contract_call_contract_id);
          break;
        case DbTxTypeId.SmartContract:
          addAddressTx(tx.smart_contract_contract_id);
          break;
        case DbTxTypeId.TokenTransfer:
          addAddressTx(tx.token_transfer_recipient_address);
          break;
      }
    }
    for (const [address, blockHeight] of addressTxUpdates) {
      await this.notifier?.sendAddress({
        address: address,
        blockHeight: blockHeight,
      });
    }
  }

  async insertFaucetRequest(faucetRequest: DbFaucetRequest) {
    await this.query(async client => {
      try {
        await client.query(
          `
          INSERT INTO faucet_requests(
            currency, address, ip, occurred_at
          ) values($1, $2, $3, $4)
          `,
          [
            faucetRequest.currency,
            faucetRequest.address,
            faucetRequest.ip,
            faucetRequest.occurred_at,
          ]
        );
      } catch (error) {
        logError(`Error performing faucet request update: ${error}`, error);
        throw error;
      }
    });
  }

  async insertMicroblockData(
    client: ClientBase,
    microblocks: DbMicroblock[],
    txs: DataStoreTxEventData[]
  ): Promise<void> {
    for (const mb of microblocks) {
      const mbResult = await client.query(
        `
        INSERT INTO microblocks(
          canonical, microblock_canonical, microblock_hash, microblock_sequence, microblock_parent_hash,
          parent_index_block_hash, block_height, parent_block_height, parent_block_hash, index_block_hash, block_hash,
          parent_burn_block_height, parent_burn_block_hash, parent_burn_block_time
        ) values($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT ON CONSTRAINT unique_microblock_hash DO NOTHING
        `,
        [
          mb.canonical,
          mb.microblock_canonical,
          hexToBuffer(mb.microblock_hash),
          mb.microblock_sequence,
          hexToBuffer(mb.microblock_parent_hash),
          hexToBuffer(mb.parent_index_block_hash),
          mb.block_height,
          mb.parent_block_height,
          hexToBuffer(mb.parent_block_hash),
          hexToBuffer(mb.index_block_hash),
          hexToBuffer(mb.block_hash),
          mb.parent_burn_block_height,
          hexToBuffer(mb.parent_burn_block_hash),
          mb.parent_burn_block_time,
        ]
      );
      if (mbResult.rowCount !== 1) {
        const errMsg = `A duplicate microblock was attempted to be inserted into the microblocks table: ${mb.microblock_hash}`;
        logger.warn(errMsg);
        // A duplicate microblock entry really means we received a duplicate `/new_microblocks` node event.
        // We will ignore this whole microblock data entry in this case.
        return;
      }
    }

    for (const entry of txs) {
      const rowsUpdated = await this.updateTx(client, entry.tx);
      if (rowsUpdated !== 1) {
        throw new Error(
          `Unexpected amount of rows updated for microblock tx insert: ${rowsUpdated}`
        );
      }

      await this.updateBatchStxEvents(client, entry.tx, entry.stxEvents);
      await this.updatePrincipalStxTxs(client, entry.tx, entry.stxEvents);
      await this.updateBatchSmartContractEvent(client, entry.tx, entry.contractLogEvents);
      for (const stxLockEvent of entry.stxLockEvents) {
        await this.updateStxLockEvent(client, entry.tx, stxLockEvent);
      }
      for (const ftEvent of entry.ftEvents) {
        await this.updateFtEvent(client, entry.tx, ftEvent);
      }
      for (const nftEvent of entry.nftEvents) {
        await this.updateNftEvent(client, entry.tx, nftEvent);
      }
      for (const smartContract of entry.smartContracts) {
        await this.updateSmartContract(client, entry.tx, smartContract);
      }
      for (const bnsName of entry.names) {
        await this.updateNames(client, entry.tx, bnsName);
      }
      for (const namespace of entry.namespaces) {
        await this.updateNamespaces(client, entry.tx, namespace);
      }
    }
  }

  async handleMicroReorg(
    client: ClientBase,
    args: {
      isCanonical: boolean;
      isMicroCanonical: boolean;
      indexBlockHash: string;
      blockHash: string;
      burnBlockTime: number;
      microblocks: string[];
    }
  ): Promise<{ updatedTxs: DbTx[] }> {
    const bufIndexBlockHash = hexToBuffer(args.indexBlockHash);
    const bufBlockHash = hexToBuffer(args.blockHash);
    const bufMicroblockHashes = args.microblocks.map(mb => hexToBuffer(mb));

    // Flag orphaned microblock rows as `microblock_canonical=false`
    const updatedMicroblocksQuery = await client.query(
      `
      UPDATE microblocks
      SET microblock_canonical = $1, canonical = $2, index_block_hash = $3, block_hash = $4
      WHERE microblock_hash = ANY($5)
      `,
      [
        args.isMicroCanonical,
        args.isCanonical,
        bufIndexBlockHash,
        bufBlockHash,
        bufMicroblockHashes,
      ]
    );
    if (updatedMicroblocksQuery.rowCount !== args.microblocks.length) {
      throw new Error(`Unexpected number of rows updated when setting microblock_canonical`);
    }

    // Identify microblock transactions that were orphaned or accepted by this anchor block,
    // and update `microblock_canonical`, `canonical`, as well as anchor block data that may be missing
    // for unanchored entires.
    const updatedMbTxsQuery = await client.query<TxQueryResult>(
      `
      UPDATE txs
      SET microblock_canonical = $1, canonical = $2, index_block_hash = $3, block_hash = $4, burn_block_time = $5
      WHERE microblock_hash = ANY($6)
      AND (index_block_hash = $3 OR index_block_hash = '\\x'::bytea)
      RETURNING ${TX_COLUMNS}
      `,
      [
        args.isMicroCanonical,
        args.isCanonical,
        bufIndexBlockHash,
        bufBlockHash,
        args.burnBlockTime,
        bufMicroblockHashes,
      ]
    );
    // Any txs restored need to be pruned from the mempool
    const updatedMbTxs = updatedMbTxsQuery.rows.map(r => parseTxQueryResult(r));
    const txsToPrune = updatedMbTxs
      .filter(tx => tx.canonical && tx.microblock_canonical)
      .map(tx => tx.tx_id);
    const removedTxsResult = await this.pruneMempoolTxs(client, txsToPrune);
    if (removedTxsResult.removedTxs.length > 0) {
      logger.verbose(
        `Removed ${removedTxsResult.removedTxs.length} txs from mempool table during micro-reorg handling`
      );
    }

    // Update the `index_block_hash` and `microblock_canonical` properties on all the tables containing other
    // microblock-tx metadata that have been accepted or orphaned in this anchor block.
    const updatedAssociatedTableParams = [
      args.isMicroCanonical,
      args.isCanonical,
      bufIndexBlockHash,
      bufMicroblockHashes,
      updatedMbTxs.map(tx => hexToBuffer(tx.tx_id)),
    ];
    for (const associatedTableName of TX_METADATA_TABLES) {
      await client.query(
        `
        UPDATE ${associatedTableName}
        SET microblock_canonical = $1, canonical = $2, index_block_hash = $3
        WHERE microblock_hash = ANY($4)
        AND (index_block_hash = $3 OR index_block_hash = '\\x'::bytea)
        AND tx_id = ANY($5)
        `,
        updatedAssociatedTableParams
      );
    }

    // Update `principal_stx_txs`
    await client.query(
      `UPDATE principal_stx_txs
      SET microblock_canonical = $1, canonical = $2, index_block_hash = $3
      WHERE microblock_hash = ANY($4)
      AND (index_block_hash = $3 OR index_block_hash = '\\x'::bytea)
      AND tx_id = ANY($5)`,
      updatedAssociatedTableParams
    );

    return { updatedTxs: updatedMbTxs };
  }

  /**
   * Fetches from the `microblocks` table with a given `parent_index_block_hash` and a known
   * latest unanchored microblock tip. Microblocks that are chained to the given tip are
   * returned as accepted, and all others are returned as orphaned/rejected. This function
   * only performs the lookup, it does not perform any updates to the db.
   * If a gap in the microblock stream is detected, that error information is returned instead.
   * @param microblockChainTip - undefined if processing an anchor block that doesn't point to a parent microblock.
   */
  async findUnanchoredMicroblocksAtChainTip(
    client: ClientBase,
    parentIndexBlockHash: string,
    blockHeight: number,
    microblockChainTip: DbMicroblock | undefined
  ): Promise<
    | { acceptedMicroblocks: string[]; orphanedMicroblocks: string[] }
    | {
        microblockGap: true;
        missingMicroblockHash: string;
        oldestParentMicroblockHash: string;
        oldestParentMicroblockSequence: number;
      }
  > {
    // Get any microblocks that this anchor block is responsible for accepting or rejecting.
    // Note: we don't filter on `microblock_canonical=true` here because that could have been flipped in a previous anchor block
    // which could now be in the process of being re-org'd.
    const mbQuery = await client.query<MicroblockQueryResult>(
      `
      SELECT ${MICROBLOCK_COLUMNS}
      FROM microblocks
      WHERE (parent_index_block_hash = $1 OR block_height = $2)
      `,
      [hexToBuffer(parentIndexBlockHash), blockHeight]
    );
    const candidateMicroblocks = mbQuery.rows.map(row => parseMicroblockQueryResult(row));

    // Accepted/orphaned status needs to be determined by walking through the microblock hash chain rather than a simple sequence number comparison,
    // because we can't depend on a `microblock_canonical=true` filter in the above query, so there could be microblocks with the same sequence number
    // if a leader has self-orphaned its own microblocks.
    let prevMicroblock: DbMicroblock | undefined = microblockChainTip;
    const acceptedMicroblocks = new Set<string>();
    const orphanedMicroblocks = new Set<string>();
    while (prevMicroblock) {
      acceptedMicroblocks.add(prevMicroblock.microblock_hash);
      const foundMb = candidateMicroblocks.find(
        mb => mb.microblock_hash === prevMicroblock?.microblock_parent_hash
      );
      // Sanity check that the first microblock in the chain is sequence 0
      if (!foundMb && prevMicroblock.microblock_sequence !== 0) {
        return {
          microblockGap: true,
          missingMicroblockHash: prevMicroblock?.microblock_parent_hash,
          oldestParentMicroblockHash: prevMicroblock.microblock_hash,
          oldestParentMicroblockSequence: prevMicroblock.microblock_sequence,
        };
      }
      prevMicroblock = foundMb;
    }
    candidateMicroblocks.forEach(mb => {
      if (!acceptedMicroblocks.has(mb.microblock_hash)) {
        orphanedMicroblocks.add(mb.microblock_hash);
      }
    });
    return {
      acceptedMicroblocks: [...acceptedMicroblocks],
      orphanedMicroblocks: [...orphanedMicroblocks],
    };
  }

  /**
   * Restore transactions in the mempool table. This should be called when mined transactions are
   * marked from canonical to non-canonical.
   * @param txIds - List of transactions to update in the mempool
   */
  async restoreMempoolTxs(client: ClientBase, txIds: string[]): Promise<{ restoredTxs: string[] }> {
    if (txIds.length === 0) {
      // Avoid an unnecessary query.
      return { restoredTxs: [] };
    }
    for (const txId of txIds) {
      logger.verbose(`Restoring mempool tx: ${txId}`);
    }
    const txIdBuffers = txIds.map(txId => hexToBuffer(txId));
    const updateResults = await client.query<{ tx_id: Buffer }>(
      `
      UPDATE mempool_txs
      SET pruned = false
      WHERE tx_id = ANY($1)
      RETURNING tx_id
      `,
      [txIdBuffers]
    );
    await this.refreshMaterializedView(client, 'mempool_digest');
    const restoredTxs = updateResults.rows.map(r => bufferToHexPrefixString(r.tx_id));
    return { restoredTxs: restoredTxs };
  }

  /**
   * Remove transactions in the mempool table. This should be called when transactions are
   * mined into a block.
   * @param txIds - List of transactions to update in the mempool
   */
  async pruneMempoolTxs(client: ClientBase, txIds: string[]): Promise<{ removedTxs: string[] }> {
    if (txIds.length === 0) {
      // Avoid an unnecessary query.
      return { removedTxs: [] };
    }
    for (const txId of txIds) {
      logger.verbose(`Pruning mempool tx: ${txId}`);
    }
    const txIdBuffers = txIds.map(txId => hexToBuffer(txId));
    const updateResults = await client.query<{ tx_id: Buffer }>(
      `
      UPDATE mempool_txs
      SET pruned = true
      WHERE tx_id = ANY($1)
      RETURNING tx_id
      `,
      [txIdBuffers]
    );
    await this.refreshMaterializedView(client, 'mempool_digest');
    const removedTxs = updateResults.rows.map(r => bufferToHexPrefixString(r.tx_id));
    return { removedTxs: removedTxs };
  }

  /**
   * Deletes mempool txs older than `STACKS_MEMPOOL_TX_GARBAGE_COLLECTION_THRESHOLD` blocks (default 256).
   * @param client - DB client
   * @returns List of deleted `tx_id`s
   */
  async deleteGarbageCollectedMempoolTxs(client: ClientBase): Promise<{ deletedTxs: string[] }> {
    // Get threshold block.
    const blockThreshold = process.env['STACKS_MEMPOOL_TX_GARBAGE_COLLECTION_THRESHOLD'] ?? 256;
    const cutoffResults = await client.query<{ block_height: number }>(
      `SELECT (block_height - $1) AS block_height FROM chain_tip`,
      [blockThreshold]
    );
    if (cutoffResults.rowCount != 1) {
      return { deletedTxs: [] };
    }
    const cutoffBlockHeight = cutoffResults.rows[0].block_height;
    // Delete every mempool tx that came before that block.
    // TODO: Use DELETE instead of UPDATE once we implement a non-archival API replay mode.
    const deletedTxResults = await client.query<{ tx_id: Buffer }>(
      `UPDATE mempool_txs
      SET pruned = TRUE, status = $2
      WHERE pruned = FALSE AND receipt_block_height < $1
      RETURNING tx_id`,
      [cutoffBlockHeight, DbTxStatus.DroppedApiGarbageCollect]
    );
    await this.refreshMaterializedView(client, 'mempool_digest');
    const deletedTxs = deletedTxResults.rows.map(r => bufferToHexPrefixString(r.tx_id));
    return { deletedTxs: deletedTxs };
  }

  async markEntitiesCanonical(
    client: ClientBase,
    indexBlockHash: Buffer,
    canonical: boolean,
    updatedEntities: UpdatedEntities
  ): Promise<{ txsMarkedCanonical: string[]; txsMarkedNonCanonical: string[] }> {
    const txResult = await client.query<TxQueryResult>(
      `
      UPDATE txs
      SET canonical = $2
      WHERE index_block_hash = $1 AND canonical != $2
      RETURNING ${TX_COLUMNS}
      `,
      [indexBlockHash, canonical]
    );
    const txIds = txResult.rows.map(row => parseTxQueryResult(row));
    if (canonical) {
      updatedEntities.markedCanonical.txs += txResult.rowCount;
    } else {
      updatedEntities.markedNonCanonical.txs += txResult.rowCount;
    }
    for (const txId of txIds) {
      logger.verbose(`Marked tx as ${canonical ? 'canonical' : 'non-canonical'}: ${txId.tx_id}`);
    }
    // Update `principal_stx_txs`
    await client.query(
      `UPDATE principal_stx_txs
      SET canonical = $2
      WHERE tx_id = ANY($3) AND index_block_hash = $1 AND canonical != $2`,
      [indexBlockHash, canonical, txIds.map(tx => hexToBuffer(tx.tx_id))]
    );

    const minerRewardResults = await client.query(
      `
      UPDATE miner_rewards
      SET canonical = $2
      WHERE index_block_hash = $1 AND canonical != $2
      `,
      [indexBlockHash, canonical]
    );
    if (canonical) {
      updatedEntities.markedCanonical.minerRewards += minerRewardResults.rowCount;
    } else {
      updatedEntities.markedNonCanonical.minerRewards += minerRewardResults.rowCount;
    }

    const stxLockResults = await client.query(
      `
      UPDATE stx_lock_events
      SET canonical = $2
      WHERE index_block_hash = $1 AND canonical != $2
      `,
      [indexBlockHash, canonical]
    );
    if (canonical) {
      updatedEntities.markedCanonical.stxLockEvents += stxLockResults.rowCount;
    } else {
      updatedEntities.markedNonCanonical.stxLockEvents += stxLockResults.rowCount;
    }

    const stxResults = await client.query(
      `
      UPDATE stx_events
      SET canonical = $2
      WHERE index_block_hash = $1 AND canonical != $2
      `,
      [indexBlockHash, canonical]
    );
    if (canonical) {
      updatedEntities.markedCanonical.stxEvents += stxResults.rowCount;
    } else {
      updatedEntities.markedNonCanonical.stxEvents += stxResults.rowCount;
    }

    const ftResult = await client.query(
      `
      UPDATE ft_events
      SET canonical = $2
      WHERE index_block_hash = $1 AND canonical != $2
      `,
      [indexBlockHash, canonical]
    );
    if (canonical) {
      updatedEntities.markedCanonical.ftEvents += ftResult.rowCount;
    } else {
      updatedEntities.markedNonCanonical.ftEvents += ftResult.rowCount;
    }

    const nftResult = await client.query(
      `
      UPDATE nft_events
      SET canonical = $2
      WHERE index_block_hash = $1 AND canonical != $2
      `,
      [indexBlockHash, canonical]
    );
    if (canonical) {
      updatedEntities.markedCanonical.nftEvents += nftResult.rowCount;
    } else {
      updatedEntities.markedNonCanonical.nftEvents += nftResult.rowCount;
    }

    const contractLogResult = await client.query(
      `
      UPDATE contract_logs
      SET canonical = $2
      WHERE index_block_hash = $1 AND canonical != $2
      `,
      [indexBlockHash, canonical]
    );
    if (canonical) {
      updatedEntities.markedCanonical.contractLogs += contractLogResult.rowCount;
    } else {
      updatedEntities.markedNonCanonical.contractLogs += contractLogResult.rowCount;
    }

    const smartContractResult = await client.query(
      `
      UPDATE smart_contracts
      SET canonical = $2
      WHERE index_block_hash = $1 AND canonical != $2
      `,
      [indexBlockHash, canonical]
    );
    if (canonical) {
      updatedEntities.markedCanonical.smartContracts += smartContractResult.rowCount;
    } else {
      updatedEntities.markedNonCanonical.smartContracts += smartContractResult.rowCount;
    }

    const nameResult = await client.query(
      `
      UPDATE names
      SET canonical = $2
      WHERE index_block_hash = $1 AND canonical != $2
      `,
      [indexBlockHash, canonical]
    );
    if (canonical) {
      updatedEntities.markedCanonical.names += nameResult.rowCount;
    } else {
      updatedEntities.markedNonCanonical.names += nameResult.rowCount;
    }

    const namespaceResult = await client.query(
      `
      UPDATE namespaces
      SET canonical = $2
      WHERE index_block_hash = $1 AND canonical != $2
      `,
      [indexBlockHash, canonical]
    );
    if (canonical) {
      updatedEntities.markedCanonical.namespaces += namespaceResult.rowCount;
    } else {
      updatedEntities.markedNonCanonical.namespaces += namespaceResult.rowCount;
    }

    const subdomainResult = await client.query(
      `
      UPDATE subdomains
      SET canonical = $2
      WHERE index_block_hash = $1 AND canonical != $2
      `,
      [indexBlockHash, canonical]
    );
    if (canonical) {
      updatedEntities.markedCanonical.subdomains += subdomainResult.rowCount;
    } else {
      updatedEntities.markedNonCanonical.subdomains += subdomainResult.rowCount;
    }

    return {
      txsMarkedCanonical: canonical ? txIds.map(t => t.tx_id) : [],
      txsMarkedNonCanonical: canonical ? [] : txIds.map(t => t.tx_id),
    };
  }

  async restoreOrphanedChain(
    client: ClientBase,
    indexBlockHash: Buffer,
    updatedEntities: UpdatedEntities
  ): Promise<UpdatedEntities> {
    const restoredBlockResult = await client.query<BlockQueryResult>(
      `
      -- restore the previously orphaned block to canonical
      UPDATE blocks
      SET canonical = true
      WHERE index_block_hash = $1 AND canonical = false
      RETURNING ${BLOCK_COLUMNS}
      `,
      [indexBlockHash]
    );

    if (restoredBlockResult.rowCount === 0) {
      throw new Error(
        `Could not find orphaned block by index_hash ${indexBlockHash.toString('hex')}`
      );
    }
    if (restoredBlockResult.rowCount > 1) {
      throw new Error(
        `Found multiple non-canonical parents for index_hash ${indexBlockHash.toString('hex')}`
      );
    }
    updatedEntities.markedCanonical.blocks++;

    const orphanedBlockResult = await client.query<BlockQueryResult>(
      `
      -- orphan the now conflicting block at the same height
      UPDATE blocks
      SET canonical = false
      WHERE block_height = $1 AND index_block_hash != $2 AND canonical = true
      RETURNING ${BLOCK_COLUMNS}
      `,
      [restoredBlockResult.rows[0].block_height, indexBlockHash]
    );

    const microblocksOrphaned = new Set<string>();
    const microblocksAccepted = new Set<string>();

    if (orphanedBlockResult.rowCount > 0) {
      const orphanedBlocks = orphanedBlockResult.rows.map(b => parseBlockQueryResult(b));
      for (const orphanedBlock of orphanedBlocks) {
        const microCanonicalUpdateResult = await this.updateMicroCanonical(client, {
          isCanonical: false,
          blockHeight: orphanedBlock.block_height,
          blockHash: orphanedBlock.block_hash,
          indexBlockHash: orphanedBlock.index_block_hash,
          parentIndexBlockHash: orphanedBlock.parent_index_block_hash,
          parentMicroblockHash: orphanedBlock.parent_microblock_hash,
          parentMicroblockSequence: orphanedBlock.parent_microblock_sequence,
          burnBlockTime: orphanedBlock.burn_block_time,
        });
        microCanonicalUpdateResult.orphanedMicroblocks.forEach(mb => {
          microblocksOrphaned.add(mb);
          microblocksAccepted.delete(mb);
        });
        microCanonicalUpdateResult.acceptedMicroblocks.forEach(mb => {
          microblocksOrphaned.delete(mb);
          microblocksAccepted.add(mb);
        });
      }

      updatedEntities.markedNonCanonical.blocks++;
      const markNonCanonicalResult = await this.markEntitiesCanonical(
        client,
        orphanedBlockResult.rows[0].index_block_hash,
        false,
        updatedEntities
      );
      await this.restoreMempoolTxs(client, markNonCanonicalResult.txsMarkedNonCanonical);
    }

    // The canonical microblock tables _must_ be restored _after_ orphaning all other blocks at a given height,
    // because there is only 1 row per microblock hash, and both the orphaned blocks at this height and the
    // canonical block can be pointed to the same microblocks.
    const restoredBlock = parseBlockQueryResult(restoredBlockResult.rows[0]);
    const microCanonicalUpdateResult = await this.updateMicroCanonical(client, {
      isCanonical: true,
      blockHeight: restoredBlock.block_height,
      blockHash: restoredBlock.block_hash,
      indexBlockHash: restoredBlock.index_block_hash,
      parentIndexBlockHash: restoredBlock.parent_index_block_hash,
      parentMicroblockHash: restoredBlock.parent_microblock_hash,
      parentMicroblockSequence: restoredBlock.parent_microblock_sequence,
      burnBlockTime: restoredBlock.burn_block_time,
    });
    microCanonicalUpdateResult.orphanedMicroblocks.forEach(mb => {
      microblocksOrphaned.add(mb);
      microblocksAccepted.delete(mb);
    });
    microCanonicalUpdateResult.acceptedMicroblocks.forEach(mb => {
      microblocksOrphaned.delete(mb);
      microblocksAccepted.add(mb);
    });
    updatedEntities.markedCanonical.microblocks += microblocksAccepted.size;
    updatedEntities.markedNonCanonical.microblocks += microblocksOrphaned.size;

    microblocksOrphaned.forEach(mb => logger.verbose(`Marked microblock as non-canonical: ${mb}`));
    microblocksAccepted.forEach(mb => logger.verbose(`Marked microblock as canonical: ${mb}`));

    const markCanonicalResult = await this.markEntitiesCanonical(
      client,
      indexBlockHash,
      true,
      updatedEntities
    );
    const removedTxsResult = await this.pruneMempoolTxs(
      client,
      markCanonicalResult.txsMarkedCanonical
    );
    if (removedTxsResult.removedTxs.length > 0) {
      logger.verbose(
        `Removed ${removedTxsResult.removedTxs.length} txs from mempool table during reorg handling`
      );
    }
    const parentResult = await client.query<{ index_block_hash: Buffer }>(
      `
      -- check if the parent block is also orphaned
      SELECT index_block_hash
      FROM blocks
      WHERE
        block_height = $1 AND
        index_block_hash = $2 AND
        canonical = false
      `,
      [
        restoredBlockResult.rows[0].block_height - 1,
        restoredBlockResult.rows[0].parent_index_block_hash,
      ]
    );
    if (parentResult.rowCount > 1) {
      throw new Error('Found more than one non-canonical parent to restore during reorg');
    }
    if (parentResult.rowCount > 0) {
      await this.restoreOrphanedChain(
        client,
        parentResult.rows[0].index_block_hash,
        updatedEntities
      );
    }
    return updatedEntities;
  }

  async handleReorg(
    client: ClientBase,
    block: DbBlock,
    chainTipHeight: number
  ): Promise<UpdatedEntities> {
    const updatedEntities: UpdatedEntities = {
      markedCanonical: {
        blocks: 0,
        microblocks: 0,
        minerRewards: 0,
        txs: 0,
        stxLockEvents: 0,
        stxEvents: 0,
        ftEvents: 0,
        nftEvents: 0,
        contractLogs: 0,
        smartContracts: 0,
        names: 0,
        namespaces: 0,
        subdomains: 0,
      },
      markedNonCanonical: {
        blocks: 0,
        microblocks: 0,
        minerRewards: 0,
        txs: 0,
        stxLockEvents: 0,
        stxEvents: 0,
        ftEvents: 0,
        nftEvents: 0,
        contractLogs: 0,
        smartContracts: 0,
        names: 0,
        namespaces: 0,
        subdomains: 0,
      },
    };

    // Check if incoming block's parent is canonical
    if (block.block_height > 1) {
      const parentResult = await client.query<{
        canonical: boolean;
        index_block_hash: Buffer;
        parent_index_block_hash: Buffer;
      }>(
        `
        SELECT canonical, index_block_hash, parent_index_block_hash
        FROM blocks
        WHERE block_height = $1 AND index_block_hash = $2
        `,
        [block.block_height - 1, hexToBuffer(block.parent_index_block_hash)]
      );

      if (parentResult.rowCount > 1) {
        throw new Error(
          `DB contains multiple blocks at height ${block.block_height - 1} and index_hash ${
            block.parent_index_block_hash
          }`
        );
      }
      if (parentResult.rowCount === 0) {
        throw new Error(
          `DB does not contain a parent block at height ${block.block_height - 1} with index_hash ${
            block.parent_index_block_hash
          }`
        );
      }

      // This blocks builds off a previously orphaned chain. Restore canonical status for this chain.
      if (!parentResult.rows[0].canonical && block.block_height > chainTipHeight) {
        await this.restoreOrphanedChain(
          client,
          parentResult.rows[0].index_block_hash,
          updatedEntities
        );
        this.logReorgResultInfo(updatedEntities);
      }
    }
    return updatedEntities;
  }

  logReorgResultInfo(updatedEntities: UpdatedEntities) {
    const updates = [
      ['blocks', updatedEntities.markedCanonical.blocks, updatedEntities.markedNonCanonical.blocks],
      [
        'microblocks',
        updatedEntities.markedCanonical.microblocks,
        updatedEntities.markedNonCanonical.microblocks,
      ],
      ['txs', updatedEntities.markedCanonical.txs, updatedEntities.markedNonCanonical.txs],
      [
        'miner-rewards',
        updatedEntities.markedCanonical.minerRewards,
        updatedEntities.markedNonCanonical.minerRewards,
      ],
      [
        'stx-lock events',
        updatedEntities.markedCanonical.stxLockEvents,
        updatedEntities.markedNonCanonical.stxLockEvents,
      ],
      [
        'stx-token events',
        updatedEntities.markedCanonical.stxEvents,
        updatedEntities.markedNonCanonical.stxEvents,
      ],
      [
        'non-fungible-token events',
        updatedEntities.markedCanonical.nftEvents,
        updatedEntities.markedNonCanonical.nftEvents,
      ],
      [
        'fungible-token events',
        updatedEntities.markedCanonical.ftEvents,
        updatedEntities.markedNonCanonical.ftEvents,
      ],
      [
        'contract logs',
        updatedEntities.markedCanonical.contractLogs,
        updatedEntities.markedNonCanonical.contractLogs,
      ],
      [
        'smart contracts',
        updatedEntities.markedCanonical.smartContracts,
        updatedEntities.markedNonCanonical.smartContracts,
      ],
      ['names', updatedEntities.markedCanonical.names, updatedEntities.markedNonCanonical.names],
      [
        'namespaces',
        updatedEntities.markedCanonical.namespaces,
        updatedEntities.markedNonCanonical.namespaces,
      ],
      [
        'subdomains',
        updatedEntities.markedCanonical.subdomains,
        updatedEntities.markedNonCanonical.subdomains,
      ],
    ];
    const markedCanonical = updates.map(e => `${e[1]} ${e[0]}`).join(', ');
    logger.verbose(`Entities marked as canonical: ${markedCanonical}`);
    const markedNonCanonical = updates.map(e => `${e[2]} ${e[0]}`).join(', ');
    logger.verbose(`Entities marked as non-canonical: ${markedNonCanonical}`);
  }

  /**
   * Refreshes a Postgres materialized view.
   * @param client - Pg Client
   * @param viewName - Materialized view name
   * @param skipDuringEventReplay - If we should skip refreshing during event replay
   */
  async refreshMaterializedView(
    client: ClientBase,
    viewName: string,
    skipDuringEventReplay = true
  ) {
    if (this.isEventReplay && skipDuringEventReplay) {
      return;
    }
    await client.query(`REFRESH MATERIALIZED VIEW ${viewName}`);
  }

  /**
   * Refreshes the `nft_custody` and `nft_custody_unanchored` materialized views if necessary.
   * @param client - DB client
   * @param txs - Transaction event data
   * @param unanchored - If this refresh is requested from a block or microblock
   */
  async refreshNftCustody(
    client: ClientBase,
    txs: DataStoreTxEventData[],
    unanchored: boolean = false
  ) {
    const newNftEventCount = txs
      .map(tx => tx.nftEvents.length)
      .reduce((prev, cur) => prev + cur, 0);
    if (newNftEventCount > 0) {
      // Always refresh unanchored view since even if we're in a new anchored block we should update the
      // unanchored state to the current one.
      await this.refreshMaterializedView(client, 'nft_custody_unanchored');
      if (!unanchored) {
        await this.refreshMaterializedView(client, 'nft_custody');
      }
    } else if (!unanchored) {
      // Even if we didn't receive new NFT events in a new anchor block, we should check if we need to
      // update the anchored view to reflect any changes made by previous microblocks.
      const result = await client.query<{ outdated: boolean }>(
        `
        WITH anchored_height AS (SELECT MAX(block_height) AS anchored FROM nft_custody),
          unanchored_height AS (SELECT MAX(block_height) AS unanchored FROM nft_custody_unanchored)
        SELECT unanchored > anchored AS outdated
        FROM anchored_height CROSS JOIN unanchored_height
        `
      );
      if (result.rows.length > 0 && result.rows[0].outdated) {
        await this.refreshMaterializedView(client, 'nft_custody');
      }
    }
  }

  /**
   * Called when a full event import is complete.
   */
  async finishEventReplay() {
    if (!this.isEventReplay) {
      return;
    }
    await this.queryTx(async client => {
      await this.refreshMaterializedView(client, 'nft_custody', false);
      await this.refreshMaterializedView(client, 'nft_custody_unanchored', false);
      await this.refreshMaterializedView(client, 'chain_tip', false);
      await this.refreshMaterializedView(client, 'mempool_digest', false);
    });
  }
}
