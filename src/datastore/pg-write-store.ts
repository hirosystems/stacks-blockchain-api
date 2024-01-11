import { getOrAdd, I32_MAX, getIbdBlockHeight, getUintEnvOrDefault } from '../helpers';
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
  DbFaucetRequest,
  MinerRewardInsertValues,
  BlockInsertValues,
  RewardSlotHolderInsertValues,
  StxLockEventInsertValues,
  StxEventInsertValues,
  PrincipalStxTxsInsertValues,
  BnsSubdomainInsertValues,
  BnsZonefileInsertValues,
  FtEventInsertValues,
  NftEventInsertValues,
  SmartContractEventInsertValues,
  MicroblockQueryResult,
  BurnchainRewardInsertValues,
  TxInsertValues,
  MempoolTxInsertValues,
  SmartContractInsertValues,
  BnsNameInsertValues,
  BnsNamespaceInsertValues,
  FaucetRequestInsertValues,
  MicroblockInsertValues,
  TxQueryResult,
  ReOrgUpdatedEntities,
  BlockQueryResult,
  DataStoreAttachmentData,
  DataStoreAttachmentSubdomainData,
  DataStoreBnsBlockData,
  PoxSyntheticEventInsertValues,
  DbTxRaw,
  DbMempoolTxRaw,
  DbChainTip,
  RawEventRequestInsertValues,
  IndexesState,
  NftCustodyInsertValues,
  DataStoreBnsBlockTxData,
  DbPoxSyntheticEvent,
  PoxSyntheticEventTable,
} from './common';
import {
  BLOCK_COLUMNS,
  setTotalBlockUpdateDataExecutionCost,
  convertTxQueryResultToDbMempoolTx,
  markBlockUpdateDataAsNonCanonical,
  MICROBLOCK_COLUMNS,
  parseBlockQueryResult,
  parseMicroblockQueryResult,
  parseTxQueryResult,
  TX_COLUMNS,
  TX_METADATA_TABLES,
  validateZonefileHash,
  newReOrgUpdatedEntities,
} from './helpers';
import { PgNotifier } from './pg-notifier';
import { MIGRATIONS_DIR, PgStore } from './pg-store';
import * as zoneFileParser from 'zone-file';
import { parseResolver, parseZoneFileTxt } from '../event-stream/bns/bns-helpers';
import { SyntheticPoxEventName } from '../pox-helpers';
import { logger } from '../logger';
import {
  PgJsonb,
  PgSqlClient,
  batchIterate,
  connectPostgres,
  isProdEnv,
  isTestEnv,
  runMigrations,
} from '@hirosystems/api-toolkit';
import { PgServer, getConnectionArgs, getConnectionConfig } from './connection';

