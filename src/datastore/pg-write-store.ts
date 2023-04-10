import {
  logger,
  logError,
  getOrAdd,
  batchIterate,
  isProdEnv,
  I32_MAX,
  getIbdBlockHeight,
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
  DbNonFungibleTokenMetadata,
  DbFungibleTokenMetadata,
  DbTokenMetadataQueueEntry,
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
  MempoolTxQueryResult,
  TokenMetadataQueueEntryInsertValues,
  SmartContractInsertValues,
  BnsNameInsertValues,
  BnsNamespaceInsertValues,
  FtMetadataInsertValues,
  NftMetadataInsertValues,
  FaucetRequestInsertValues,
  MicroblockInsertValues,
  TxQueryResult,
  UpdatedEntities,
  BlockQueryResult,
  DataStoreAttachmentData,
  DataStoreAttachmentSubdomainData,
  DataStoreBnsBlockData,
  DbPox2Event,
  Pox2EventInsertValues,
  DbTxRaw,
  DbMempoolTxRaw,
  DbChainTip,
} from './common';
import { ClarityAbi } from '@stacks/transactions';
import {
  BLOCK_COLUMNS,
  convertTxQueryResultToDbMempoolTx,
  MEMPOOL_TX_COLUMNS,
  MICROBLOCK_COLUMNS,
  parseBlockQueryResult,
  parseMempoolTxQueryResult,
  parseMicroblockQueryResult,
  parseTxQueryResult,
  TX_COLUMNS,
  TX_METADATA_TABLES,
  validateZonefileHash,
} from './helpers';
import { PgNotifier } from './pg-notifier';
import { PgStore, UnwrapPromiseArray } from './pg-store';
import {
  connectPostgres,
  getPgConnectionEnvValue,
  PgJsonb,
  PgServer,
  PgSqlClient,
} from './connection';
import { runMigrations } from './migrations';
import { getPgClientConfig } from './connection-legacy';
import { isProcessableTokenMetadata } from '../token-metadata/helpers';
import * as zoneFileParser from 'zone-file';
import { parseResolver, parseZoneFileTxt } from '../event-stream/bns/bns-helpers';
import { Pox2EventName } from '../pox-helpers';

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
  protected get closeTimeout(): number {
    return parseInt(getPgConnectionEnvValue('CLOSE_TIMEOUT', PgServer.primary) ?? '5');
  }

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
    const sql = await connectPostgres({ usageName: usageName, pgServer: PgServer.primary });
    if (!skipMigrations) {
      await runMigrations(
        getPgClientConfig({
          usageName: `${usageName}:schema-migrations`,
          pgServer: PgServer.primary,
        })
      );
    }
    const notifier = withNotifier ? await PgNotifier.create(usageName) : undefined;
    const store = new PgWriteStore(sql, notifier, isEventReplay);
    await store.connectPgNotifier();
    return store;
  }

  async sqlWriteTransaction<T>(
    callback: (sql: PgSqlClient) => T | Promise<T>
  ): Promise<UnwrapPromiseArray<T>> {
    return super.sqlTransaction(callback, false);
  }

  async getChainTip(sql: PgSqlClient, useMaterializedView = true): Promise<DbChainTip> {
    if (!this.isEventReplay && useMaterializedView) {
      return super.getChainTip(sql);
    }
    // The `chain_tip` materialized view is not available during event replay.
    // Since `getChainTip()` is used heavily during event ingestion, we'll fall back to
    // a classic query.
    const currentTipBlock = await sql<
      {
        block_height: number;
        block_hash: string;
        index_block_hash: string;
        burn_block_height: number;
      }[]
    >`
      SELECT block_height, block_hash, index_block_hash, burn_block_height
      FROM blocks
      WHERE canonical = true AND block_height = (SELECT MAX(block_height) FROM blocks)
    `;
    return {
      blockHeight: currentTipBlock[0]?.block_height ?? 0,
      blockHash: currentTipBlock[0]?.block_hash ?? '',
      indexBlockHash: currentTipBlock[0]?.index_block_hash ?? '',
      burnBlockHeight: currentTipBlock[0]?.burn_block_height ?? 0,
    };
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
    const tokenMetadataQueueEntries: DbTokenMetadataQueueEntry[] = [];
    let garbageCollectedMempoolTxs: string[] = [];
    let batchedTxData: DataStoreTxEventData[] = [];
    const deployedSmartContracts: DbSmartContract[] = [];
    const contractLogEvents: DbSmartContractEvent[] = [];

    await this.sqlWriteTransaction(async sql => {
      const chainTip = await this.getChainTip(sql, false);
      await this.handleReorg(sql, data.block, chainTip.blockHeight);
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
          pox2Events: tx.pox2Events.map(e => ({ ...e, canonical: false })),
        }));
        data.minerRewards = data.minerRewards.map(mr => ({ ...mr, canonical: false }));
      } else {
        // When storing newly mined canonical txs, remove them from the mempool table.
        const candidateTxIds = data.txs.map(d => d.tx.tx_id);
        const removedTxsResult = await this.pruneMempoolTxs(sql, candidateTxIds);
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

      batchedTxData = data.txs;

      // Find microblocks that weren't already inserted via the unconfirmed microblock event.
      // This happens when a stacks-node is syncing and receives confirmed microblocks with their anchor block at the same time.
      if (data.microblocks.length > 0) {
        const existingMicroblocksQuery = await sql<{ microblock_hash: string }[]>`
          SELECT microblock_hash
          FROM microblocks
          WHERE parent_index_block_hash = ${data.block.parent_index_block_hash}
            AND microblock_hash IN ${sql(data.microblocks.map(mb => mb.microblock_hash))}
        `;
        const existingMicroblockHashes = new Set(
          existingMicroblocksQuery.map(r => r.microblock_hash)
        );

        const missingMicroblocks = data.microblocks.filter(
          mb => !existingMicroblockHashes.has(mb.microblock_hash)
        );
        if (missingMicroblocks.length > 0) {
          const missingMicroblockHashes = new Set(missingMicroblocks.map(mb => mb.microblock_hash));
          const missingTxs = data.txs.filter(entry =>
            missingMicroblockHashes.has(entry.tx.microblock_hash)
          );
          await this.insertMicroblockData(sql, missingMicroblocks, missingTxs);

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
      }

      if (isCanonical && data.pox_v1_unlock_height !== undefined) {
        // update the pox_state.pox_v1_unlock_height singleton
        await sql`
          UPDATE pox_state 
          SET pox_v1_unlock_height = ${data.pox_v1_unlock_height}
          WHERE pox_v1_unlock_height != ${data.pox_v1_unlock_height}
        `;
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

      // TODO(mb): sanity tests on tx_index on batchedTxData, re-normalize if necessary

      // TODO(mb): copy the batchedTxData to outside the sql transaction fn so they can be emitted in txUpdate event below

      const blocksUpdated = await this.updateBlock(sql, data.block);
      if (blocksUpdated !== 0) {
        for (const minerRewards of data.minerRewards) {
          await this.updateMinerReward(sql, minerRewards);
        }
        for (const entry of batchedTxData) {
          await this.updateTx(sql, entry.tx);
          await this.updateBatchStxEvents(sql, entry.tx, entry.stxEvents);
          await this.updatePrincipalStxTxs(sql, entry.tx, entry.stxEvents);
          contractLogEvents.push(...entry.contractLogEvents);
          await this.updateBatchSmartContractEvent(sql, entry.tx, entry.contractLogEvents);
          for (const pox2Event of entry.pox2Events) {
            await this.updatePox2Event(sql, entry.tx, pox2Event);
          }
          for (const stxLockEvent of entry.stxLockEvents) {
            await this.updateStxLockEvent(sql, entry.tx, stxLockEvent);
          }
          for (const ftEvent of entry.ftEvents) {
            await this.updateFtEvent(sql, entry.tx, ftEvent);
          }
          for (const nftEvent of entry.nftEvents) {
            await this.updateNftEvent(sql, entry.tx, nftEvent);
          }
          deployedSmartContracts.push(...entry.smartContracts);
          for (const smartContract of entry.smartContracts) {
            await this.updateSmartContract(sql, entry.tx, smartContract);
          }
          for (const namespace of entry.namespaces) {
            await this.updateNamespaces(sql, entry.tx, namespace);
          }
          for (const bnsName of entry.names) {
            await this.updateNames(sql, entry.tx, bnsName);
          }
        }
        const mempoolGarbageResults = await this.deleteGarbageCollectedMempoolTxs(sql);
        if (mempoolGarbageResults.deletedTxs.length > 0) {
          logger.verbose(
            `Garbage collected ${mempoolGarbageResults.deletedTxs.length} mempool txs`
          );
        }
        garbageCollectedMempoolTxs = mempoolGarbageResults.deletedTxs;

        const tokenContractDeployments = data.txs
          .filter(
            entry =>
              entry.tx.type_id === DbTxTypeId.SmartContract ||
              entry.tx.type_id === DbTxTypeId.VersionedSmartContract
          )
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
              retry_count: 0,
            };
            return queueEntry;
          })
          .filter(entry => isProcessableTokenMetadata(entry.contractAbi));
        for (const pendingQueueEntry of tokenContractDeployments) {
          const queueEntry = await this.updateTokenMetadataQueue(sql, pendingQueueEntry);
          tokenMetadataQueueEntries.push(queueEntry);
        }
      }

      if (!this.isEventReplay) {
        await this.reconcileMempoolStatus(sql);

        const mempoolStats = await this.getMempoolStatsInternal({ sql });
        this.eventEmitter.emit('mempoolStatsUpdate', mempoolStats);
      }
    });

    await this.refreshNftCustody(batchedTxData);
    await this.refreshMaterializedView('chain_tip');
    await this.refreshMaterializedView('mempool_digest');

    // Skip sending `PgNotifier` updates altogether if we're in the genesis block since this block is the
    // event replay of the v1 blockchain.
    if ((data.block.block_height > 1 || !isProdEnv) && this.notifier) {
      await this.notifier.sendBlock({ blockHash: data.block.block_hash });
      for (const tx of data.txs) {
        await this.notifier.sendTx({ txId: tx.tx.tx_id });
      }
      for (const txId of garbageCollectedMempoolTxs) {
        await this.notifier.sendTx({ txId: txId });
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
      await this.emitAddressTxUpdates(data.txs);
      for (const nftEvent of data.txs.map(tx => tx.nftEvents).flat()) {
        await this.notifier.sendNftEvent({
          txId: nftEvent.tx_id,
          eventIndex: nftEvent.event_index,
        });
      }
      for (const tokenMetadataQueueEntry of tokenMetadataQueueEntries) {
        await this.notifier.sendTokenMetadata({ queueId: tokenMetadataQueueEntry.queueId });
      }
    }
  }

  async updateMinerReward(sql: PgSqlClient, minerReward: DbMinerReward): Promise<number> {
    const values: MinerRewardInsertValues = {
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
    };
    const result = await sql`
      INSERT INTO miner_rewards ${sql(values)}
    `;
    return result.count;
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
    };
    const result = await sql`
      INSERT INTO blocks ${sql(values)}
      ON CONFLICT (index_block_hash) DO NOTHING
    `;
    return result.count;
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
      // Sanity check: ensure incoming microblocks have a `parent_index_block_hash` that matches the API's
      // current known canonical chain tip. We assume this holds true so incoming microblock data is always
      // treated as being built off the current canonical anchor block.
      const chainTip = await this.getChainTip(sql, false);
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
          parent_block_height: chainTip.blockHeight,
          parent_block_hash: chainTip.blockHash,
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
          parent_block_hash: chainTip.blockHash,
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
        logger.verbose(
          `Removed ${removedTxsResult.removedTxs.length} microblock-txs from mempool table during microblock ingestion`
        );
      }

      if (!this.isEventReplay) {
        await this.reconcileMempoolStatus(sql);

        const mempoolStats = await this.getMempoolStatsInternal({ sql });
        this.eventEmitter.emit('mempoolStatsUpdate', mempoolStats);
      }
    });

    await this.refreshNftCustody(txData, true);
    await this.refreshMaterializedView('chain_tip');
    await this.refreshMaterializedView('mempool_digest');

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

  // Find any transactions that are erroneously still marked as both `pending` in the mempool table
  // and also confirmed in the mined txs table. Mark these as pruned in the mempool and log warning.
  // This must be called _after_ any writes to txs/mempool tables during block and microblock ingestion,
  // but _before_ any reads or view refreshes that depend on the mempool table.
  // NOTE: this is essentially a work-around for whatever bug is causing the underlying problem.
  async reconcileMempoolStatus(sql: PgSqlClient): Promise<void> {
    const txsResult = await sql<{ tx_id: string }[]>`
      UPDATE mempool_txs
      SET pruned = true
      FROM txs
      WHERE 
        mempool_txs.tx_id = txs.tx_id AND
        mempool_txs.pruned = false AND
        txs.canonical = true AND
        txs.microblock_canonical = true AND
        txs.status IN ${sql([
          DbTxStatus.Success,
          DbTxStatus.AbortByResponse,
          DbTxStatus.AbortByPostCondition,
        ])}
      RETURNING mempool_txs.tx_id
    `;
    if (txsResult.length > 0) {
      const txs = txsResult.map(tx => tx.tx_id);
      logger.warn(`Reconciled mempool txs as pruned for ${txsResult.length} txs`, { txs });
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

  async updatePox2Event(sql: PgSqlClient, tx: DbTx, event: DbPox2Event) {
    const values: Pox2EventInsertValues = {
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
      case Pox2EventName.HandleUnlock: {
        values.first_cycle_locked = event.data.first_cycle_locked.toString();
        values.first_unlocked_cycle = event.data.first_unlocked_cycle.toString();
        break;
      }
      case Pox2EventName.StackStx: {
        values.lock_period = event.data.lock_period.toString();
        values.lock_amount = event.data.lock_amount.toString();
        values.start_burn_height = event.data.start_burn_height.toString();
        values.unlock_burn_height = event.data.unlock_burn_height.toString();
        break;
      }
      case Pox2EventName.StackIncrease: {
        values.increase_by = event.data.increase_by.toString();
        values.total_locked = event.data.total_locked.toString();
        break;
      }
      case Pox2EventName.StackExtend: {
        values.extend_count = event.data.extend_count.toString();
        values.unlock_burn_height = event.data.unlock_burn_height.toString();
        break;
      }
      case Pox2EventName.DelegateStx: {
        values.amount_ustx = event.data.amount_ustx.toString();
        values.delegate_to = event.data.delegate_to;
        values.unlock_burn_height = event.data.unlock_burn_height?.toString() ?? null;
        break;
      }
      case Pox2EventName.DelegateStackStx: {
        values.lock_period = event.data.lock_period.toString();
        values.lock_amount = event.data.lock_amount.toString();
        values.start_burn_height = event.data.start_burn_height.toString();
        values.unlock_burn_height = event.data.unlock_burn_height.toString();
        values.delegator = event.data.delegator;
        break;
      }
      case Pox2EventName.DelegateStackIncrease: {
        values.increase_by = event.data.increase_by.toString();
        values.total_locked = event.data.total_locked.toString();
        values.delegator = event.data.delegator;
        break;
      }
      case Pox2EventName.DelegateStackExtend: {
        values.extend_count = event.data.extend_count.toString();
        values.unlock_burn_height = event.data.unlock_burn_height.toString();
        values.delegator = event.data.delegator;
        break;
      }
      case Pox2EventName.StackAggregationCommit: {
        values.reward_cycle = event.data.reward_cycle.toString();
        values.amount_ustx = event.data.amount_ustx.toString();
        break;
      }
      case Pox2EventName.StackAggregationCommitIndexed: {
        values.reward_cycle = event.data.reward_cycle.toString();
        values.amount_ustx = event.data.amount_ustx.toString();
        break;
      }
      case Pox2EventName.StackAggregationIncrease: {
        values.reward_cycle = event.data.reward_cycle.toString();
        values.amount_ustx = event.data.amount_ustx.toString();
        break;
      }
      default: {
        throw new Error(`Unexpected Pox2 event name: ${(event as DbPox2Event).name}`);
      }
    }
    await sql`
      INSERT INTO pox2_events ${sql(values)}
    `;
  }

  async updateStxLockEvent(sql: PgSqlClient, tx: DbTx, event: DbStxLockEvent) {
    const values: StxLockEventInsertValues = {
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
    };
    await sql`
      INSERT INTO stx_lock_events ${sql(values)}
    `;
  }

  async updateBatchStxEvents(sql: PgSqlClient, tx: DbTx, events: DbStxEvent[]) {
    const batchSize = 500; // (matt) benchmark: 21283 per second (15 seconds)
    for (const eventBatch of batchIterate(events, batchSize)) {
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

  async updateFtEvent(sql: PgSqlClient, tx: DbTx, event: DbFtEvent) {
    const values: FtEventInsertValues = {
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
    };
    await sql`
      INSERT INTO ft_events ${sql(values)}
    `;
  }

  async updateNftEvent(sql: PgSqlClient, tx: DbTx, event: DbNftEvent) {
    const values: NftEventInsertValues = {
      tx_id: event.tx_id,
      index_block_hash: tx.index_block_hash,
      parent_index_block_hash: tx.parent_index_block_hash,
      microblock_hash: tx.microblock_hash,
      microblock_sequence: tx.microblock_sequence,
      microblock_canonical: tx.microblock_canonical,
      sender: event.sender ?? null,
      recipient: event.recipient ?? null,
      event_index: event.event_index,
      tx_index: event.tx_index,
      block_height: event.block_height,
      canonical: event.canonical,
      asset_event_type_id: event.asset_event_type_id,
      asset_identifier: event.asset_identifier,
      value: event.value,
    };
    await sql`
      INSERT INTO nft_events ${sql(values)}
    `;
  }

  async updateBatchSmartContractEvent(sql: PgSqlClient, tx: DbTx, events: DbSmartContractEvent[]) {
    const batchSize = 500; // (matt) benchmark: 21283 per second (15 seconds)
    for (const eventBatch of batchIterate(events, batchSize)) {
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

  async insertDbMempoolTx(
    tx: DbMempoolTxRaw,
    chainTip: DbChainTip,
    sql: PgSqlClient
  ): Promise<boolean> {
    const values: MempoolTxInsertValues = {
      pruned: tx.pruned,
      tx_id: tx.tx_id,
      raw_tx: tx.raw_tx,
      type_id: tx.type_id,
      anchor_mode: tx.anchor_mode,
      status: tx.status,
      receipt_time: tx.receipt_time,
      receipt_block_height: chainTip.blockHeight,
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
    };
    const result = await sql`
      INSERT INTO mempool_txs ${sql(values)}
      ON CONFLICT ON CONSTRAINT unique_tx_id DO NOTHING
    `;
    if (result.count !== 1) {
      const errMsg = `A duplicate transaction was attempted to be inserted into the mempool_txs table: ${tx.tx_id}`;
      logger.warn(errMsg);
      return false;
    } else {
      return true;
    }
  }

  async updateMempoolTxs({ mempoolTxs: txs }: { mempoolTxs: DbMempoolTxRaw[] }): Promise<void> {
    const updatedTxIds: string[] = [];
    await this.sqlWriteTransaction(async sql => {
      const chainTip = await this.getChainTip(sql, false);
      for (const tx of txs) {
        const inserted = await this.insertDbMempoolTx(tx, chainTip, sql);
        if (inserted) {
          updatedTxIds.push(tx.tx_id);
        }
      }
      if (!this.isEventReplay) {
        await this.reconcileMempoolStatus(sql);

        const mempoolStats = await this.getMempoolStatsInternal({ sql });
        this.eventEmitter.emit('mempoolStatsUpdate', mempoolStats);
      }
    });
    await this.refreshMaterializedView('mempool_digest');
    for (const txId of updatedTxIds) {
      await this.notifier?.sendTx({ txId: txId });
    }
  }

  async dropMempoolTxs({ status, txIds }: { status: DbTxStatus; txIds: string[] }): Promise<void> {
    const updateResults = await this.sql<MempoolTxQueryResult[]>`
      UPDATE mempool_txs
      SET pruned = true, status = ${status}
      WHERE tx_id IN ${this.sql(txIds)}
      RETURNING ${this.sql(MEMPOOL_TX_COLUMNS)}
    `;
    const updatedTxs = updateResults.map(r => parseMempoolTxQueryResult(r));
    await this.refreshMaterializedView('mempool_digest');
    for (const tx of updatedTxs) {
      await this.notifier?.sendTx({ txId: tx.tx_id });
    }
  }

  async updateTokenMetadataQueue(
    sql: PgSqlClient,
    entry: DbTokenMetadataQueueEntry
  ): Promise<DbTokenMetadataQueueEntry> {
    const values: TokenMetadataQueueEntryInsertValues = {
      tx_id: entry.txId,
      contract_id: entry.contractId,
      contract_abi: JSON.stringify(entry.contractAbi),
      block_height: entry.blockHeight,
      processed: false,
    };
    const queryResult = await sql<{ queue_id: number }[]>`
      INSERT INTO token_metadata_queue ${sql(values)}
      RETURNING queue_id
    `;
    const result: DbTokenMetadataQueueEntry = {
      ...entry,
      queueId: queryResult[0].queue_id,
    };
    return result;
  }

  async updateSmartContract(sql: PgSqlClient, tx: DbTx, smartContract: DbSmartContract) {
    const values: SmartContractInsertValues = {
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
    };
    await sql`
      INSERT INTO smart_contracts ${sql(values)}
    `;
  }

  async updateNames(
    sql: PgSqlClient,
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
      index_block_hash: blockData.index_block_hash,
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
      index_block_hash: blockData.index_block_hash,
      parent_index_block_hash: blockData.parent_index_block_hash,
      microblock_hash: blockData.microblock_hash,
      microblock_sequence: blockData.microblock_sequence,
      microblock_canonical: blockData.microblock_canonical,
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

  async updateNamespaces(
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

  async updateFtMetadata(ftMetadata: DbFungibleTokenMetadata, dbQueueId: number): Promise<number> {
    const length = await this.sqlWriteTransaction(async sql => {
      const values: FtMetadataInsertValues = {
        token_uri: ftMetadata.token_uri,
        name: ftMetadata.name,
        description: ftMetadata.description,
        image_uri: ftMetadata.image_uri,
        image_canonical_uri: ftMetadata.image_canonical_uri,
        contract_id: ftMetadata.contract_id,
        symbol: ftMetadata.symbol,
        decimals: ftMetadata.decimals,
        tx_id: ftMetadata.tx_id,
        sender_address: ftMetadata.sender_address,
      };
      const result = await sql`
        INSERT INTO ft_metadata ${sql(values)}
        ON CONFLICT (contract_id)
        DO 
          UPDATE SET ${sql(values)}
      `;
      await sql`
        UPDATE token_metadata_queue
        SET processed = true
        WHERE queue_id = ${dbQueueId}
      `;
      return result.count;
    });
    await this.notifier?.sendTokens({ contractID: ftMetadata.contract_id });
    return length;
  }

  async updateNFtMetadata(
    nftMetadata: DbNonFungibleTokenMetadata,
    dbQueueId: number
  ): Promise<number> {
    const length = await this.sqlWriteTransaction(async sql => {
      const values: NftMetadataInsertValues = {
        token_uri: nftMetadata.token_uri,
        name: nftMetadata.name,
        description: nftMetadata.description,
        image_uri: nftMetadata.image_uri,
        image_canonical_uri: nftMetadata.image_canonical_uri,
        contract_id: nftMetadata.contract_id,
        tx_id: nftMetadata.tx_id,
        sender_address: nftMetadata.sender_address,
      };
      const result = await sql`
        INSERT INTO nft_metadata ${sql(values)}
        ON CONFLICT (contract_id)
        DO 
          UPDATE SET ${sql(values)}
      `;
      await sql`
        UPDATE token_metadata_queue
        SET processed = true
        WHERE queue_id = ${dbQueueId}
      `;
      return result.count;
    });
    await this.notifier?.sendTokens({ contractID: nftMetadata.contract_id });
    return length;
  }

  async updateProcessedTokenMetadataQueueEntry(queueId: number): Promise<void> {
    await this.sql`
      UPDATE token_metadata_queue
      SET processed = true
      WHERE queue_id = ${queueId}
    `;
  }

  async increaseTokenMetadataQueueEntryRetryCount(queueId: number): Promise<number> {
    const result = await this.sql<{ retry_count: number }[]>`
      UPDATE token_metadata_queue
      SET retry_count = retry_count + 1
      WHERE queue_id = ${queueId}
      RETURNING retry_count
    `;
    return result[0].retry_count;
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
      logError(`Locked Info errors ${e.message}`, e);
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
      logError(`Error performing faucet request update: ${error}`, error);
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

      await this.updateBatchStxEvents(sql, entry.tx, entry.stxEvents);
      await this.updatePrincipalStxTxs(sql, entry.tx, entry.stxEvents);
      await this.updateBatchSmartContractEvent(sql, entry.tx, entry.contractLogEvents);
      for (const pox2Event of entry.pox2Events) {
        await this.updatePox2Event(sql, entry.tx, pox2Event);
      }
      for (const stxLockEvent of entry.stxLockEvents) {
        await this.updateStxLockEvent(sql, entry.tx, stxLockEvent);
      }
      for (const ftEvent of entry.ftEvents) {
        await this.updateFtEvent(sql, entry.tx, ftEvent);
      }
      for (const nftEvent of entry.nftEvents) {
        await this.updateNftEvent(sql, entry.tx, nftEvent);
      }
      for (const smartContract of entry.smartContracts) {
        await this.updateSmartContract(sql, entry.tx, smartContract);
      }
      for (const namespace of entry.namespaces) {
        await this.updateNamespaces(sql, entry.tx, namespace);
      }
      for (const bnsName of entry.names) {
        await this.updateNames(sql, entry.tx, bnsName);
      }
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
      logger.verbose(
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
    }

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
    if (txIds.length === 0) {
      // Avoid an unnecessary query.
      return { restoredTxs: [] };
    }
    for (const txId of txIds) {
      logger.verbose(`Restoring mempool tx: ${txId}`);
    }

    const updatedRows = await sql<{ tx_id: string }[]>`
      UPDATE mempool_txs
      SET pruned = false
      WHERE tx_id IN ${sql(txIds)}
      RETURNING tx_id
    `;

    const updatedTxs = updatedRows.map(r => r.tx_id);
    for (const tx of updatedTxs) {
      logger.verbose(`Updated mempool tx: ${tx}`);
    }

    let restoredTxs = updatedRows.map(r => r.tx_id);

    // txs that didnt exist in the mempool need to be inserted into the mempool
    if (updatedRows.length < txIds.length) {
      const txsRequiringInsertion = txIds.filter(txId => !updatedTxs.includes(txId));

      logger.verbose(
        `To restore mempool txs, ${txsRequiringInsertion.length} txs require insertion`
      );

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
        logger.verbose(`Inserted mempool tx: ${tx.tx_id}`);
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
    if (txIds.length === 0) {
      // Avoid an unnecessary query.
      return { removedTxs: [] };
    }
    for (const txId of txIds) {
      logger.verbose(`Pruning mempool tx: ${txId}`);
    }
    const updateResults = await sql<{ tx_id: string }[]>`
      UPDATE mempool_txs
      SET pruned = true
      WHERE tx_id IN ${sql(txIds)}
      RETURNING tx_id
    `;
    const removedTxs = updateResults.map(r => r.tx_id);
    return { removedTxs: removedTxs };
  }

  /**
   * Deletes mempool txs older than `STACKS_MEMPOOL_TX_GARBAGE_COLLECTION_THRESHOLD` blocks (default 256).
   * @param sql - DB client
   * @returns List of deleted `tx_id`s
   */
  async deleteGarbageCollectedMempoolTxs(sql: PgSqlClient): Promise<{ deletedTxs: string[] }> {
    // Get threshold block.
    const blockThreshold = process.env['STACKS_MEMPOOL_TX_GARBAGE_COLLECTION_THRESHOLD'] ?? 256;
    const cutoffResults = await sql<{ block_height: number }[]>`
      SELECT (MAX(block_height) - ${blockThreshold}) AS block_height
      FROM blocks
      WHERE canonical = TRUE
    `;
    if (cutoffResults.length != 1) {
      return { deletedTxs: [] };
    }
    const cutoffBlockHeight = cutoffResults[0].block_height;
    // Delete every mempool tx that came before that block.
    // TODO: Use DELETE instead of UPDATE once we implement a non-archival API replay mode.
    const deletedTxResults = await sql<{ tx_id: string }[]>`
      UPDATE mempool_txs
      SET pruned = TRUE, status = ${DbTxStatus.DroppedApiGarbageCollect}
      WHERE pruned = FALSE AND receipt_block_height < ${cutoffBlockHeight}
      RETURNING tx_id
    `;
    const deletedTxs = deletedTxResults.map(r => r.tx_id);
    return { deletedTxs: deletedTxs };
  }

  async markEntitiesCanonical(
    sql: PgSqlClient,
    indexBlockHash: string,
    canonical: boolean,
    updatedEntities: UpdatedEntities
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
      logger.verbose(`Marked tx as ${canonical ? 'canonical' : 'non-canonical'}: ${txId.tx_id}`);
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

    const poxResult = await sql`
      UPDATE pox2_events
      SET canonical = ${canonical}
      WHERE index_block_hash = ${indexBlockHash} AND canonical != ${canonical}
    `;
    if (canonical) {
      updatedEntities.markedCanonical.pox2Events += poxResult.count;
    } else {
      updatedEntities.markedNonCanonical.pox2Events += poxResult.count;
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
    updatedEntities: UpdatedEntities
  ): Promise<UpdatedEntities> {
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
      await this.restoreMempoolTxs(sql, markNonCanonicalResult.txsMarkedNonCanonical);
    }

    // The canonical microblock tables _must_ be restored _after_ orphaning all other blocks at a given height,
    // because there is only 1 row per microblock hash, and both the orphaned blocks at this height and the
    // canonical block can be pointed to the same microblocks.
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

    microblocksOrphaned.forEach(mb => logger.verbose(`Marked microblock as non-canonical: ${mb}`));
    microblocksAccepted.forEach(mb => logger.verbose(`Marked microblock as canonical: ${mb}`));

    const markCanonicalResult = await this.markEntitiesCanonical(
      sql,
      indexBlockHash,
      true,
      updatedEntities
    );
    const removedTxsResult = await this.pruneMempoolTxs(
      sql,
      markCanonicalResult.txsMarkedCanonical
    );
    if (removedTxsResult.removedTxs.length > 0) {
      logger.verbose(
        `Removed ${removedTxsResult.removedTxs.length} txs from mempool table during reorg handling`
      );
    }
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
        pox2Events: 0,
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
        pox2Events: 0,
        contractLogs: 0,
        smartContracts: 0,
        names: 0,
        namespaces: 0,
        subdomains: 0,
      },
    };

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

      if (parentResult.length > 1) {
        throw new Error(
          `DB contains multiple blocks at height ${block.block_height - 1} and index_hash ${
            block.parent_index_block_hash
          }`
        );
      }
      if (parentResult.length === 0) {
        throw new Error(
          `DB does not contain a parent block at height ${block.block_height - 1} with index_hash ${
            block.parent_index_block_hash
          }`
        );
      }

      // This blocks builds off a previously orphaned chain. Restore canonical status for this chain.
      if (!parentResult[0].canonical && block.block_height > chainTipHeight) {
        await this.restoreOrphanedChain(sql, parentResult[0].index_block_hash, updatedEntities);
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
   * @param viewName - Materialized view name
   * @param sql - Pg scoped client. Will use the default client if none specified
   * @param skipDuringEventReplay - If we should skip refreshing during event replay
   */
  async refreshMaterializedView(viewName: string, sql?: PgSqlClient, skipDuringEventReplay = true) {
    sql = sql ?? this.sql;
    if (this.isEventReplay && skipDuringEventReplay) {
      return;
    }
    const ibdHeight = getIbdBlockHeight();
    if (ibdHeight && (await this.getChainTip(sql, false)).blockHeight <= ibdHeight) {
      return;
    }
    await sql`REFRESH MATERIALIZED VIEW ${isProdEnv ? sql`CONCURRENTLY` : sql``} ${sql(viewName)}`;
  }

  /**
   * Refreshes the `nft_custody` and `nft_custody_unanchored` materialized views if necessary.
   * @param sql - DB client
   * @param txs - Transaction event data
   * @param unanchored - If this refresh is requested from a block or microblock
   */
  async refreshNftCustody(txs: DataStoreTxEventData[], unanchored: boolean = false) {
    await this.sqlWriteTransaction(async sql => {
      const newNftEventCount = txs
        .map(tx => tx.nftEvents.length)
        .reduce((prev, cur) => prev + cur, 0);
      if (newNftEventCount > 0) {
        // Always refresh unanchored view since even if we're in a new anchored block we should update the
        // unanchored state to the current one.
        await this.refreshMaterializedView('nft_custody_unanchored', sql);
        if (!unanchored) {
          await this.refreshMaterializedView('nft_custody', sql);
        }
      } else if (!unanchored) {
        // Even if we didn't receive new NFT events in a new anchor block, we should check if we need to
        // update the anchored view to reflect any changes made by previous microblocks.
        const result = await sql<{ outdated: boolean }[]>`
          WITH anchored_height AS (SELECT MAX(block_height) AS anchored FROM nft_custody),
            unanchored_height AS (SELECT MAX(block_height) AS unanchored FROM nft_custody_unanchored)
          SELECT unanchored > anchored AS outdated
          FROM anchored_height CROSS JOIN unanchored_height
        `;
        if (result.length > 0 && result[0].outdated) {
          await this.refreshMaterializedView('nft_custody', sql);
        }
      }
    });
  }

  /**
   * Called when a full event import is complete.
   */
  async finishEventReplay() {
    if (!this.isEventReplay) {
      return;
    }
    await this.sqlWriteTransaction(async sql => {
      await this.refreshMaterializedView('nft_custody', sql, false);
      await this.refreshMaterializedView('nft_custody_unanchored', sql, false);
      await this.refreshMaterializedView('chain_tip', sql, false);
      await this.refreshMaterializedView('mempool_digest', sql, false);
    });
  }
}