const MIGRATIONS_TABLE = 'pgmigrations';
const INSERT_BATCH_SIZE = 500;
const MEMPOOL_STATS_DEBOUNCE_INTERVAL = getUintEnvOrDefault(
  'MEMPOOL_STATS_DEBOUNCE_INTERVAL',
  1000
);
const MEMPOOL_STATS_DEBOUNCE_MAX_INTERVAL = getUintEnvOrDefault(
  'MEMPOOL_STATS_DEBOUNCE_MAX_INTERVAL',
  10000
);

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
  protected isIbdBlockHeightReached = false;

  constructor(
    sql: PgSqlClient,
    notifier: PgNotifier | undefined = undefined,
    isEventReplay: boolean = false
  ) {
    super(sql, notifier);
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
    const sql = await connectPostgres({
      usageName: usageName,
      connectionArgs: getConnectionArgs(PgServer.primary),
      connectionConfig: getConnectionConfig(PgServer.primary),
    });
    if (!skipMigrations) {
      await runMigrations(MIGRATIONS_DIR, 'up', getConnectionArgs(PgServer.primary));
    }
    const notifier = withNotifier ? await PgNotifier.create(usageName) : undefined;
    const store = new PgWriteStore(sql, notifier, isEventReplay);
    await store.connectPgNotifier();
    return store;
  }

  async storeRawEventRequest(eventPath: string, payload: PgJsonb): Promise<void> {
    // To avoid depending on the DB more than once and to allow the query transaction to settle,
    // we'll take the complete insert result and move that to the output TSV file instead of taking
    // only the `id` and performing a `COPY` of that row later.
    const insertResult = await this.sql<
      {
        id: string;
        receive_timestamp: string;
        event_path: string;
        payload: string;
      }[]
    >`INSERT INTO event_observer_requests(
        event_path, payload
      ) values(${eventPath}, ${payload})
      RETURNING id, receive_timestamp::text, event_path, payload::text
    `;
    if (insertResult.length !== 1) {
      throw new Error(
        `Unexpected row count ${insertResult.length} when storing event_observer_requests entry`
      );
    }
  }

  async update(data: DataStoreBlockUpdateData): Promise<void> {
    let garbageCollectedMempoolTxs: string[] = [];
    let batchedTxData: DataStoreTxEventData[] = [];

    await this.sqlWriteTransaction(async sql => {
      const chainTip = await this.getChainTip();
      await this.handleReorg(sql, data.block, chainTip.block_height);
      const isCanonical = data.block.block_height > chainTip.block_height;
      if (!isCanonical) {
        markBlockUpdateDataAsNonCanonical(data);
      } else {
        const txIds = data.txs.map(d => d.tx.tx_id);
        const pruneRes = await this.pruneMempoolTxs(sql, txIds);
        if (pruneRes.removedTxs.length > 0)
          logger.debug(
            `Removed ${pruneRes.removedTxs.length} txs from mempool table during new block ingestion`
          );
      }
      setTotalBlockUpdateDataExecutionCost(data);

      // Insert microblocks, if any. Clear already inserted microblock txs from the anchor-block
      // update data to avoid duplicate inserts.
      const insertedMicroblockHashes = await this.insertMicroblocksFromBlockUpdate(sql, data);
      batchedTxData = data.txs.filter(entry => {
        return !insertedMicroblockHashes.has(entry.tx.microblock_hash);
      });

      // When processing an immediately-non-canonical block, do not orphan and possible existing microblocks
      // which may be still considered canonical by the canonical block at this height.
      if (isCanonical) {
        const { acceptedMicroblockTxs, orphanedMicroblockTxs } = await this.updateMicroCanonical(
          sql,
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
          sql,
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

        await this.updatePoxStateUnlockHeight(sql, data);
      }

      // When receiving first block, check if "block 0" boot data was received,
      // if so, update their properties to correspond to "block 1", since we treat
      // the "block 0" concept as an internal implementation detail.
      if (data.block.block_height === 1) {
        const blockZero = await this.getBlockInternal(sql, { height: 0 });
        if (blockZero.found) {
          await this.fixBlockZeroData(sql, data.block);
        }
      }
      if ((await this.updateBlock(sql, data.block)) !== 0) {
        await this.updateMinerRewards(sql, data.minerRewards);
        for (const entry of batchedTxData) {
          await this.updateTx(sql, entry.tx);
          await this.updateStxEvents(sql, entry.tx, entry.stxEvents);
          await this.updatePrincipalStxTxs(sql, entry.tx, entry.stxEvents);
          await this.updateSmartContractEvents(sql, entry.tx, entry.contractLogEvents);
          await this.updatePoxSyntheticEvents(sql, entry.tx, 'pox2_events', entry.pox2Events);
          await this.updatePoxSyntheticEvents(sql, entry.tx, 'pox3_events', entry.pox3Events);
          await this.updatePoxSyntheticEvents(sql, entry.tx, 'pox4_events', entry.pox4Events);
          await this.updateStxLockEvents(sql, entry.tx, entry.stxLockEvents);
          await this.updateFtEvents(sql, entry.tx, entry.ftEvents);
          await this.updateNftEvents(sql, entry.tx, entry.nftEvents);
          await this.updateSmartContracts(sql, entry.tx, entry.smartContracts);
          await this.updateNamespaces(sql, entry.tx, entry.namespaces);
          await this.updateNames(sql, entry.tx, entry.names);
        }
        const mempoolGarbageResults = await this.deleteGarbageCollectedMempoolTxs(sql);
        if (mempoolGarbageResults.deletedTxs.length > 0) {
          logger.debug(`Garbage collected ${mempoolGarbageResults.deletedTxs.length} mempool txs`);
        }
        garbageCollectedMempoolTxs = mempoolGarbageResults.deletedTxs;
      }

      if (!this.isEventReplay) {
        this.debounceMempoolStat();
      }
      if (isCanonical)
        await sql`
          WITH new_tx_count AS (
            SELECT tx_count + ${data.txs.length} AS tx_count FROM chain_tip
          )
          UPDATE chain_tip SET
            block_height = ${data.block.block_height},
            block_hash = ${data.block.block_hash},
            index_block_hash = ${data.block.index_block_hash},
            burn_block_height = ${data.block.burn_block_height},
            microblock_hash = NULL,
            microblock_sequence = NULL,
            block_count = ${data.block.block_height},
            tx_count = (SELECT tx_count FROM new_tx_count),
            tx_count_unanchored = (SELECT tx_count FROM new_tx_count)
        `;
    });
    // Do we have an IBD height defined in ENV? If so, check if this block update reached it.
    const ibdHeight = getIbdBlockHeight();
    this.isIbdBlockHeightReached = ibdHeight ? data.block.block_height > ibdHeight : true;
    // Send block updates but don't block current execution unless we're testing.
    if (isTestEnv) await this.sendBlockNotifications({ data, garbageCollectedMempoolTxs });
    else void this.sendBlockNotifications({ data, garbageCollectedMempoolTxs });
  }

  /**
   * Send block update via Postgres NOTIFY
   * @param args - Block data
   */
  private async sendBlockNotifications(args: {
    data: DataStoreBlockUpdateData;
    garbageCollectedMempoolTxs: string[];
  }): Promise<void> {
    // Skip sending `PgNotifier` updates altogether if we're in the genesis block since this block
    // is the event replay of the v1 blockchain.
    if (!this.notifier || !(args.data.block.block_height > 1 || !isProdEnv)) return;
    await this.notifier.sendBlock({ blockHash: args.data.block.block_hash });
    for (const tx of args.data.txs) {
      await this.notifier.sendTx({ txId: tx.tx.tx_id });
      for (const smartContract of tx.smartContracts) {
        await this.notifier.sendSmartContract({
          contractId: smartContract.contract_id,
        });
      }
      for (const logEvent of tx.contractLogEvents) {
        await this.notifier.sendSmartContractLog({
          txId: logEvent.tx_id,
          eventIndex: logEvent.event_index,
        });
      }
    }
    for (const txId of args.garbageCollectedMempoolTxs) {
      await this.notifier.sendTx({ txId: txId });
    }
    await this.emitAddressTxUpdates(args.data.txs);
    for (const nftEvent of args.data.txs.map(tx => tx.nftEvents).flat()) {
      await this.notifier.sendNftEvent({
        txId: nftEvent.tx_id,
        eventIndex: nftEvent.event_index,
      });
    }
  }

  /**
   * Find and insert microblocks that weren't already inserted via the unconfirmed `/new_microblock`
   * event. This happens when a stacks-node is syncing and receives confirmed microblocks with their
   * anchor block at the same time.
   * @param sql - SQL client
   * @param data - Block data to insert
   * @returns Set of microblock hashes that were inserted in this update
   */
  private async insertMicroblocksFromBlockUpdate(
    sql: PgSqlClient,
    data: DataStoreBlockUpdateData
  ): Promise<Set<string>> {
    if (data.microblocks.length == 0) return new Set();
    const existingMicroblocksQuery = await sql<{ microblock_hash: string }[]>`
      SELECT DISTINCT microblock_hash
      FROM microblocks
      WHERE parent_index_block_hash = ${data.block.parent_index_block_hash}
        AND microblock_hash IN ${sql(data.microblocks.map(mb => mb.microblock_hash))}
    `;
    const existingHashes = existingMicroblocksQuery.map(i => i.microblock_hash);
    const missingMicroblocks = data.microblocks.filter(
      mb => !existingHashes.includes(mb.microblock_hash)
    );
    if (missingMicroblocks.length > 0) {
      const missingMicroblockHashes = new Set(missingMicroblocks.map(mb => mb.microblock_hash));
      const missingTxs = data.txs.filter(entry =>
        missingMicroblockHashes.has(entry.tx.microblock_hash)
      );
      await this.insertMicroblockData(sql, missingMicroblocks, missingTxs);
      return missingMicroblockHashes;
    }
    return new Set();
  }

  private async updatePoxStateUnlockHeight(sql: PgSqlClient, data: DataStoreBlockUpdateData) {
    if (data.pox_v1_unlock_height !== undefined) {
      // update the pox_state.pox_v1_unlock_height singleton
      await sql`
        UPDATE pox_state
        SET pox_v1_unlock_height = ${data.pox_v1_unlock_height}
        WHERE pox_v1_unlock_height != ${data.pox_v1_unlock_height}
      `;
    }
    if (data.pox_v2_unlock_height !== undefined) {
      // update the pox_state.pox_v2_unlock_height singleton
      await sql`
        UPDATE pox_state
        SET pox_v2_unlock_height = ${data.pox_v2_unlock_height}
        WHERE pox_v2_unlock_height != ${data.pox_v2_unlock_height}
      `;
    }
    if (data.pox_v3_unlock_height !== undefined) {
      // update the pox_state.pox_v3_unlock_height singleton
      await sql`
        UPDATE pox_state
        SET pox_v3_unlock_height = ${data.pox_v3_unlock_height}
        WHERE pox_v3_unlock_height != ${data.pox_v3_unlock_height}
      `;
    }
  }

  async updateMinerRewards(sql: PgSqlClient, minerRewards: DbMinerReward[]): Promise<void> {
    for (const batch of batchIterate(minerRewards, INSERT_BATCH_SIZE)) {
      const values: MinerRewardInsertValues[] = batch.map(minerReward => ({
        block_hash: minerReward.block_hash,
        index_block_hash: minerReward.index_block_hash,
        from_index_block_hash: minerReward.from_index_block_hash,
        mature_block_height: minerReward.mature_block_height,
        canonical: minerReward.canonical,
        recipient: minerReward.recipient,
        // If `miner_address` is null then it means pre-Stacks2.1 data, and the `recipient` can be accurately used
        miner_address: minerReward.miner_address ?? minerReward.recipient,
        coinbase_amount: minerReward.coinbase_amount.toString(),
        tx_fees_anchored: minerReward.tx_fees_anchored.toString(),
        tx_fees_streamed_confirmed: minerReward.tx_fees_streamed_confirmed.toString(),
        tx_fees_streamed_produced: minerReward.tx_fees_streamed_produced.toString(),
      }));
      await sql`
        INSERT INTO miner_rewards ${sql(values)}
      `;
    }
  }

  async updateBlock(sql: PgSqlClient, block: DbBlock): Promise<number> {
    const values: BlockInsertValues = {
      block_hash: block.block_hash,
      index_block_hash: block.index_block_hash,
      parent_index_block_hash: block.parent_index_block_hash,
      parent_block_hash: block.parent_block_hash,
      parent_microblock_hash: block.parent_microblock_hash,
      parent_microblock_sequence: block.parent_microblock_sequence,
      block_height: block.block_height,
      burn_block_time: block.burn_block_time,
      burn_block_hash: block.burn_block_hash,
      burn_block_height: block.burn_block_height,
      miner_txid: block.miner_txid,
      canonical: block.canonical,
      execution_cost_read_count: block.execution_cost_read_count,
      execution_cost_read_length: block.execution_cost_read_length,
      execution_cost_runtime: block.execution_cost_runtime,
      execution_cost_write_count: block.execution_cost_write_count,
      execution_cost_write_length: block.execution_cost_write_length,
      tx_count: block.tx_count,
    };
    const result = await sql`
      INSERT INTO blocks ${sql(values)}
      ON CONFLICT (index_block_hash) DO NOTHING
    `;
    return result.count;
  }

  async insertStxEventBatch(sql: PgSqlClient, stxEvents: StxEventInsertValues[]) {
    const values = stxEvents.map(s => {
      const value: StxEventInsertValues = {
        event_index: s.event_index,
        tx_id: s.tx_id,
        tx_index: s.tx_index,
        block_height: s.block_height,
        index_block_hash: s.index_block_hash,
        parent_index_block_hash: s.parent_index_block_hash,
        microblock_hash: s.microblock_hash,
        microblock_sequence: s.microblock_sequence,
        microblock_canonical: s.microblock_canonical,
        canonical: s.canonical,
        asset_event_type_id: s.asset_event_type_id,
        sender: s.sender,
        recipient: s.recipient,
        amount: s.amount,
        memo: s.memo ?? null,
      };
      return value;
    });
    await sql`
      INSERT INTO stx_events ${sql(values)}
    `;
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
    await this.sqlWriteTransaction(async sql => {
      const existingSlotHolders = await sql<{ address: string }[]>`
        UPDATE reward_slot_holders
        SET canonical = false
        WHERE canonical = true
          AND (burn_block_hash = ${burnchainBlockHash}
            OR burn_block_height >= ${burnchainBlockHeight})
      `;
      if (existingSlotHolders.count > 0) {
        logger.warn(
          `Invalidated ${existingSlotHolders.count} burnchain reward slot holders after fork detected at burnchain block ${burnchainBlockHash}`
        );
      }
      if (slotHolders.length === 0) {
        return;
      }
      const values: RewardSlotHolderInsertValues[] = slotHolders.map(val => ({
        canonical: val.canonical,
        burn_block_hash: val.burn_block_hash,
        burn_block_height: val.burn_block_height,
        address: val.address,
        slot_index: val.slot_index,
      }));
      const result = await sql`
        INSERT INTO reward_slot_holders ${sql(values)}
      `;
      if (result.count !== slotHolders.length) {
        throw new Error(
          `Unexpected row count after inserting reward slot holders: ${result.count} vs ${slotHolders.length}`
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
    const txData: DataStoreTxEventData[] = [];
    let dbMicroblocks: DbMicroblock[] = [];
    const deployedSmartContracts: DbSmartContract[] = [];
    const contractLogEvents: DbSmartContractEvent[] = [];

    await this.sqlWriteTransaction(async sql => {
      // Sanity check: ensure incoming microblocks have a `parent_index_block_hash` that matches the
      // API's current known canonical chain tip. We assume this holds true so incoming microblock
      // data is always treated as being built off the current canonical anchor block.
      const chainTip = await this.getChainTip();
      const nonCanonicalMicroblock = data.microblocks.find(
        mb => mb.parent_index_block_hash !== chainTip.index_block_hash
      );
      // Note: the stacks-node event emitter can send old microblocks that have already been processed by a previous anchor block.
      // Log warning and return, nothing to do.
      if (nonCanonicalMicroblock) {
        logger.info(
          `Failure in microblock ingestion, microblock ${nonCanonicalMicroblock.microblock_hash} ` +
            `points to parent index block hash ${nonCanonicalMicroblock.parent_index_block_hash} rather ` +
            `than the current canonical tip's index block hash ${chainTip.index_block_hash}.`
        );
        return;
      }

      // The block height is just one after the current chain tip height
      const blockHeight = chainTip.block_height + 1;
      dbMicroblocks = data.microblocks.map(mb => {
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
          parent_block_height: chainTip.block_height,
          parent_block_hash: chainTip.block_hash,
          index_block_hash: '', // Empty until microblock is confirmed in an anchor block
          block_hash: '', // Empty until microblock is confirmed in an anchor block
        };
        return dbMicroBlock;
      });

      for (const entry of data.txs) {
        // Note: the properties block_hash and burn_block_time are empty here because the anchor
        // block with that data doesn't yet exist.
        const dbTx: DbTxRaw = {
          ...entry.tx,
          parent_block_hash: chainTip.block_hash,
          block_height: blockHeight,
        };

        // Set all the `block_height` properties for the related tx objects, since it wasn't known
        // when creating the objects using only the stacks-node message payload.
        txData.push({
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
          pox2Events: entry.pox2Events.map(e => ({ ...e, block_height: blockHeight })),
          pox3Events: entry.pox3Events.map(e => ({ ...e, block_height: blockHeight })),
          pox4Events: entry.pox4Events.map(e => ({ ...e, block_height: blockHeight })),
        });
        deployedSmartContracts.push(...entry.smartContracts);
        contractLogEvents.push(...entry.contractLogEvents);
      }

      await this.insertMicroblockData(sql, dbMicroblocks, txData);

      // Find any microblocks that have been orphaned by this latest microblock chain tip.
      // This function also checks that each microblock parent hash points to an existing microblock in the db.
      const currentMicroblockTip = dbMicroblocks[dbMicroblocks.length - 1];
      const unanchoredMicroblocksAtTip = await this.findUnanchoredMicroblocksAtChainTip(
        sql,
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
        const microOrphanResult = await this.handleMicroReorg(sql, {
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
          sql,
          microOrphanedTxs.map(tx => tx.tx_id)
        );
        restoredMempoolTxs.restoredTxs.forEach(txId => {
          logger.info(`Restored micro-orphaned tx to mempool ${txId}`);
        });
      }

      const candidateTxIds = data.txs.map(d => d.tx.tx_id);
      const removedTxsResult = await this.pruneMempoolTxs(sql, candidateTxIds);
      if (removedTxsResult.removedTxs.length > 0) {
        logger.debug(
          `Removed ${removedTxsResult.removedTxs.length} microblock-txs from mempool table during microblock ingestion`
        );
      }

      if (!this.isEventReplay) {
        this.debounceMempoolStat();
      }
      if (currentMicroblockTip.microblock_canonical)
        await sql`
          UPDATE chain_tip SET
            microblock_hash = ${currentMicroblockTip.microblock_hash},
            microblock_sequence = ${currentMicroblockTip.microblock_sequence},
            microblock_count = microblock_count + ${data.microblocks.length},
            tx_count_unanchored = ${
              currentMicroblockTip.microblock_sequence === 0
                ? sql`tx_count + ${data.txs.length}`
                : sql`tx_count_unanchored + ${data.txs.length}`
            }
        `;
    });

    if (this.notifier) {
      for (const microblock of dbMicroblocks) {
        await this.notifier.sendMicroblock({ microblockHash: microblock.microblock_hash });
      }
      for (const tx of txData) {
        await this.notifier.sendTx({ txId: tx.tx.tx_id });
      }
      for (const smartContract of deployedSmartContracts) {
        await this.notifier.sendSmartContract({
          contractId: smartContract.contract_id,
        });
      }
      for (const logEvent of contractLogEvents) {
        await this.notifier.sendSmartContractLog({
          txId: logEvent.tx_id,
          eventIndex: logEvent.event_index,
        });
      }
      await this.emitAddressTxUpdates(txData);
    }
  }

  async fixBlockZeroData(sql: PgSqlClient, blockOne: DbBlock): Promise<void> {
    const tablesUpdates: Record<string, number> = {};
    const txsResult = await sql<TxQueryResult[]>`
      UPDATE txs
      SET
        canonical = true,
        block_height = 1,
        tx_index = tx_index + 1,
        block_hash = ${blockOne.block_hash},
        index_block_hash = ${blockOne.index_block_hash},
        burn_block_time = ${blockOne.burn_block_time},
        parent_block_hash = ${blockOne.parent_block_hash}
      WHERE block_height = 0
    `;
    tablesUpdates['txs'] = txsResult.count;
    for (const table of TX_METADATA_TABLES) {
      // a couple tables have a different name for the 'block_height' column
      const heightCol =
        table === 'names'
          ? sql('registered_at')
          : table === 'namespaces'
          ? sql('ready_block')
          : sql('block_height');
      // The smart_contracts table does not have a tx_index column
      const txIndexBump = table === 'smart_contracts' ? sql`` : sql`tx_index = tx_index + 1,`;
      const metadataResult = await sql`
        UPDATE ${sql(table)}
        SET
          canonical = true,
          ${heightCol} = 1,
          ${txIndexBump}
          index_block_hash = ${blockOne.index_block_hash}
        WHERE ${heightCol} = 0
      `;
      tablesUpdates[table] = metadataResult.count;
    }
    logger.info('Updated block zero boot data', tablesUpdates);
  }

  async updatePoxSyntheticEvents(
    sql: PgSqlClient,
    tx: DbTx,
    poxTable: PoxSyntheticEventTable,
    events: DbPoxSyntheticEvent[]
  ) {
    for (const batch of batchIterate(events, INSERT_BATCH_SIZE)) {
      const values = batch.map(event => {
        const value: PoxSyntheticEventInsertValues = {
          event_index: event.event_index,
          tx_id: event.tx_id,
          tx_index: event.tx_index,
          block_height: event.block_height,
          index_block_hash: tx.index_block_hash,
          parent_index_block_hash: tx.parent_index_block_hash,
          microblock_hash: tx.microblock_hash,
          microblock_sequence: tx.microblock_sequence,
          microblock_canonical: tx.microblock_canonical,
          canonical: event.canonical,
          stacker: event.stacker,
          locked: event.locked.toString(),
          balance: event.balance.toString(),
          burnchain_unlock_height: event.burnchain_unlock_height.toString(),
          name: event.name,
          pox_addr: event.pox_addr,
          pox_addr_raw: event.pox_addr_raw,
          first_cycle_locked: null,
          first_unlocked_cycle: null,
          delegate_to: null,
          lock_period: null,
          lock_amount: null,
          start_burn_height: null,
          unlock_burn_height: null,
          delegator: null,
          increase_by: null,
          total_locked: null,
          extend_count: null,
          reward_cycle: null,
          amount_ustx: null,
        };
        // Set event-specific columns
        switch (event.name) {
          case SyntheticPoxEventName.HandleUnlock: {
            value.first_cycle_locked = event.data.first_cycle_locked.toString();
            value.first_unlocked_cycle = event.data.first_unlocked_cycle.toString();
            break;
          }
          case SyntheticPoxEventName.StackStx: {
            value.lock_period = event.data.lock_period.toString();
            value.lock_amount = event.data.lock_amount.toString();
            value.start_burn_height = event.data.start_burn_height.toString();
            value.unlock_burn_height = event.data.unlock_burn_height.toString();
            break;
          }
          case SyntheticPoxEventName.StackIncrease: {
            value.increase_by = event.data.increase_by.toString();
            value.total_locked = event.data.total_locked.toString();
            break;
          }
          case SyntheticPoxEventName.StackExtend: {
            value.extend_count = event.data.extend_count.toString();
            value.unlock_burn_height = event.data.unlock_burn_height.toString();
            break;
          }
          case SyntheticPoxEventName.DelegateStx: {
            value.amount_ustx = event.data.amount_ustx.toString();
            value.delegate_to = event.data.delegate_to;
            value.unlock_burn_height = event.data.unlock_burn_height?.toString() ?? null;
            break;
          }
          case SyntheticPoxEventName.DelegateStackStx: {
            value.lock_period = event.data.lock_period.toString();
            value.lock_amount = event.data.lock_amount.toString();
            value.start_burn_height = event.data.start_burn_height.toString();
            value.unlock_burn_height = event.data.unlock_burn_height.toString();
            value.delegator = event.data.delegator;
            break;
          }
          case SyntheticPoxEventName.DelegateStackIncrease: {
            value.increase_by = event.data.increase_by.toString();
            value.total_locked = event.data.total_locked.toString();
            value.delegator = event.data.delegator;
            break;
          }
          case SyntheticPoxEventName.DelegateStackExtend: {
            value.extend_count = event.data.extend_count.toString();
            value.unlock_burn_height = event.data.unlock_burn_height.toString();
            value.delegator = event.data.delegator;
            break;
          }
          case SyntheticPoxEventName.StackAggregationCommit: {
            value.reward_cycle = event.data.reward_cycle.toString();
            value.amount_ustx = event.data.amount_ustx.toString();
            break;
          }
          case SyntheticPoxEventName.StackAggregationCommitIndexed: {
            value.reward_cycle = event.data.reward_cycle.toString();
            value.amount_ustx = event.data.amount_ustx.toString();
            break;
          }
          case SyntheticPoxEventName.StackAggregationIncrease: {
            value.reward_cycle = event.data.reward_cycle.toString();
            value.amount_ustx = event.data.amount_ustx.toString();
            break;
          }
          case SyntheticPoxEventName.RevokeDelegateStx: {
            value.amount_ustx = event.data.amount_ustx.toString();
            value.delegate_to = event.data.delegate_to;
            break;
          }
          default: {
            throw new Error(
              `Unexpected Pox synthetic event name: ${(event as DbPoxSyntheticEvent).name}`
            );
          }
        }
        return value;
      });
      await sql`
        INSERT INTO ${sql(poxTable)} ${sql(values)}
      `;
    }
  }

  async updateStxLockEvents(sql: PgSqlClient, tx: DbTx, events: DbStxLockEvent[]) {
    for (const batch of batchIterate(events, INSERT_BATCH_SIZE)) {
      const values: StxLockEventInsertValues[] = batch.map(event => ({
        event_index: event.event_index,
        tx_id: event.tx_id,
        tx_index: event.tx_index,
        block_height: event.block_height,
        index_block_hash: tx.index_block_hash,
        parent_index_block_hash: tx.parent_index_block_hash,
        microblock_hash: tx.microblock_hash,
        microblock_sequence: tx.microblock_sequence,
        microblock_canonical: tx.microblock_canonical,
        canonical: event.canonical,
        locked_amount: event.locked_amount.toString(),
        unlock_height: event.unlock_height,
        locked_address: event.locked_address,
        contract_name: event.contract_name,
      }));
      await sql`
        INSERT INTO stx_lock_events ${sql(values)}
      `;
    }
  }

  async updateStxEvents(sql: PgSqlClient, tx: DbTx, events: DbStxEvent[]) {
    for (const eventBatch of batchIterate(events, INSERT_BATCH_SIZE)) {
      const values: StxEventInsertValues[] = eventBatch.map(event => ({
        event_index: event.event_index,
        tx_id: event.tx_id,
        tx_index: event.tx_index,
        block_height: event.block_height,
        index_block_hash: tx.index_block_hash,
        parent_index_block_hash: tx.parent_index_block_hash,
        microblock_hash: tx.microblock_hash,
        microblock_sequence: tx.microblock_sequence,
        microblock_canonical: tx.microblock_canonical,
        canonical: event.canonical,
        asset_event_type_id: event.asset_event_type_id,
        sender: event.sender ?? null,
        recipient: event.recipient ?? null,
        amount: event.amount,
        memo: event.memo ?? null,
      }));
      const res = await sql`
        INSERT INTO stx_events ${sql(values)}
      `;
      if (res.count !== eventBatch.length) {
        throw new Error(`Expected ${eventBatch.length} inserts, got ${res.count}`);
      }
    }
  }

  /**
   * Update the `principal_stx_tx` table with the latest `tx_id`s that resulted in a STX
   * transfer relevant to a principal (stx address or contract id).
   * @param sql - DB client
   * @param tx - Transaction
   * @param events - Transaction STX events
   */
  async updatePrincipalStxTxs(sql: PgSqlClient, tx: DbTx, events: DbStxEvent[]) {
    const insertPrincipalStxTxs = async (principals: string[]) => {
      principals = [...new Set(principals)]; // Remove duplicates
      const values: PrincipalStxTxsInsertValues[] = principals.map(principal => ({
        principal: principal,
        tx_id: tx.tx_id,
        block_height: tx.block_height,
        index_block_hash: tx.index_block_hash,
        microblock_hash: tx.microblock_hash,
        microblock_sequence: tx.microblock_sequence,
        tx_index: tx.tx_index,
        canonical: tx.canonical,
        microblock_canonical: tx.microblock_canonical,
      }));
      await sql`
        INSERT INTO principal_stx_txs ${sql(values)}
        ON CONFLICT ON CONSTRAINT unique_principal_tx_id_index_block_hash_microblock_hash DO NOTHING
      `;
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
    for (const eventBatch of batchIterate(events, INSERT_BATCH_SIZE)) {
      const principals: string[] = [];
      for (const event of eventBatch) {
        if (event.sender) principals.push(event.sender);
        if (event.recipient) principals.push(event.recipient);
      }
      await insertPrincipalStxTxs(principals);
    }
  }

  async updateBatchZonefiles(
    sql: PgSqlClient,
    data: DataStoreAttachmentSubdomainData[]
  ): Promise<void> {
    const zonefileValues: BnsZonefileInsertValues[] = [];
    for (const dataItem of data) {
      if (dataItem.subdomains && dataItem.blockData) {
        for (const subdomain of dataItem.subdomains) {
          zonefileValues.push({
            name: subdomain.fully_qualified_subdomain,
            zonefile: subdomain.zonefile,
            zonefile_hash: validateZonefileHash(subdomain.zonefile_hash),
            tx_id: subdomain.tx_id,
            index_block_hash: dataItem.blockData.index_block_hash,
          });
        }
      }
      if (dataItem.attachment) {
        zonefileValues.push({
          name: `${dataItem.attachment.name}.${dataItem.attachment.namespace}`,
          zonefile: Buffer.from(dataItem.attachment.zonefile, 'hex').toString(),
          zonefile_hash: validateZonefileHash(dataItem.attachment.zonefileHash),
          tx_id: dataItem.attachment.txId,
          index_block_hash: dataItem.attachment.indexBlockHash,
        });
      }
    }
    if (zonefileValues.length === 0) {
      return;
    }
    const result = await sql`
      INSERT INTO zonefiles ${sql(zonefileValues)}
      ON CONFLICT ON CONSTRAINT unique_name_zonefile_hash_tx_id_index_block_hash DO
        UPDATE SET zonefile = EXCLUDED.zonefile
    `;
    if (result.count !== zonefileValues.length) {
      throw new Error(`Expected ${result.count} zonefile inserts, got ${zonefileValues.length}`);
    }
  }

  async updateBatchSubdomains(
    sql: PgSqlClient,
    data: DataStoreAttachmentSubdomainData[]
  ): Promise<void> {
    const subdomainValues: BnsSubdomainInsertValues[] = [];
    for (const dataItem of data) {
      if (dataItem.subdomains && dataItem.blockData) {
        for (const subdomain of dataItem.subdomains) {
          subdomainValues.push({
            name: subdomain.name,
            namespace_id: subdomain.namespace_id,
            fully_qualified_subdomain: subdomain.fully_qualified_subdomain,
            owner: subdomain.owner,
            zonefile_hash: validateZonefileHash(subdomain.zonefile_hash),
            parent_zonefile_hash: subdomain.parent_zonefile_hash,
            parent_zonefile_index: subdomain.parent_zonefile_index,
            block_height: subdomain.block_height,
            tx_index: subdomain.tx_index,
            zonefile_offset: subdomain.zonefile_offset,
            resolver: subdomain.resolver,
            canonical: subdomain.canonical,
            tx_id: subdomain.tx_id,
            index_block_hash: dataItem.blockData.index_block_hash,
            parent_index_block_hash: dataItem.blockData.parent_index_block_hash,
            microblock_hash: dataItem.blockData.microblock_hash,
            microblock_sequence: dataItem.blockData.microblock_sequence,
            microblock_canonical: dataItem.blockData.microblock_canonical,
          });
        }
      }
    }
    if (subdomainValues.length === 0) {
      return;
    }
    const result = await sql`
      INSERT INTO subdomains ${sql(subdomainValues)}
      ON CONFLICT ON CONSTRAINT unique_fqs_tx_id_index_block_hash_microblock_hash DO
        UPDATE SET
          name = EXCLUDED.name,
          namespace_id = EXCLUDED.namespace_id,
          owner = EXCLUDED.owner,
          zonefile_hash = EXCLUDED.zonefile_hash,
          parent_zonefile_hash = EXCLUDED.parent_zonefile_hash,
          parent_zonefile_index = EXCLUDED.parent_zonefile_index,
          block_height = EXCLUDED.block_height,
          tx_index = EXCLUDED.tx_index,
          zonefile_offset = EXCLUDED.zonefile_offset,
          resolver = EXCLUDED.resolver,
          canonical = EXCLUDED.canonical,
          parent_index_block_hash = EXCLUDED.parent_index_block_hash,
          microblock_sequence = EXCLUDED.microblock_sequence,
          microblock_canonical = EXCLUDED.microblock_canonical
    `;
    if (result.count !== subdomainValues.length) {
      throw new Error(`Expected ${subdomainValues.length} subdomain inserts, got ${result.count}`);
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
    await this.sqlWriteTransaction(async sql => {
      await this.updateBatchSubdomains(sql, [{ blockData, subdomains: data }]);
      await this.updateBatchZonefiles(sql, [{ blockData, subdomains: data }]);
    });
  }

  async updateStxEvent(sql: PgSqlClient, tx: DbTx, event: DbStxEvent) {
    const values: StxEventInsertValues = {
      event_index: event.event_index,
      tx_id: event.tx_id,
      tx_index: event.tx_index,
      block_height: event.block_height,
      index_block_hash: tx.index_block_hash,
      parent_index_block_hash: tx.parent_index_block_hash,
      microblock_hash: tx.microblock_hash,
      microblock_sequence: tx.microblock_sequence,
      microblock_canonical: tx.microblock_canonical,
      canonical: event.canonical,
      asset_event_type_id: event.asset_event_type_id,
      sender: event.sender ?? null,
      recipient: event.recipient ?? null,
      amount: event.amount,
      memo: event.memo ?? null,
    };
    await sql`
      INSERT INTO stx_events ${sql(values)}
    `;
  }

  async updateFtEvents(sql: PgSqlClient, tx: DbTx, events: DbFtEvent[]) {
    for (const batch of batchIterate(events, INSERT_BATCH_SIZE)) {
      const values: FtEventInsertValues[] = batch.map(event => ({
        event_index: event.event_index,
        tx_id: event.tx_id,
        tx_index: event.tx_index,
        block_height: event.block_height,
        index_block_hash: tx.index_block_hash,
        parent_index_block_hash: tx.parent_index_block_hash,
        microblock_hash: tx.microblock_hash,
        microblock_sequence: tx.microblock_sequence,
        microblock_canonical: tx.microblock_canonical,
        canonical: event.canonical,
        asset_event_type_id: event.asset_event_type_id,
        sender: event.sender ?? null,
        recipient: event.recipient ?? null,
        asset_identifier: event.asset_identifier,
        amount: event.amount.toString(),
      }));
      await sql`
        INSERT INTO ft_events ${sql(values)}
      `;
    }
  }

  async updateNftEvents(
    sql: PgSqlClient,
    tx: DbTx,
    events: DbNftEvent[],
    microblock: boolean = false
  ) {
    for (const batch of batchIterate(events, INSERT_BATCH_SIZE)) {
      const custodyInsertsMap = new Map<string, NftCustodyInsertValues>();
      const nftEventInserts: NftEventInsertValues[] = [];
      for (const event of batch) {
        const custodyItem: NftCustodyInsertValues = {
          asset_identifier: event.asset_identifier,
          value: event.value,
          tx_id: event.tx_id,
          index_block_hash: tx.index_block_hash,
          parent_index_block_hash: tx.parent_index_block_hash,
          microblock_hash: tx.microblock_hash,
          microblock_sequence: tx.microblock_sequence,
          recipient: event.recipient ?? null,
          event_index: event.event_index,
          tx_index: event.tx_index,
          block_height: event.block_height,
        };
        // Avoid duplicates on NFT custody inserts, because we could run into an `ON CONFLICT DO
        // UPDATE command cannot affect row a second time` error otherwise.
        const custodyKey = `${event.asset_identifier}_${event.value}`;
        const currCustody = custodyInsertsMap.get(custodyKey);
        if (currCustody) {
          if (
            custodyItem.block_height > currCustody.block_height ||
            (custodyItem.block_height == currCustody.block_height &&
              custodyItem.microblock_sequence > currCustody.microblock_sequence) ||
            (custodyItem.block_height == currCustody.block_height &&
              custodyItem.microblock_sequence == currCustody.microblock_sequence &&
              custodyItem.tx_index > currCustody.tx_index) ||
            (custodyItem.block_height == currCustody.block_height &&
              custodyItem.microblock_sequence == currCustody.microblock_sequence &&
              custodyItem.tx_index == currCustody.tx_index &&
              custodyItem.event_index > currCustody.event_index)
          ) {
            custodyInsertsMap.set(custodyKey, custodyItem);
          }
        } else {
          custodyInsertsMap.set(custodyKey, custodyItem);
        }
        const valuesItem: NftEventInsertValues = {
          ...custodyItem,
          microblock_canonical: tx.microblock_canonical,
          canonical: event.canonical,
          sender: event.sender ?? null,
          asset_event_type_id: event.asset_event_type_id,
        };
        nftEventInserts.push(valuesItem);
      }
      await sql`
        INSERT INTO nft_events ${sql(nftEventInserts)}
      `;
      if (tx.canonical && tx.microblock_canonical) {
        const table = microblock ? sql`nft_custody_unanchored` : sql`nft_custody`;
        await sql`
          INSERT INTO ${table} ${sql(Array.from(custodyInsertsMap.values()))}
          ON CONFLICT ON CONSTRAINT ${table}_unique DO UPDATE SET
            tx_id = EXCLUDED.tx_id,
            index_block_hash = EXCLUDED.index_block_hash,
            parent_index_block_hash = EXCLUDED.parent_index_block_hash,
            microblock_hash = EXCLUDED.microblock_hash,
            microblock_sequence = EXCLUDED.microblock_sequence,
            recipient = EXCLUDED.recipient,
            event_index = EXCLUDED.event_index,
            tx_index = EXCLUDED.tx_index,
            block_height = EXCLUDED.block_height
          WHERE
            (
              EXCLUDED.block_height > ${table}.block_height
            )
            OR (
              EXCLUDED.block_height = ${table}.block_height
              AND EXCLUDED.microblock_sequence > ${table}.microblock_sequence
            )
            OR (
              EXCLUDED.block_height = ${table}.block_height
              AND EXCLUDED.microblock_sequence = ${table}.microblock_sequence
              AND EXCLUDED.tx_index > ${table}.tx_index
            )
            OR (
              EXCLUDED.block_height = ${table}.block_height
              AND EXCLUDED.microblock_sequence = ${table}.microblock_sequence
              AND EXCLUDED.tx_index = ${table}.tx_index
              AND EXCLUDED.event_index > ${table}.event_index
            )
        `;
      }
    }
  }

  async updateSmartContractEvents(sql: PgSqlClient, tx: DbTx, events: DbSmartContractEvent[]) {
    for (const eventBatch of batchIterate(events, INSERT_BATCH_SIZE)) {
      const values: SmartContractEventInsertValues[] = eventBatch.map(event => ({
        event_index: event.event_index,
        tx_id: event.tx_id,
        tx_index: event.tx_index,
        block_height: event.block_height,
        index_block_hash: tx.index_block_hash,
        parent_index_block_hash: tx.parent_index_block_hash,
        microblock_hash: tx.microblock_hash,
        microblock_sequence: tx.microblock_sequence,
        microblock_canonical: tx.microblock_canonical,
        canonical: event.canonical,
        contract_identifier: event.contract_identifier,
        topic: event.topic,
        value: event.value,
      }));
      const res = await sql`
        INSERT INTO contract_logs ${sql(values)}
      `;
      if (res.count !== eventBatch.length) {
        throw new Error(`Expected ${eventBatch.length} inserts, got ${res.count}`);
      }
    }
  }

  async updateSmartContractEvent(sql: PgSqlClient, tx: DbTx, event: DbSmartContractEvent) {
    const values: SmartContractEventInsertValues = {
      event_index: event.event_index,
      tx_id: event.tx_id,
      tx_index: event.tx_index,
      block_height: event.block_height,
      index_block_hash: tx.index_block_hash,
      parent_index_block_hash: tx.parent_index_block_hash,
      microblock_hash: tx.microblock_hash,
      microblock_sequence: tx.microblock_sequence,
      microblock_canonical: tx.microblock_canonical,
      canonical: event.canonical,
      contract_identifier: event.contract_identifier,
      topic: event.topic,
      value: event.value,
    };
    await sql`
      INSERT INTO contract_logs ${sql(values)}
    `;
  }

  async updateAttachments(attachments: DataStoreAttachmentData[]): Promise<void> {
    await this.sqlWriteTransaction(async sql => {
      // Each attachment will batch insert zonefiles for name and all subdomains that apply.
      for (const attachment of attachments) {
        const subdomainData: DataStoreAttachmentSubdomainData[] = [];
        if (attachment.op === 'name-update') {
          // If this is a zonefile update, break it down into subdomains and update all of them. We
          // must find the correct transaction that registered the zonefile in the first place and
          // associate it with each entry.
          const zonefile = Buffer.from(attachment.zonefile, 'hex').toString();
          const zoneFileContents = zoneFileParser.parseZoneFile(zonefile);
          const zoneFileTxt = zoneFileContents.txt;
          if (zoneFileTxt && zoneFileTxt.length > 0) {
            const dbTx = await sql<TxQueryResult[]>`
              SELECT ${sql(TX_COLUMNS)} FROM txs
              WHERE tx_id = ${attachment.txId} AND index_block_hash = ${attachment.indexBlockHash}
              ORDER BY canonical DESC, microblock_canonical DESC, block_height DESC
              LIMIT 1
            `;
            let isCanonical = true;
            let txIndex = -1;
            const blockData: DataStoreBnsBlockData = {
              index_block_hash: '',
              parent_index_block_hash: '',
              microblock_hash: '',
              microblock_sequence: I32_MAX,
              microblock_canonical: true,
            };
            if (dbTx.count > 0) {
              const parsedDbTx = parseTxQueryResult(dbTx[0]);
              isCanonical = parsedDbTx.canonical;
              txIndex = parsedDbTx.tx_index;
              blockData.index_block_hash = parsedDbTx.index_block_hash;
              blockData.parent_index_block_hash = parsedDbTx.parent_index_block_hash;
              blockData.microblock_hash = parsedDbTx.microblock_hash;
              blockData.microblock_sequence = parsedDbTx.microblock_sequence;
              blockData.microblock_canonical = parsedDbTx.microblock_canonical;
            } else {
              logger.warn(
                `Could not find transaction ${attachment.txId} associated with attachment`
              );
            }
            const subdomains: DbBnsSubdomain[] = [];
            for (let i = 0; i < zoneFileTxt.length; i++) {
              const zoneFile = zoneFileTxt[i];
              const parsedTxt = parseZoneFileTxt(zoneFile.txt);
              if (parsedTxt.owner === '') continue; //if txt has no owner , skip it
              const subdomain: DbBnsSubdomain = {
                name: attachment.name.concat('.', attachment.namespace),
                namespace_id: attachment.namespace,
                fully_qualified_subdomain: zoneFile.name.concat(
                  '.',
                  attachment.name,
                  '.',
                  attachment.namespace
                ),
                owner: parsedTxt.owner,
                zonefile_hash: parsedTxt.zoneFileHash,
                zonefile: parsedTxt.zoneFile,
                tx_id: attachment.txId,
                tx_index: txIndex,
                canonical: isCanonical,
                parent_zonefile_hash: attachment.zonefileHash.slice(2),
                parent_zonefile_index: 0,
                block_height: attachment.blockHeight,
                zonefile_offset: 1,
                resolver: zoneFileContents.uri ? parseResolver(zoneFileContents.uri) : '',
              };
              subdomains.push(subdomain);
            }
            subdomainData.push({ blockData, subdomains, attachment: attachment });
          }
        }
        await this.updateBatchSubdomains(sql, subdomainData);
        await this.updateBatchZonefiles(sql, subdomainData);
        // Update the name's zonefile as well.
        await this.updateBatchZonefiles(sql, [{ attachment }]);
      }
    });
    for (const txId of attachments.map(a => a.txId)) {
      await this.notifier?.sendName({ nameInfo: txId });
    }
  }

  async updateMicroCanonical(
    sql: PgSqlClient,
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
      const microblockTipQuery = await sql<MicroblockQueryResult[]>`
        SELECT ${sql(MICROBLOCK_COLUMNS)} FROM microblocks
        WHERE parent_index_block_hash = ${blockData.parentIndexBlockHash}
        AND microblock_hash = ${blockData.parentMicroblockHash}
      `;
      if (microblockTipQuery.length === 0) {
        throw new Error(
          `Could not find microblock ${blockData.parentMicroblockHash} while processing anchor block chain tip`
        );
      }
      acceptedMicroblockTip = parseMicroblockQueryResult(microblockTipQuery[0]);
    }

    // Identify microblocks that were either accepted or orphaned by this anchor block.
    const unanchoredMicroblocksAtTip = await this.findUnanchoredMicroblocksAtChainTip(
      sql,
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
      const microOrphanResult = await this.handleMicroReorg(sql, {
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
      const microAcceptResult = await this.handleMicroReorg(sql, {
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

  async updateBurnchainRewards({
    burnchainBlockHash,
    burnchainBlockHeight,
    rewards,
  }: {
    burnchainBlockHash: string;
    burnchainBlockHeight: number;
    rewards: DbBurnchainReward[];
  }): Promise<void> {
    return await this.sqlWriteTransaction(async sql => {
      const existingRewards = await sql<
        {
          reward_recipient: string;
          reward_amount: string;
        }[]
      >`
        UPDATE burnchain_rewards
        SET canonical = false
        WHERE canonical = true AND
          (burn_block_hash = ${burnchainBlockHash}
            OR burn_block_height >= ${burnchainBlockHeight})
      `;

      if (existingRewards.count > 0) {
        logger.warn(
          `Invalidated ${existingRewards.count} burnchain rewards after fork detected at burnchain block ${burnchainBlockHash}`
        );
      }

      for (const reward of rewards) {
        const values: BurnchainRewardInsertValues = {
          canonical: true,
          burn_block_hash: reward.burn_block_hash,
          burn_block_height: reward.burn_block_height,
          burn_amount: reward.burn_amount.toString(),
          reward_recipient: reward.reward_recipient,
          reward_amount: reward.reward_amount,
          reward_index: reward.reward_index,
        };
        const rewardInsertResult = await sql`
          INSERT into burnchain_rewards ${sql(values)}
        `;
        if (rewardInsertResult.count !== 1) {
          throw new Error(`Failed to insert burnchain reward at block ${reward.burn_block_hash}`);
        }
      }
    });
  }

  async insertSlotHoldersBatch(sql: PgSqlClient, slotHolders: DbRewardSlotHolder[]): Promise<void> {
    const slotValues: RewardSlotHolderInsertValues[] = slotHolders.map(slot => ({
      canonical: true,
      burn_block_hash: slot.burn_block_hash,
      burn_block_height: slot.burn_block_height,
      address: slot.address,
      slot_index: slot.slot_index,
    }));

    const result = await sql`
      INSERT INTO reward_slot_holders ${sql(slotValues)}
    `;

    if (result.count !== slotValues.length) {
      throw new Error(`Failed to insert slot holder for ${slotValues}`);
    }
  }

  async insertBurnchainRewardsBatch(sql: PgSqlClient, rewards: DbBurnchainReward[]): Promise<void> {
    const rewardValues: BurnchainRewardInsertValues[] = rewards.map(reward => ({
      canonical: true,
      burn_block_hash: reward.burn_block_hash,
      burn_block_height: reward.burn_block_height,
      burn_amount: reward.burn_amount.toString(),
      reward_recipient: reward.reward_recipient,
      reward_amount: reward.reward_amount,
      reward_index: reward.reward_index,
    }));

    const res = await sql`
      INSERT into burnchain_rewards ${sql(rewardValues)}
    `;

    if (res.count !== rewardValues.length) {
      throw new Error(`Failed to insert burnchain reward for ${rewardValues}`);
    }
  }

  async updateTx(sql: PgSqlClient, tx: DbTxRaw): Promise<number> {
    const values: TxInsertValues = {
      tx_id: tx.tx_id,
      raw_tx: tx.raw_tx,
      tx_index: tx.tx_index,
      index_block_hash: tx.index_block_hash,
      parent_index_block_hash: tx.parent_index_block_hash,
      block_hash: tx.block_hash,
      parent_block_hash: tx.parent_block_hash,
      block_height: tx.block_height,
      burn_block_time: tx.burn_block_time,
      parent_burn_block_time: tx.parent_burn_block_time,
      type_id: tx.type_id,
      anchor_mode: tx.anchor_mode,
      status: tx.status,
      canonical: tx.canonical,
      post_conditions: tx.post_conditions,
      nonce: tx.nonce,
      fee_rate: tx.fee_rate,
      sponsored: tx.sponsored,
      sponsor_nonce: tx.sponsor_nonce ?? null,
      sponsor_address: tx.sponsor_address ?? null,
      sender_address: tx.sender_address,
      origin_hash_mode: tx.origin_hash_mode,
      microblock_canonical: tx.microblock_canonical,
      microblock_sequence: tx.microblock_sequence,
      microblock_hash: tx.microblock_hash,
      token_transfer_recipient_address: tx.token_transfer_recipient_address ?? null,
      token_transfer_amount: tx.token_transfer_amount ?? null,
      token_transfer_memo: tx.token_transfer_memo ?? null,
      smart_contract_clarity_version: tx.smart_contract_clarity_version ?? null,
      smart_contract_contract_id: tx.smart_contract_contract_id ?? null,
      smart_contract_source_code: tx.smart_contract_source_code ?? null,
      contract_call_contract_id: tx.contract_call_contract_id ?? null,
      contract_call_function_name: tx.contract_call_function_name ?? null,
      contract_call_function_args: tx.contract_call_function_args ?? null,
      poison_microblock_header_1: tx.poison_microblock_header_1 ?? null,
      poison_microblock_header_2: tx.poison_microblock_header_2 ?? null,
      coinbase_payload: tx.coinbase_payload ?? null,
      coinbase_alt_recipient: tx.coinbase_alt_recipient ?? null,
      coinbase_vrf_proof: tx.coinbase_vrf_proof ?? null,
      tenure_change_tenure_consensus_hash: tx.tenure_change_tenure_consensus_hash ?? null,
      tenure_change_prev_tenure_consensus_hash: tx.tenure_change_prev_tenure_consensus_hash ?? null,
      tenure_change_burn_view_consensus_hash: tx.tenure_change_burn_view_consensus_hash ?? null,
      tenure_change_previous_tenure_end: tx.tenure_change_previous_tenure_end ?? null,
      tenure_change_previous_tenure_blocks: tx.tenure_change_previous_tenure_blocks ?? null,
      tenure_change_cause: tx.tenure_change_cause ?? null,
      tenure_change_pubkey_hash: tx.tenure_change_pubkey_hash ?? null,
      tenure_change_signature: tx.tenure_change_signature ?? null,
      tenure_change_signers: tx.tenure_change_signers ?? null,
      raw_result: tx.raw_result,
      event_count: tx.event_count,
      execution_cost_read_count: tx.execution_cost_read_count,
      execution_cost_read_length: tx.execution_cost_read_length,
      execution_cost_runtime: tx.execution_cost_runtime,
      execution_cost_write_count: tx.execution_cost_write_count,
      execution_cost_write_length: tx.execution_cost_write_length,
    };
    const result = await sql`
      INSERT INTO txs ${sql(values)}
      ON CONFLICT ON CONSTRAINT unique_tx_id_index_block_hash_microblock_hash DO NOTHING
    `;
    return result.count;
  }

  async insertDbMempoolTxs(
    txs: DbMempoolTxRaw[],
    chainTip: DbChainTip,
    sql: PgSqlClient
  ): Promise<string[]> {
    const txIds: string[] = [];
    for (const batch of batchIterate(txs, INSERT_BATCH_SIZE)) {
      const values: MempoolTxInsertValues[] = batch.map(tx => ({
        pruned: tx.pruned,
        tx_id: tx.tx_id,
        raw_tx: tx.raw_tx,
        type_id: tx.type_id,
        anchor_mode: tx.anchor_mode,
        status: tx.status,
        receipt_time: tx.receipt_time,
        receipt_block_height: chainTip.block_height,
        post_conditions: tx.post_conditions,
        nonce: tx.nonce,
        fee_rate: tx.fee_rate,
        sponsored: tx.sponsored,
        sponsor_nonce: tx.sponsor_nonce ?? null,
        sponsor_address: tx.sponsor_address ?? null,
        sender_address: tx.sender_address,
        origin_hash_mode: tx.origin_hash_mode,
        token_transfer_recipient_address: tx.token_transfer_recipient_address ?? null,
        token_transfer_amount: tx.token_transfer_amount ?? null,
        token_transfer_memo: tx.token_transfer_memo ?? null,
        smart_contract_clarity_version: tx.smart_contract_clarity_version ?? null,
        smart_contract_contract_id: tx.smart_contract_contract_id ?? null,
        smart_contract_source_code: tx.smart_contract_source_code ?? null,
        contract_call_contract_id: tx.contract_call_contract_id ?? null,
        contract_call_function_name: tx.contract_call_function_name ?? null,
        contract_call_function_args: tx.contract_call_function_args ?? null,
        poison_microblock_header_1: tx.poison_microblock_header_1 ?? null,
        poison_microblock_header_2: tx.poison_microblock_header_2 ?? null,
        coinbase_payload: tx.coinbase_payload ?? null,
        coinbase_alt_recipient: tx.coinbase_alt_recipient ?? null,
        coinbase_vrf_proof: tx.coinbase_vrf_proof ?? null,
        tenure_change_tenure_consensus_hash: tx.tenure_change_tenure_consensus_hash ?? null,
        tenure_change_prev_tenure_consensus_hash:
          tx.tenure_change_prev_tenure_consensus_hash ?? null,
        tenure_change_burn_view_consensus_hash: tx.tenure_change_burn_view_consensus_hash ?? null,
        tenure_change_previous_tenure_end: tx.tenure_change_previous_tenure_end ?? null,
        tenure_change_previous_tenure_blocks: tx.tenure_change_previous_tenure_blocks ?? null,
        tenure_change_cause: tx.tenure_change_cause ?? null,
        tenure_change_pubkey_hash: tx.tenure_change_pubkey_hash ?? null,
        tenure_change_signature: tx.tenure_change_signature ?? null,
        tenure_change_signers: tx.tenure_change_signers ?? null,
      }));
      const result = await sql<{ tx_id: string }[]>`
        WITH inserted AS (
          INSERT INTO mempool_txs ${sql(values)}
          ON CONFLICT ON CONSTRAINT unique_tx_id DO NOTHING
          RETURNING tx_id
        ),
        count_update AS (
          UPDATE chain_tip SET
            mempool_tx_count = mempool_tx_count + (SELECT COUNT(*) FROM inserted),
            mempool_updated_at = NOW()
        )
        SELECT tx_id FROM inserted
      `;
      txIds.push(...result.map(r => r.tx_id));
      // The incoming mempool transactions might have already been settled
      // We need to mark them as pruned to avoid inconsistent tx state
      const pruned_tx = await sql<{ tx_id: string }[]>`
        SELECT tx_id
        FROM txs
        WHERE
          tx_id IN ${sql(batch.map(b => b.tx_id))} AND
          canonical = true AND
          microblock_canonical = true`;
      if (pruned_tx.length > 0) {
        await sql<{ tx_id: string }[]>`
          WITH pruned AS (
            UPDATE mempool_txs
            SET pruned = true
            WHERE
              tx_id IN ${sql(pruned_tx.map(t => t.tx_id))} AND
              pruned = false
            RETURNING tx_id
          ),
          count_update AS (
            UPDATE chain_tip SET
              mempool_tx_count = mempool_tx_count - (SELECT COUNT(*) FROM pruned),
              mempool_updated_at = NOW()
          )
          SELECT tx_id FROM pruned`;
      }
    }
    return txIds;
  }

  private _debounceMempoolStat: {
    triggeredAt?: number | null;
    debounce?: NodeJS.Timeout | null;
    running: boolean;
  } = { running: false };
  /**
   * Debounce the mempool stat process in case new transactions pour in.
   */
  private debounceMempoolStat() {
    if (this._debounceMempoolStat.triggeredAt == null) {
      this._debounceMempoolStat.triggeredAt = Date.now();
    }
    if (this._debounceMempoolStat.running) return;
    const waited = Date.now() - this._debounceMempoolStat.triggeredAt;
    const delay = Math.max(
      0,
      Math.min(MEMPOOL_STATS_DEBOUNCE_MAX_INTERVAL - waited, MEMPOOL_STATS_DEBOUNCE_INTERVAL)
    );
    if (this._debounceMempoolStat.debounce != null) {
      clearTimeout(this._debounceMempoolStat.debounce);
    }
    this._debounceMempoolStat.debounce = setTimeout(async () => {
      this._debounceMempoolStat.running = true;
      this._debounceMempoolStat.triggeredAt = null;
      try {
        const mempoolStats = await this.getMempoolStatsInternal({ sql: this.sql });
        this.eventEmitter.emit('mempoolStatsUpdate', mempoolStats);
      } catch (e) {
        logger.error(e, `failed to run mempool stats update`);
      } finally {
        this._debounceMempoolStat.running = false;
        this._debounceMempoolStat.debounce = null;
        if (this._debounceMempoolStat.triggeredAt != null) {
          this.debounceMempoolStat();
        }
      }
    }, delay);
  }

  async updateMempoolTxs({ mempoolTxs: txs }: { mempoolTxs: DbMempoolTxRaw[] }): Promise<void> {
    const updatedTxIds: string[] = [];
    await this.sqlWriteTransaction(async sql => {
      const chainTip = await this.getChainTip();
      updatedTxIds.push(...(await this.insertDbMempoolTxs(txs, chainTip, sql)));
    });
    if (!this.isEventReplay) {
      this.debounceMempoolStat();
    }
    for (const txId of updatedTxIds) {
      await this.notifier?.sendTx({ txId });
    }
  }

  async dropMempoolTxs({ status, txIds }: { status: DbTxStatus; txIds: string[] }): Promise<void> {
    const updateResults = await this.sql<{ tx_id: string }[]>`
      WITH pruned AS (
        UPDATE mempool_txs
        SET pruned = TRUE, status = ${status}
        WHERE tx_id IN ${this.sql(txIds)} AND pruned = FALSE
        RETURNING tx_id
      ),
      count_update AS (
        UPDATE chain_tip SET
          mempool_tx_count = mempool_tx_count - (SELECT COUNT(*) FROM pruned),
          mempool_updated_at = NOW()
      )
      SELECT tx_id FROM pruned
    `;
    for (const txId of updateResults.map(r => r.tx_id)) {
      await this.notifier?.sendTx({ txId });
    }
  }

  async updateSmartContracts(sql: PgSqlClient, tx: DbTx, smartContracts: DbSmartContract[]) {
    for (const batch of batchIterate(smartContracts, INSERT_BATCH_SIZE)) {
      const values: SmartContractInsertValues[] = batch.map(smartContract => ({
        tx_id: smartContract.tx_id,
        canonical: smartContract.canonical,
        clarity_version: smartContract.clarity_version,
        contract_id: smartContract.contract_id,
        block_height: smartContract.block_height,
        index_block_hash: tx.index_block_hash,
        source_code: smartContract.source_code,
        abi: smartContract.abi ? JSON.parse(smartContract.abi) ?? 'null' : 'null',
        parent_index_block_hash: tx.parent_index_block_hash,
        microblock_hash: tx.microblock_hash,
        microblock_sequence: tx.microblock_sequence,
        microblock_canonical: tx.microblock_canonical,
      }));
      await sql`
        INSERT INTO smart_contracts ${sql(values)}
      `;
    }
  }

  async updateNames(sql: PgSqlClient, tx: DataStoreBnsBlockTxData, names: DbBnsName[]) {
    // TODO: Move these to CTE queries for optimization
    for (const bnsName of names) {
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
        event_index,
        status,
        canonical,
      } = bnsName;
      // Try to figure out the name's expiration block based on its namespace's lifetime.
      let expireBlock = expire_block;
      const namespaceLifetime = await sql<{ lifetime: number }[]>`
        SELECT lifetime
        FROM namespaces
        WHERE namespace_id = ${namespace_id}
        AND canonical = true AND microblock_canonical = true
        ORDER BY namespace_id, ready_block DESC, microblock_sequence DESC, tx_index DESC
        LIMIT 1
      `;
      if (namespaceLifetime.length > 0) {
        expireBlock = registered_at + namespaceLifetime[0].lifetime;
      }
      // If the name was transferred, keep the expiration from the last register/renewal we had (if
      // any).
      if (status === 'name-transfer') {
        const prevExpiration = await sql<{ expire_block: number }[]>`
          SELECT expire_block
          FROM names
          WHERE name = ${name}
            AND canonical = TRUE AND microblock_canonical = TRUE
          ORDER BY registered_at DESC, microblock_sequence DESC, tx_index DESC
          LIMIT 1
        `;
        if (prevExpiration.length > 0) {
          expireBlock = prevExpiration[0].expire_block;
        }
      }
      // If we didn't receive a zonefile, keep the last valid one.
      let finalZonefile = zonefile;
      let finalZonefileHash = zonefile_hash;
      if (finalZonefileHash === '') {
        const lastZonefile = await sql<{ zonefile: string; zonefile_hash: string }[]>`
          SELECT z.zonefile, z.zonefile_hash
          FROM zonefiles AS z
          INNER JOIN names AS n USING (name, tx_id, index_block_hash)
          WHERE z.name = ${name}
            AND n.canonical = TRUE
            AND n.microblock_canonical = TRUE
          ORDER BY n.registered_at DESC, n.microblock_sequence DESC, n.tx_index DESC
          LIMIT 1
        `;
        if (lastZonefile.length > 0) {
          finalZonefile = lastZonefile[0].zonefile;
          finalZonefileHash = lastZonefile[0].zonefile_hash;
        }
      }
      const validZonefileHash = validateZonefileHash(finalZonefileHash);
      const zonefileValues: BnsZonefileInsertValues = {
        name: name,
        zonefile: finalZonefile,
        zonefile_hash: validZonefileHash,
        tx_id: tx_id,
        index_block_hash: tx.index_block_hash,
      };
      await sql`
        INSERT INTO zonefiles ${sql(zonefileValues)}
        ON CONFLICT ON CONSTRAINT unique_name_zonefile_hash_tx_id_index_block_hash DO
          UPDATE SET zonefile = EXCLUDED.zonefile
      `;
      const nameValues: BnsNameInsertValues = {
        name: name,
        address: address,
        registered_at: registered_at,
        expire_block: expireBlock,
        zonefile_hash: validZonefileHash,
        namespace_id: namespace_id,
        tx_index: tx_index,
        tx_id: tx_id,
        event_index: event_index ?? null,
        status: status ?? null,
        canonical: canonical,
        index_block_hash: tx.index_block_hash,
        parent_index_block_hash: tx.parent_index_block_hash,
        microblock_hash: tx.microblock_hash,
        microblock_sequence: tx.microblock_sequence,
        microblock_canonical: tx.microblock_canonical,
      };
      await sql`
        INSERT INTO names ${sql(nameValues)}
        ON CONFLICT ON CONSTRAINT unique_name_tx_id_index_block_hash_microblock_hash_event_index DO
          UPDATE SET
            address = EXCLUDED.address,
            registered_at = EXCLUDED.registered_at,
            expire_block = EXCLUDED.expire_block,
            zonefile_hash = EXCLUDED.zonefile_hash,
            namespace_id = EXCLUDED.namespace_id,
            tx_index = EXCLUDED.tx_index,
            event_index = EXCLUDED.event_index,
            status = EXCLUDED.status,
            canonical = EXCLUDED.canonical,
            parent_index_block_hash = EXCLUDED.parent_index_block_hash,
            microblock_sequence = EXCLUDED.microblock_sequence,
            microblock_canonical = EXCLUDED.microblock_canonical
      `;
    }
  }

  async updateNamespaces(
    sql: PgSqlClient,
    tx: DataStoreBnsBlockTxData,
    namespaces: DbBnsNamespace[]
  ) {
    for (const batch of batchIterate(namespaces, INSERT_BATCH_SIZE)) {
      const values: BnsNamespaceInsertValues[] = batch.map(namespace => ({
        namespace_id: namespace.namespace_id,
        launched_at: namespace.launched_at ?? null,
        address: namespace.address,
        reveal_block: namespace.reveal_block,
        ready_block: namespace.ready_block,
        buckets: namespace.buckets,
        base: namespace.base.toString(),
        coeff: namespace.coeff.toString(),
        nonalpha_discount: namespace.nonalpha_discount.toString(),
        no_vowel_discount: namespace.no_vowel_discount.toString(),
        lifetime: namespace.lifetime,
        status: namespace.status ?? null,
        tx_index: namespace.tx_index,
        tx_id: namespace.tx_id,
        canonical: namespace.canonical,
        index_block_hash: tx.index_block_hash,
        parent_index_block_hash: tx.parent_index_block_hash,
        microblock_hash: tx.microblock_hash,
        microblock_sequence: tx.microblock_sequence,
        microblock_canonical: tx.microblock_canonical,
      }));
      await sql`
        INSERT INTO namespaces ${sql(values)}
        ON CONFLICT ON CONSTRAINT unique_namespace_id_tx_id_index_block_hash_microblock_hash DO
          UPDATE SET
            launched_at = EXCLUDED.launched_at,
            address = EXCLUDED.address,
            reveal_block = EXCLUDED.reveal_block,
            ready_block = EXCLUDED.ready_block,
            buckets = EXCLUDED.buckets,
            base = EXCLUDED.base,
            coeff = EXCLUDED.coeff,
            nonalpha_discount = EXCLUDED.nonalpha_discount,
            no_vowel_discount = EXCLUDED.no_vowel_discount,
            lifetime = EXCLUDED.lifetime,
            status = EXCLUDED.status,
            tx_index = EXCLUDED.tx_index,
            canonical = EXCLUDED.canonical,
            parent_index_block_hash = EXCLUDED.parent_index_block_hash,
            microblock_sequence = EXCLUDED.microblock_sequence,
            microblock_canonical = EXCLUDED.microblock_canonical
      `;
    }
  }

  async updateBatchTokenOfferingLocked(sql: PgSqlClient, lockedInfos: DbTokenOfferingLocked[]) {
    try {
      const res = await sql`
        INSERT INTO token_offering_locked ${sql(lockedInfos, 'address', 'value', 'block')}
      `;
      if (res.count !== lockedInfos.length) {
        throw new Error(`Expected ${lockedInfos.length} inserts, got ${res.count}`);
      }
    } catch (e: any) {
      logger.error(e, `Locked Info errors ${e.message}`);
      throw e;
    }
  }

  async getConfigState(): Promise<DbConfigState> {
    const queryResult = await this.sql<DbConfigState[]>`SELECT * FROM config_state`;
    return queryResult[0];
  }

  async updateConfigState(configState: DbConfigState, sql?: PgSqlClient): Promise<void> {
    const queryResult = await (sql ?? this.sql)`
      UPDATE config_state SET
        bns_names_onchain_imported = ${configState.bns_names_onchain_imported},
        bns_subdomains_imported = ${configState.bns_subdomains_imported},
        token_offering_imported = ${configState.token_offering_imported}
    `;
    await this.notifier?.sendConfigState(configState);
    if (queryResult.count !== 1) {
      throw new Error(`Unexpected config update row count: ${queryResult.count}`);
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
        case DbTxTypeId.VersionedSmartContract:
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
    try {
      const values: FaucetRequestInsertValues = {
        currency: faucetRequest.currency,
        address: faucetRequest.address,
        ip: faucetRequest.ip,
        occurred_at: faucetRequest.occurred_at,
      };
      await this.sql`
        INSERT INTO faucet_requests ${this.sql(values)}
      `;
    } catch (error) {
      logger.error(error, `Error performing faucet request update: ${error}`);
      throw error;
    }
  }

  async insertMicroblockData(
    sql: PgSqlClient,
    microblocks: DbMicroblock[],
    txs: DataStoreTxEventData[]
  ): Promise<void> {
    for (const mb of microblocks) {
      const values: MicroblockInsertValues = {
        canonical: mb.canonical,
        microblock_canonical: mb.microblock_canonical,
        microblock_hash: mb.microblock_hash,
        microblock_sequence: mb.microblock_sequence,
        microblock_parent_hash: mb.microblock_parent_hash,
        parent_index_block_hash: mb.parent_index_block_hash,
        block_height: mb.block_height,
        parent_block_height: mb.parent_block_height,
        parent_block_hash: mb.parent_block_hash,
        index_block_hash: mb.index_block_hash,
        block_hash: mb.block_hash,
        parent_burn_block_height: mb.parent_burn_block_height,
        parent_burn_block_hash: mb.parent_burn_block_hash,
        parent_burn_block_time: mb.parent_burn_block_time,
      };
      const mbResult = await sql`
        INSERT INTO microblocks ${sql(values)}
        ON CONFLICT ON CONSTRAINT unique_microblock_hash DO NOTHING
      `;
      if (mbResult.count !== 1) {
        const errMsg = `A duplicate microblock was attempted to be inserted into the microblocks table: ${mb.microblock_hash}`;
        logger.warn(errMsg);
        // A duplicate microblock entry really means we received a duplicate `/new_microblocks` node event.
        // We will ignore this whole microblock data entry in this case.
        return;
      }
    }

    for (const entry of txs) {
      const rowsUpdated = await this.updateTx(sql, entry.tx);
      if (rowsUpdated !== 1) {
        throw new Error(
          `Unexpected amount of rows updated for microblock tx insert: ${rowsUpdated}`
        );
      }

      await this.updateStxEvents(sql, entry.tx, entry.stxEvents);
      await this.updatePrincipalStxTxs(sql, entry.tx, entry.stxEvents);
      await this.updateSmartContractEvents(sql, entry.tx, entry.contractLogEvents);
      await this.updatePoxSyntheticEvents(sql, entry.tx, 'pox2_events', entry.pox2Events);
      await this.updatePoxSyntheticEvents(sql, entry.tx, 'pox3_events', entry.pox3Events);
      await this.updatePoxSyntheticEvents(sql, entry.tx, 'pox4_events', entry.pox4Events);
      await this.updateStxLockEvents(sql, entry.tx, entry.stxLockEvents);
      await this.updateFtEvents(sql, entry.tx, entry.ftEvents);
      await this.updateNftEvents(sql, entry.tx, entry.nftEvents, true);
      await this.updateSmartContracts(sql, entry.tx, entry.smartContracts);
      await this.updateNamespaces(sql, entry.tx, entry.namespaces);
      await this.updateNames(sql, entry.tx, entry.names);
    }
  }

  async handleMicroReorg(
    sql: PgSqlClient,
    args: {
      isCanonical: boolean;
      isMicroCanonical: boolean;
      indexBlockHash: string;
      blockHash: string;
      burnBlockTime: number;
      microblocks: string[];
    }
  ): Promise<{ updatedTxs: DbTx[] }> {
    // Flag orphaned microblock rows as `microblock_canonical=false`
    const updatedMicroblocksQuery = await sql`
      UPDATE microblocks
      SET microblock_canonical = ${args.isMicroCanonical}, canonical = ${args.isCanonical},
        index_block_hash = ${args.indexBlockHash}, block_hash = ${args.blockHash}
      WHERE microblock_hash IN ${sql(args.microblocks)}
    `;
    if (updatedMicroblocksQuery.count !== args.microblocks.length) {
      throw new Error(`Unexpected number of rows updated when setting microblock_canonical`);
    }

    // Identify microblock transactions that were orphaned or accepted by this anchor block,
    // and update `microblock_canonical`, `canonical`, as well as anchor block data that may be missing
    // for unanchored entires.
    const updatedMbTxsQuery = await sql<TxQueryResult[]>`
      UPDATE txs
      SET microblock_canonical = ${args.isMicroCanonical},
        canonical = ${args.isCanonical}, index_block_hash = ${args.indexBlockHash},
        block_hash = ${args.blockHash}, burn_block_time = ${args.burnBlockTime}
      WHERE microblock_hash IN ${sql(args.microblocks)}
        AND (index_block_hash = ${args.indexBlockHash} OR index_block_hash = '\\x'::bytea)
      RETURNING ${sql(TX_COLUMNS)}
    `;
    // Any txs restored need to be pruned from the mempool
    const updatedMbTxs = updatedMbTxsQuery.map(r => parseTxQueryResult(r));
    const txsToPrune = updatedMbTxs
      .filter(tx => tx.canonical && tx.microblock_canonical)
      .map(tx => tx.tx_id);
    const removedTxsResult = await this.pruneMempoolTxs(sql, txsToPrune);
    if (removedTxsResult.removedTxs.length > 0) {
      logger.debug(
        `Removed ${removedTxsResult.removedTxs.length} txs from mempool table during micro-reorg handling`
      );
    }

    // Update the `index_block_hash` and `microblock_canonical` properties on all the tables containing other
    // microblock-tx metadata that have been accepted or orphaned in this anchor block.
    if (updatedMbTxs.length > 0) {
      const txIds = updatedMbTxs.map(tx => tx.tx_id);
      for (const associatedTableName of TX_METADATA_TABLES) {
        await sql`
          UPDATE ${sql(associatedTableName)}
          SET microblock_canonical = ${args.isMicroCanonical},
            canonical = ${args.isCanonical}, index_block_hash = ${args.indexBlockHash}
          WHERE microblock_hash IN ${sql(args.microblocks)}
            AND (index_block_hash = ${args.indexBlockHash} OR index_block_hash = '\\x'::bytea)
            AND tx_id IN ${sql(txIds)}
        `;
      }
      await sql`
        UPDATE principal_stx_txs
        SET microblock_canonical = ${args.isMicroCanonical},
          canonical = ${args.isCanonical}, index_block_hash = ${args.indexBlockHash}
        WHERE microblock_hash IN ${sql(args.microblocks)}
          AND (index_block_hash = ${args.indexBlockHash} OR index_block_hash = '\\x'::bytea)
          AND tx_id IN ${sql(txIds)}
      `;
      await this.updateNftCustodyFromReOrg(sql, {
        index_block_hash: args.indexBlockHash,
        microblocks: args.microblocks,
      });
    }

    // Update unanchored tx count in `chain_tip` table
    const txCountDelta = updatedMbTxs.length * (args.isMicroCanonical ? 1 : -1);
    await sql`
      UPDATE chain_tip SET tx_count_unanchored = tx_count_unanchored + ${txCountDelta}
    `;

    return { updatedTxs: updatedMbTxs };
  }

  /**
   * Refreshes NFT custody data for events within a block or series of microblocks.
   * @param sql - SQL client
   * @param args - Block and microblock hashes
   */
  async updateNftCustodyFromReOrg(
    sql: PgSqlClient,
    args: {
      index_block_hash: string;
      microblocks: string[];
    }
  ): Promise<void> {
    for (const table of [sql`nft_custody`, sql`nft_custody_unanchored`]) {
      await sql`
        INSERT INTO ${table}
        (asset_identifier, value, tx_id, index_block_hash, parent_index_block_hash, microblock_hash,
          microblock_sequence, recipient, event_index, tx_index, block_height)
        (
          SELECT
            DISTINCT ON(asset_identifier, value) asset_identifier, value, tx_id, txs.index_block_hash,
            txs.parent_index_block_hash, txs.microblock_hash, txs.microblock_sequence, recipient,
            nft.event_index, txs.tx_index, txs.block_height
          FROM
            nft_events AS nft
          INNER JOIN
            txs USING (tx_id)
          WHERE
            txs.canonical = true
            AND txs.microblock_canonical = true
            AND nft.canonical = true
            AND nft.microblock_canonical = true
            AND nft.index_block_hash = ${args.index_block_hash}
            ${
              args.microblocks.length > 0
                ? sql`AND nft.microblock_hash IN ${sql(args.microblocks)}`
                : sql``
            }
          ORDER BY
            asset_identifier,
            value,
            txs.block_height DESC,
            txs.microblock_sequence DESC,
            txs.tx_index DESC,
            nft.event_index DESC
        )
        ON CONFLICT ON CONSTRAINT ${table}_unique DO UPDATE SET
          tx_id = EXCLUDED.tx_id,
          index_block_hash = EXCLUDED.index_block_hash,
          parent_index_block_hash = EXCLUDED.parent_index_block_hash,
          microblock_hash = EXCLUDED.microblock_hash,
          microblock_sequence = EXCLUDED.microblock_sequence,
          recipient = EXCLUDED.recipient,
          event_index = EXCLUDED.event_index,
          tx_index = EXCLUDED.tx_index,
          block_height = EXCLUDED.block_height
      `;
    }
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
    sql: PgSqlClient,
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
    const mbQuery = await sql<MicroblockQueryResult[]>`
      SELECT ${sql(MICROBLOCK_COLUMNS)}
      FROM microblocks
      WHERE (parent_index_block_hash = ${parentIndexBlockHash}
        OR block_height = ${blockHeight})
    `;
    const candidateMicroblocks = mbQuery.map(row => parseMicroblockQueryResult(row));

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
  async restoreMempoolTxs(sql: PgSqlClient, txIds: string[]): Promise<{ restoredTxs: string[] }> {
    if (txIds.length === 0) return { restoredTxs: [] };
    for (const txId of txIds) {
      logger.debug(`Restoring mempool tx: ${txId}`);
    }

    const updatedRows = await sql<{ tx_id: string }[]>`
      WITH restored AS (
        UPDATE mempool_txs
        SET pruned = FALSE
        WHERE tx_id IN ${sql(txIds)} AND pruned = TRUE
        RETURNING tx_id
      ),
      count_update AS (
        UPDATE chain_tip SET
          mempool_tx_count = mempool_tx_count + (SELECT COUNT(*) FROM restored),
          mempool_updated_at = NOW()
      )
      SELECT tx_id FROM restored
    `;

    const updatedTxs = updatedRows.map(r => r.tx_id);
    for (const tx of updatedTxs) {
      logger.debug(`Updated mempool tx: ${tx}`);
    }

    let restoredTxs = updatedRows.map(r => r.tx_id);

    // txs that didnt exist in the mempool need to be inserted into the mempool
    if (updatedRows.length < txIds.length) {
      const txsRequiringInsertion = txIds.filter(txId => !updatedTxs.includes(txId));

      logger.debug(`To restore mempool txs, ${txsRequiringInsertion.length} txs require insertion`);

      const txs: TxQueryResult[] = await sql`
        SELECT DISTINCT ON(tx_id) ${sql(TX_COLUMNS)}
        FROM txs
        WHERE tx_id IN ${sql(txsRequiringInsertion)}
        ORDER BY tx_id, block_height DESC, microblock_sequence DESC, tx_index DESC
      `;

      if (txs.length !== txsRequiringInsertion.length) {
        logger.error(`Not all txs requiring insertion were found`);
      }

      const mempoolTxs = convertTxQueryResultToDbMempoolTx(txs);

      await this.updateMempoolTxs({ mempoolTxs });

      restoredTxs = [...restoredTxs, ...txsRequiringInsertion];

      for (const tx of mempoolTxs) {
        logger.debug(`Inserted mempool tx: ${tx.tx_id}`);
      }
    }

    return { restoredTxs: restoredTxs };
  }

  /**
   * Remove transactions in the mempool table. This should be called when transactions are
   * mined into a block.
   * @param txIds - List of transactions to update in the mempool
   */
  async pruneMempoolTxs(sql: PgSqlClient, txIds: string[]): Promise<{ removedTxs: string[] }> {
    if (txIds.length === 0) return { removedTxs: [] };
    for (const txId of txIds) {
      logger.debug(`Pruning mempool tx: ${txId}`);
    }
    const updateResults = await sql<{ tx_id: string }[]>`
      WITH pruned AS (
        UPDATE mempool_txs
        SET pruned = true
        WHERE tx_id IN ${sql(txIds)} AND pruned = FALSE
        RETURNING tx_id
      ),
      count_update AS (
        UPDATE chain_tip SET
          mempool_tx_count = mempool_tx_count - (SELECT COUNT(*) FROM pruned),
          mempool_updated_at = NOW()
      )
      SELECT tx_id FROM pruned
    `;
    return { removedTxs: updateResults.map(r => r.tx_id) };
  }

  /**
   * Deletes mempool txs older than `STACKS_MEMPOOL_TX_GARBAGE_COLLECTION_THRESHOLD` blocks (default 256).
   * @param sql - DB client
   * @returns List of deleted `tx_id`s
   */
  async deleteGarbageCollectedMempoolTxs(sql: PgSqlClient): Promise<{ deletedTxs: string[] }> {
    const blockThreshold = parseInt(
      process.env['STACKS_MEMPOOL_TX_GARBAGE_COLLECTION_THRESHOLD'] ?? '256'
    );
    // TODO: Use DELETE instead of UPDATE once we implement a non-archival API replay mode.
    const deletedTxResults = await sql<{ tx_id: string }[]>`
      WITH pruned AS (
        UPDATE mempool_txs
        SET pruned = TRUE, status = ${DbTxStatus.DroppedApiGarbageCollect}
        WHERE pruned = FALSE
          AND receipt_block_height <= (SELECT block_height - ${blockThreshold} FROM chain_tip)
        RETURNING tx_id
      ),
      count_update AS (
        UPDATE chain_tip SET
          mempool_tx_count = mempool_tx_count - (SELECT COUNT(*) FROM pruned),
          mempool_updated_at = NOW()
      )
      SELECT tx_id FROM pruned
    `;
    return { deletedTxs: deletedTxResults.map(r => r.tx_id) };
  }

  async markEntitiesCanonical(
    sql: PgSqlClient,
    indexBlockHash: string,
    canonical: boolean,
    updatedEntities: ReOrgUpdatedEntities
  ): Promise<{ txsMarkedCanonical: string[]; txsMarkedNonCanonical: string[] }> {
    const txResult = await sql<TxQueryResult[]>`
      UPDATE txs
      SET canonical = ${canonical}
      WHERE index_block_hash = ${indexBlockHash} AND canonical != ${canonical}
      RETURNING ${sql(TX_COLUMNS)}
    `;
    const txIds = txResult.map(row => parseTxQueryResult(row));
    if (canonical) {
      updatedEntities.markedCanonical.txs += txResult.length;
    } else {
      updatedEntities.markedNonCanonical.txs += txResult.length;
    }
    for (const txId of txIds) {
      logger.debug(`Marked tx as ${canonical ? 'canonical' : 'non-canonical'}: ${txId.tx_id}`);
    }
    if (txIds.length) {
      await sql`
        UPDATE principal_stx_txs
        SET canonical = ${canonical}
        WHERE tx_id IN ${sql(txIds.map(tx => tx.tx_id))}
          AND index_block_hash = ${indexBlockHash} AND canonical != ${canonical}
      `;
    }

    const minerRewardResults = await sql`
      UPDATE miner_rewards
      SET canonical = ${canonical}
      WHERE index_block_hash = ${indexBlockHash} AND canonical != ${canonical}
    `;
    if (canonical) {
      updatedEntities.markedCanonical.minerRewards += minerRewardResults.count;
    } else {
      updatedEntities.markedNonCanonical.minerRewards += minerRewardResults.count;
    }

    const stxLockResults = await sql`
      UPDATE stx_lock_events
      SET canonical = ${canonical}
      WHERE index_block_hash = ${indexBlockHash} AND canonical != ${canonical}
    `;
    if (canonical) {
      updatedEntities.markedCanonical.stxLockEvents += stxLockResults.count;
    } else {
      updatedEntities.markedNonCanonical.stxLockEvents += stxLockResults.count;
    }

    const stxResults = await sql`
      UPDATE stx_events
      SET canonical = ${canonical}
      WHERE index_block_hash = ${indexBlockHash} AND canonical != ${canonical}
    `;
    if (canonical) {
      updatedEntities.markedCanonical.stxEvents += stxResults.count;
    } else {
      updatedEntities.markedNonCanonical.stxEvents += stxResults.count;
    }

    const ftResult = await sql`
      UPDATE ft_events
      SET canonical = ${canonical}
      WHERE index_block_hash = ${indexBlockHash} AND canonical != ${canonical}
    `;
    if (canonical) {
      updatedEntities.markedCanonical.ftEvents += ftResult.count;
    } else {
      updatedEntities.markedNonCanonical.ftEvents += ftResult.count;
    }

    const nftResult = await sql`
      UPDATE nft_events
      SET canonical = ${canonical}
      WHERE index_block_hash = ${indexBlockHash} AND canonical != ${canonical}
    `;
    if (canonical) {
      updatedEntities.markedCanonical.nftEvents += nftResult.count;
    } else {
      updatedEntities.markedNonCanonical.nftEvents += nftResult.count;
    }
    await this.updateNftCustodyFromReOrg(sql, {
      index_block_hash: indexBlockHash,
      microblocks: [],
    });

    const pox2Result = await sql`
      UPDATE pox2_events
      SET canonical = ${canonical}
      WHERE index_block_hash = ${indexBlockHash} AND canonical != ${canonical}
    `;
    if (canonical) {
      updatedEntities.markedCanonical.pox2Events += pox2Result.count;
    } else {
      updatedEntities.markedNonCanonical.pox2Events += pox2Result.count;
    }

    const pox3Result = await sql`
      UPDATE pox3_events
      SET canonical = ${canonical}
      WHERE index_block_hash = ${indexBlockHash} AND canonical != ${canonical}
    `;
    if (canonical) {
      updatedEntities.markedCanonical.pox3Events += pox3Result.count;
    } else {
      updatedEntities.markedNonCanonical.pox3Events += pox3Result.count;
    }

    const pox4Result = await sql`
      UPDATE pox4_events
      SET canonical = ${canonical}
      WHERE index_block_hash = ${indexBlockHash} AND canonical != ${canonical}
    `;
    if (canonical) {
      updatedEntities.markedCanonical.pox4Events += pox4Result.count;
    } else {
      updatedEntities.markedNonCanonical.pox4Events += pox4Result.count;
    }

    const contractLogResult = await sql`
      UPDATE contract_logs
      SET canonical = ${canonical}
      WHERE index_block_hash = ${indexBlockHash} AND canonical != ${canonical}
    `;
    if (canonical) {
      updatedEntities.markedCanonical.contractLogs += contractLogResult.count;
    } else {
      updatedEntities.markedNonCanonical.contractLogs += contractLogResult.count;
    }

    const smartContractResult = await sql`
      UPDATE smart_contracts
      SET canonical = ${canonical}
      WHERE index_block_hash = ${indexBlockHash} AND canonical != ${canonical}
    `;
    if (canonical) {
      updatedEntities.markedCanonical.smartContracts += smartContractResult.count;
    } else {
      updatedEntities.markedNonCanonical.smartContracts += smartContractResult.count;
    }

    const nameResult = await sql`
      UPDATE names
      SET canonical = ${canonical}
      WHERE index_block_hash = ${indexBlockHash} AND canonical != ${canonical}
    `;
    if (canonical) {
      updatedEntities.markedCanonical.names += nameResult.count;
    } else {
      updatedEntities.markedNonCanonical.names += nameResult.count;
    }

    const namespaceResult = await sql`
      UPDATE namespaces
      SET canonical = ${canonical}
      WHERE index_block_hash = ${indexBlockHash} AND canonical != ${canonical}
    `;
    if (canonical) {
      updatedEntities.markedCanonical.namespaces += namespaceResult.count;
    } else {
      updatedEntities.markedNonCanonical.namespaces += namespaceResult.count;
    }

    const subdomainResult = await sql`
      UPDATE subdomains
      SET canonical = ${canonical}
      WHERE index_block_hash = ${indexBlockHash} AND canonical != ${canonical}
    `;
    if (canonical) {
      updatedEntities.markedCanonical.subdomains += subdomainResult.count;
    } else {
      updatedEntities.markedNonCanonical.subdomains += subdomainResult.count;
    }

    return {
      txsMarkedCanonical: canonical ? txIds.map(t => t.tx_id) : [],
      txsMarkedNonCanonical: canonical ? [] : txIds.map(t => t.tx_id),
    };
  }

  async restoreOrphanedChain(
    sql: PgSqlClient,
    indexBlockHash: string,
    updatedEntities: ReOrgUpdatedEntities
  ): Promise<ReOrgUpdatedEntities> {
    // Restore the previously orphaned block to canonical
    const restoredBlockResult = await sql<BlockQueryResult[]>`
      UPDATE blocks
      SET canonical = true
      WHERE index_block_hash = ${indexBlockHash} AND canonical = false
      RETURNING ${sql(BLOCK_COLUMNS)}
    `;

    if (restoredBlockResult.length === 0) {
      throw new Error(`Could not find orphaned block by index_hash ${indexBlockHash}`);
    }
    if (restoredBlockResult.length > 1) {
      throw new Error(`Found multiple non-canonical parents for index_hash ${indexBlockHash}`);
    }
    updatedEntities.markedCanonical.blocks++;

    // Orphan the now conflicting block at the same height
    const orphanedBlockResult = await sql<BlockQueryResult[]>`
      UPDATE blocks
      SET canonical = false
      WHERE block_height = ${restoredBlockResult[0].block_height}
        AND index_block_hash != ${indexBlockHash} AND canonical = true
      RETURNING ${sql(BLOCK_COLUMNS)}
    `;

    const microblocksOrphaned = new Set<string>();
    const microblocksAccepted = new Set<string>();

    if (orphanedBlockResult.length > 0) {
      const orphanedBlocks = orphanedBlockResult.map(b => parseBlockQueryResult(b));
      for (const orphanedBlock of orphanedBlocks) {
        const microCanonicalUpdateResult = await this.updateMicroCanonical(sql, {
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
        sql,
        orphanedBlockResult[0].index_block_hash,
        false,
        updatedEntities
      );
      const restoredMempoolTxs = await this.restoreMempoolTxs(
        sql,
        markNonCanonicalResult.txsMarkedNonCanonical
      );
      updatedEntities.restoredMempoolTxs += restoredMempoolTxs.restoredTxs.length;
    }

    // The canonical microblock tables _must_ be restored _after_ orphaning all other blocks at a
    // given height, because there is only 1 row per microblock hash, and both the orphaned blocks
    // at this height and the canonical block can be pointed to the same microblocks.
    const restoredBlock = parseBlockQueryResult(restoredBlockResult[0]);
    const microCanonicalUpdateResult = await this.updateMicroCanonical(sql, {
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

    const markCanonicalResult = await this.markEntitiesCanonical(
      sql,
      indexBlockHash,
      true,
      updatedEntities
    );
    const prunedMempoolTxs = await this.pruneMempoolTxs(
      sql,
      markCanonicalResult.txsMarkedCanonical
    );
    updatedEntities.prunedMempoolTxs += prunedMempoolTxs.removedTxs.length;
    const parentResult = await sql<{ index_block_hash: string }[]>`
      SELECT index_block_hash
      FROM blocks
      WHERE
        block_height = ${restoredBlockResult[0].block_height - 1} AND
        index_block_hash = ${restoredBlockResult[0].parent_index_block_hash} AND
        canonical = false
    `;
    if (parentResult.length > 1) {
      throw new Error('Found more than one non-canonical parent to restore during reorg');
    }
    if (parentResult.length > 0) {
      await this.restoreOrphanedChain(sql, parentResult[0].index_block_hash, updatedEntities);
    }
    return updatedEntities;
  }

  async handleReorg(
    sql: PgSqlClient,
    block: DbBlock,
    chainTipHeight: number
  ): Promise<ReOrgUpdatedEntities> {
    const updatedEntities = newReOrgUpdatedEntities();
    // Check if incoming block's parent is canonical
    if (block.block_height > 1) {
      const parentResult = await sql<
        {
          canonical: boolean;
          index_block_hash: string;
          parent_index_block_hash: string;
        }[]
      >`
        SELECT canonical, index_block_hash, parent_index_block_hash
        FROM blocks
        WHERE block_height = ${block.block_height - 1}
          AND index_block_hash = ${block.parent_index_block_hash}
      `;
      if (parentResult.length > 1)
        throw new Error(
          `DB contains multiple blocks at height ${block.block_height - 1} and index_hash ${
            block.parent_index_block_hash
          }`
        );
      if (parentResult.length === 0)
        throw new Error(
          `DB does not contain a parent block at height ${block.block_height - 1} with index_hash ${
            block.parent_index_block_hash
          }`
        );
      // This block builds off a previously orphaned chain. Restore canonical status for this chain.
      if (!parentResult[0].canonical && block.block_height > chainTipHeight) {
        await this.restoreOrphanedChain(sql, parentResult[0].index_block_hash, updatedEntities);
        logger.info(
          updatedEntities,
          `Re-org resolved. Block ${block.block_height} builds off a previously orphaned chain.`
        );
      }
      // Reflect updated transaction totals in `chain_tip` table.
      const txCountDelta =
        updatedEntities.markedCanonical.txs - updatedEntities.markedNonCanonical.txs;
      await sql`
        UPDATE chain_tip SET
          tx_count = tx_count + ${txCountDelta},
          tx_count_unanchored = tx_count_unanchored + ${txCountDelta}
      `;
    }
    return updatedEntities;
  }

  /**
   * batch operations (mainly for event-replay)
   */

  async insertBlockBatch(sql: PgSqlClient, blocks: DbBlock[]) {
    const values: BlockInsertValues[] = blocks.map(block => ({
      block_hash: block.block_hash,
      index_block_hash: block.index_block_hash,
      parent_index_block_hash: block.parent_index_block_hash,
      parent_block_hash: block.parent_block_hash,
      parent_microblock_hash: block.parent_microblock_hash,
      parent_microblock_sequence: block.parent_microblock_sequence,
      block_height: block.block_height,
      burn_block_time: block.burn_block_time,
      burn_block_hash: block.burn_block_hash,
      burn_block_height: block.burn_block_height,
      miner_txid: block.miner_txid,
      canonical: block.canonical,
      execution_cost_read_count: block.execution_cost_read_count,
      execution_cost_read_length: block.execution_cost_read_length,
      execution_cost_runtime: block.execution_cost_runtime,
      execution_cost_write_count: block.execution_cost_write_count,
      execution_cost_write_length: block.execution_cost_write_length,
      tx_count: block.tx_count,
    }));
    await sql`
      INSERT INTO blocks ${sql(values)}
    `;
  }

  async insertMicroblock(sql: PgSqlClient, microblocks: DbMicroblock[]): Promise<void> {
    const values: MicroblockInsertValues[] = microblocks.map(mb => ({
      canonical: mb.canonical,
      microblock_canonical: mb.microblock_canonical,
      microblock_hash: mb.microblock_hash,
      microblock_sequence: mb.microblock_sequence,
      microblock_parent_hash: mb.microblock_parent_hash,
      parent_index_block_hash: mb.parent_index_block_hash,
      block_height: mb.block_height,
      parent_block_height: mb.parent_block_height,
      parent_block_hash: mb.parent_block_hash,
      index_block_hash: mb.index_block_hash,
      block_hash: mb.block_hash,
      parent_burn_block_height: mb.parent_burn_block_height,
      parent_burn_block_hash: mb.parent_burn_block_hash,
      parent_burn_block_time: mb.parent_burn_block_time,
    }));
    const mbResult = await sql`
      INSERT INTO microblocks ${sql(values)}
    `;
    if (mbResult.count !== microblocks.length) {
      throw new Error(
        `Unexpected row count after inserting microblocks: ${mbResult.count} vs ${values.length}`
      );
    }
  }

  // alias to insertMicroblock
  async insertMicroblockBatch(sql: PgSqlClient, microblocks: DbMicroblock[]): Promise<void> {
    return this.insertMicroblock(sql, microblocks);
  }

  async insertTxBatch(sql: PgSqlClient, txs: DbTx[]): Promise<void> {
    const values: TxInsertValues[] = txs.map(tx => ({
      tx_id: tx.tx_id,
      raw_tx: tx.raw_result,
      tx_index: tx.tx_index,
      index_block_hash: tx.index_block_hash,
      parent_index_block_hash: tx.parent_index_block_hash,
      block_hash: tx.block_hash,
      parent_block_hash: tx.parent_block_hash,
      block_height: tx.block_height,
      burn_block_time: tx.burn_block_time,
      parent_burn_block_time: tx.parent_burn_block_time,
      type_id: tx.type_id,
      anchor_mode: tx.anchor_mode,
      status: tx.status,
      canonical: tx.canonical,
      post_conditions: tx.post_conditions,
      nonce: tx.nonce,
      fee_rate: tx.fee_rate,
      sponsored: tx.sponsored,
      sponsor_nonce: tx.sponsor_nonce ?? null,
      sponsor_address: tx.sponsor_address ?? null,
      sender_address: tx.sender_address,
      origin_hash_mode: tx.origin_hash_mode,
      microblock_canonical: tx.microblock_canonical,
      microblock_sequence: tx.microblock_sequence,
      microblock_hash: tx.microblock_hash,
      token_transfer_recipient_address: tx.token_transfer_recipient_address ?? null,
      token_transfer_amount: tx.token_transfer_amount ?? null,
      token_transfer_memo: tx.token_transfer_memo ?? null,
      smart_contract_clarity_version: tx.smart_contract_clarity_version ?? null,
      smart_contract_contract_id: tx.smart_contract_contract_id ?? null,
      smart_contract_source_code: tx.smart_contract_source_code ?? null,
      contract_call_contract_id: tx.contract_call_contract_id ?? null,
      contract_call_function_name: tx.contract_call_function_name ?? null,
      contract_call_function_args: tx.contract_call_function_args ?? null,
      poison_microblock_header_1: tx.poison_microblock_header_1 ?? null,
      poison_microblock_header_2: tx.poison_microblock_header_2 ?? null,
      coinbase_payload: tx.coinbase_payload ?? null,
      coinbase_alt_recipient: tx.coinbase_alt_recipient ?? null,
      coinbase_vrf_proof: tx.coinbase_vrf_proof ?? null,
      tenure_change_tenure_consensus_hash: tx.tenure_change_tenure_consensus_hash ?? null,
      tenure_change_prev_tenure_consensus_hash: tx.tenure_change_prev_tenure_consensus_hash ?? null,
      tenure_change_burn_view_consensus_hash: tx.tenure_change_burn_view_consensus_hash ?? null,
      tenure_change_previous_tenure_end: tx.tenure_change_previous_tenure_end ?? null,
      tenure_change_previous_tenure_blocks: tx.tenure_change_previous_tenure_blocks ?? null,
      tenure_change_cause: tx.tenure_change_cause ?? null,
      tenure_change_pubkey_hash: tx.tenure_change_pubkey_hash ?? null,
      tenure_change_signature: tx.tenure_change_signature ?? null,
      tenure_change_signers: tx.tenure_change_signers ?? null,
      raw_result: tx.raw_result,
      event_count: tx.event_count,
      execution_cost_read_count: tx.execution_cost_read_count,
      execution_cost_read_length: tx.execution_cost_read_length,
      execution_cost_runtime: tx.execution_cost_runtime,
      execution_cost_write_count: tx.execution_cost_write_count,
      execution_cost_write_length: tx.execution_cost_write_length,
    }));
    await sql`INSERT INTO txs ${sql(values)}`;
  }

  async insertPrincipalStxTxsBatch(sql: PgSqlClient, values: PrincipalStxTxsInsertValues[]) {
    await sql`
      INSERT INTO principal_stx_txs ${sql(values)}
    `;
  }

  async insertContractEventBatch(sql: PgSqlClient, values: SmartContractEventInsertValues[]) {
    await sql`
      INSERT INTO contract_logs ${sql(values)}
    `;
  }

  async insertFtEventBatch(sql: PgSqlClient, values: FtEventInsertValues[]) {
    await sql`
      INSERT INTO ft_events ${sql(values)}
    `;
  }

  async insertNftEventBatch(sql: PgSqlClient, values: NftEventInsertValues[]) {
    await sql`INSERT INTO nft_events ${sql(values)}`;
  }

  async insertNameBatch(sql: PgSqlClient, values: BnsNameInsertValues[]) {
    await sql`
      INSERT INTO names ${sql(values)}
    `;
  }

  async insertNamespace(
    sql: PgSqlClient,
    blockData: {
      index_block_hash: string;
      parent_index_block_hash: string;
      microblock_hash: string;
      microblock_sequence: number;
      microblock_canonical: boolean;
    },
    bnsNamespace: DbBnsNamespace
  ) {
    const values: BnsNamespaceInsertValues = {
      namespace_id: bnsNamespace.namespace_id,
      launched_at: bnsNamespace.launched_at ?? null,
      address: bnsNamespace.address,
      reveal_block: bnsNamespace.reveal_block,
      ready_block: bnsNamespace.ready_block,
      buckets: bnsNamespace.buckets,
      base: bnsNamespace.base.toString(),
      coeff: bnsNamespace.coeff.toString(),
      nonalpha_discount: bnsNamespace.nonalpha_discount.toString(),
      no_vowel_discount: bnsNamespace.no_vowel_discount.toString(),
      lifetime: bnsNamespace.lifetime,
      status: bnsNamespace.status ?? null,
      tx_index: bnsNamespace.tx_index,
      tx_id: bnsNamespace.tx_id,
      canonical: bnsNamespace.canonical,
      index_block_hash: blockData.index_block_hash,
      parent_index_block_hash: blockData.parent_index_block_hash,
      microblock_hash: blockData.microblock_hash,
      microblock_sequence: blockData.microblock_sequence,
      microblock_canonical: blockData.microblock_canonical,
    };
    await sql`
      INSERT INTO namespaces ${sql(values)}
    `;
  }

  async insertZonefileBatch(sql: PgSqlClient, values: BnsZonefileInsertValues[]) {
    await sql`
      INSERT INTO zonefiles ${sql(values)}
    `;
  }

  async insertRawEventRequestBatch(
    sql: PgSqlClient,
    events: RawEventRequestInsertValues[]
  ): Promise<void> {
    await sql`
      INSERT INTO event_observer_requests ${this.sql(events)}
    `;
  }

  /**
   * (event-replay) Enable or disable indexes for DB tables.
   */
  async toggleAllTableIndexes(sql: PgSqlClient, state: IndexesState): Promise<void> {
    const enable: boolean = Boolean(state);
    const dbName = sql.options.database;
    const tableSchema = sql.options.connection.search_path ?? 'public';
    const tablesQuery = await sql<{ tablename: string }[]>`
      SELECT tablename FROM pg_catalog.pg_tables
      WHERE tablename != ${MIGRATIONS_TABLE}
      AND schemaname = ${tableSchema}`;
    if (tablesQuery.length === 0) {
      const errorMsg = `No tables found in database '${dbName}', schema '${tableSchema}'`;
      console.error(errorMsg);
      throw new Error(errorMsg);
    }
    const tables: string[] = tablesQuery.map((r: { tablename: string }) => r.tablename);

    // Exclude subdomains table since its constraints
    // are need to handle the ingestion of attachments_new events.
    const filtered = tables.filter(item => item !== 'subdomains');

    const result = await sql`
      UPDATE pg_index
      SET ${sql({ indisready: enable, indisvalid: enable })}
      WHERE indrelid = ANY (
        SELECT oid FROM pg_class
        WHERE relname IN ${sql(filtered)}
        AND relnamespace = (
          SELECT oid FROM pg_namespace WHERE nspname = ${tableSchema}
        )
      )
    `;
    if (result.count === 0) {
      throw new Error(`No updates made while toggling table indexes`);
    }
  }

  /**
   * (event-replay) Reindex all DB tables.
   */
  async reindexAllTables(sql: PgSqlClient): Promise<void> {
    const dbName = sql.options.database;
    const tableSchema = sql.options.connection.search_path ?? 'public';
    const tablesQuery = await sql<{ tablename: string }[]>`
      SELECT tablename FROM pg_catalog.pg_tables
      WHERE tablename != ${MIGRATIONS_TABLE}
      AND schemaname = ${tableSchema}`;
    if (tablesQuery.length === 0) {
      const errorMsg = `No tables found in database '${dbName}', schema '${tableSchema}'`;
      console.error(errorMsg);
      throw new Error(errorMsg);
    }
    const tables: string[] = tablesQuery.map((r: { tablename: string }) => r.tablename);

    for (const table of tables) {
      const result = await sql`REINDEX TABLE ${sql(table)}`;
      if (result.count === 0) {
        throw new Error(`No updates made while toggling table indexes`);
      }
    }
  }
}
