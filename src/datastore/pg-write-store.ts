import * as assert from 'assert';
import * as prom from 'prom-client';
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
  DbPoxSetSigners,
  PoxSetSignerValues,
  PoxCycleInsertValues,
} from './common';
import {
  BLOCK_COLUMNS,
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
  PgWriteQueue,
  removeNullBytes,
} from './helpers';
import { PgNotifier } from './pg-notifier';
import { MIGRATIONS_DIR, PgStore } from './pg-store';
import * as zoneFileParser from 'zone-file';
import { parseResolver, parseZoneFileTxt } from '../event-stream/bns/bns-helpers';
import { SyntheticPoxEventName } from '../pox-helpers';
import { logger } from '../logger';
import {
  PgSqlClient,
  batchIterate,
  connectPostgres,
  isProdEnv,
  isTestEnv,
  runMigrations,
} from '@hirosystems/api-toolkit';
import { PgServer, getConnectionArgs, getConnectionConfig } from './connection';
import { BigNumber } from 'bignumber.js';
import { RedisNotifier } from './redis-notifier';

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

type TransactionHeader = {
  txId: string;
  sender_address: string;
  sponsor_address?: string;
  sponsored: boolean;
  nonce: number;
};

/**
 * Extends `PgStore` to provide data insertion functions. These added features are usually called by
 * the `EventServer` upon receiving blockchain events from a Stacks node. It also deals with chain data
 * re-orgs and Postgres NOTIFY message broadcasts when important data is written into the DB.
 */
export class PgWriteStore extends PgStore {
  readonly isEventReplay: boolean;
  protected readonly redisNotifier: RedisNotifier | undefined = undefined;
  protected isIbdBlockHeightReached = false;
  private metrics:
    | {
        blockHeight: prom.Gauge;
        burnBlockHeight: prom.Gauge;
      }
    | undefined;

  constructor(
    sql: PgSqlClient,
    notifier: PgNotifier | undefined = undefined,
    isEventReplay: boolean = false,
    redisNotifier: RedisNotifier | undefined = undefined
  ) {
    super(sql, notifier);
    this.isEventReplay = isEventReplay;
    this.redisNotifier = redisNotifier;
    if (isProdEnv) {
      this.metrics = {
        blockHeight: new prom.Gauge({
          name: 'stacks_block_height',
          help: 'Current chain tip block height',
        }),
        burnBlockHeight: new prom.Gauge({
          name: 'burn_block_height',
          help: 'Current burn block height',
        }),
      };
    }
  }

  static async connect({
    usageName,
    skipMigrations = false,
    withNotifier = true,
    withRedisNotifier = false,
    isEventReplay = false,
  }: {
    usageName: string;
    skipMigrations?: boolean;
    withNotifier?: boolean;
    withRedisNotifier?: boolean;
    isEventReplay?: boolean;
  }): Promise<PgWriteStore> {
    const sql = await connectPostgres({
      usageName: usageName,
      connectionArgs: getConnectionArgs(PgServer.primary),
      connectionConfig: getConnectionConfig(PgServer.primary),
    });
    if (!skipMigrations) {
      await runMigrations(MIGRATIONS_DIR, 'up', getConnectionArgs(PgServer.primary), {
        logger: {
          debug: _ => {},
          info: msg => {
            if (msg.includes('Migrating files')) {
              logger.info(`Performing SQL migration, this may take a while...`);
            }
          },
          warn: msg => logger.warn(msg),
          error: msg => logger.error(msg),
        },
      });
    }
    const notifier = withNotifier ? await PgNotifier.create(usageName) : undefined;
    const redisNotifier = withRedisNotifier ? new RedisNotifier() : undefined;
    const store = new PgWriteStore(sql, notifier, isEventReplay, redisNotifier);
    await store.connectPgNotifier();
    return store;
  }

  async storeRawEventRequest(eventPath: string, payload: any): Promise<void> {
    if (eventPath === '/new_block' && typeof payload === 'object') {
      for (const tx of payload.transactions) {
        if ('vm_error' in tx && tx.vm_error) {
          tx.vm_error = removeNullBytes(tx.vm_error);
        }
      }
    }
    await this.sqlWriteTransaction(async sql => {
      const insertResult = await sql<
        {
          id: string;
          receive_timestamp: string;
          event_path: string;
        }[]
      >`WITH inserted AS (
          INSERT INTO event_observer_requests(
            event_path, payload
          ) values(${eventPath}, ${payload})
          RETURNING id, receive_timestamp, event_path
        ),
        latest AS (
          INSERT INTO event_observer_timestamps (id, receive_timestamp, event_path)
          (SELECT id, receive_timestamp, event_path FROM inserted)
          ON CONFLICT (event_path) DO UPDATE SET
            id = EXCLUDED.id,
            receive_timestamp = EXCLUDED.receive_timestamp
        )
        SELECT id, receive_timestamp::text, event_path FROM inserted
      `;
      if (insertResult.length !== 1) {
        throw new Error(
          `Unexpected row count ${insertResult.length} when storing event_observer_requests entry`
        );
      }
    });
  }

  async update(data: DataStoreBlockUpdateData): Promise<void> {
    let garbageCollectedMempoolTxs: string[] = [];
    let newTxData: DataStoreTxEventData[] = [];
    let reorg: ReOrgUpdatedEntities = newReOrgUpdatedEntities();
    let isCanonical = true;

    await this.sqlWriteTransaction(async sql => {
      const chainTip = await this.getChainTip(sql);
      reorg = await this.handleReorg(sql, data.block, chainTip.block_height);
      isCanonical = data.block.block_height > chainTip.block_height;
      if (!isCanonical) {
        markBlockUpdateDataAsNonCanonical(data);
      } else {
        const prunableTxs: TransactionHeader[] = data.txs.map(d => ({
          txId: d.tx.tx_id,
          sender_address: d.tx.sender_address,
          sponsor_address: d.tx.sponsor_address,
          sponsored: d.tx.sponsored,
          nonce: d.tx.nonce,
        }));
        await this.pruneMempoolTxs(sql, prunableTxs);
      }

      // Insert microblocks, if any. Clear already inserted microblock txs from the anchor-block
      // update data to avoid duplicate inserts.
      const insertedMicroblockHashes = await this.insertMicroblocksFromBlockUpdate(sql, data);
      newTxData = data.txs.filter(entry => {
        return !insertedMicroblockHashes.has(entry.tx.microblock_hash);
      });

      // When processing an immediately-non-canonical block, do not orphan and possible existing
      // microblocks which may be still considered canonical by the canonical block at this height.
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
            burnBlockHeight: data.block.burn_block_height,
          }
        );

        // Identify any micro-orphaned txs that also didn't make it into this anchor block, and
        // restore them into the mempool
        const orphanedAndMissingTxs = orphanedMicroblockTxs.filter(
          tx => !data.txs.find(r => tx.tx_id === r.tx.tx_id)
        );
        const restoredMempoolTxs = await this.restoreMempoolTxs(
          sql,
          orphanedAndMissingTxs.map(tx => ({
            txId: tx.tx_id,
            sender_address: tx.sender_address,
            sponsor_address: tx.sponsor_address,
            sponsored: tx.sponsored,
            nonce: tx.nonce,
          }))
        );
        restoredMempoolTxs.restoredTxs.forEach(txId => {
          logger.info(`Restored micro-orphaned tx to mempool ${txId}`);
        });

        // Clear accepted microblock txs from the anchor-block update data to avoid duplicate
        // inserts.
        newTxData = newTxData.filter(entry => {
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
        const q = new PgWriteQueue();
        q.enqueue(() => this.updateMinerRewards(sql, data.minerRewards));
        // Block 0 is non-canonical, but we need to make sure its STX mint events get considered in
        // balance calculations.
        if (data.block.block_height == 0 || isCanonical) {
          // Use `data.txs` directly instead of `newTxData` for these STX/FT balance updates because
          // we don't want to skip balance changes in transactions that were previously confirmed
          // via microblocks.
          q.enqueue(() => this.updateStxBalances(sql, data.txs, data.minerRewards));
          q.enqueue(() => this.updateFtBalances(sql, data.txs));
          // If this block re-orgs past microblocks, though, we must discount the balances generated
          // by their txs which are now also reorged. We must do this here because the block re-org
          // logic is decoupled from the microblock re-org logic so previous balance updates will
          // not apply.
          q.enqueue(async () => {
            await this.updateFtBalancesFromMicroblockReOrg(sql, [
              ...reorg.markedNonCanonical.microblockHashes,
              ...reorg.markedCanonical.microblockHashes,
            ]);
          });
        }
        if (data.poxSetSigners && data.poxSetSigners.signers) {
          const poxSet = data.poxSetSigners;
          q.enqueue(() => this.updatePoxSetsBatch(sql, data.block, poxSet));
        }
        if (newTxData.length > 0) {
          q.enqueue(() =>
            this.updateTx(
              sql,
              newTxData.map(b => b.tx)
            )
          );
          q.enqueue(() => this.updateStxEvents(sql, newTxData));
          q.enqueue(() => this.updatePrincipalStxTxs(sql, newTxData));
          q.enqueue(() => this.updateSmartContractEvents(sql, newTxData));
          q.enqueue(() => this.updatePoxSyntheticEvents(sql, 'pox2_events', newTxData));
          q.enqueue(() => this.updatePoxSyntheticEvents(sql, 'pox3_events', newTxData));
          q.enqueue(() => this.updatePoxSyntheticEvents(sql, 'pox4_events', newTxData));
          q.enqueue(() => this.updateStxLockEvents(sql, newTxData));
          q.enqueue(() => this.updateFtEvents(sql, newTxData));
          for (const entry of newTxData) {
            q.enqueue(() => this.updateNftEvents(sql, entry.tx, entry.nftEvents));
            q.enqueue(() => this.updateSmartContracts(sql, entry.tx, entry.smartContracts));
            q.enqueue(() => this.updateNamespaces(sql, entry.tx, entry.namespaces));
            q.enqueue(() => this.updateNames(sql, entry.tx, entry.names));
          }
        }
        q.enqueue(async () => {
          const mempoolGarbageResults = await this.deleteGarbageCollectedMempoolTxs(sql);
          garbageCollectedMempoolTxs = mempoolGarbageResults.deletedTxs;
        });
        q.enqueue(async () => {
          await this.updateReplacedByFeeStatusForTxIds(
            sql,
            data.txs.map(t => t.tx.tx_id),
            false
          );
        });
        await q.done();
      }

      if (!this.isEventReplay) {
        this.debounceMempoolStat();
      }
      if (isCanonical) {
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
        if (this.metrics) {
          this.metrics.blockHeight.set(data.block.block_height);
        }
      }
    });
    if (isCanonical) {
      await this.redisNotifier?.notify(
        {
          index_block_hash: data.block.index_block_hash,
          block_height: data.block.block_height,
          block_time: data.block.block_time,
        },
        reorg
      );
    }
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
      block_time: block.block_time,
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
      tx_total_size: block.tx_total_size,
      tx_count: block.tx_count,
      signer_bitvec: block.signer_bitvec,
      signer_signatures: block.signer_signatures,
      tenure_height: block.tenure_height,
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
      const chainTip = await this.getChainTip(sql);
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
          burnBlockHeight: -1,
          microblocks: orphanedMicroblocks,
        });
        const microOrphanedTxs = microOrphanResult.updatedTxs;
        // Restore any micro-orphaned txs into the mempool
        const restoredMempoolTxs = await this.restoreMempoolTxs(
          sql,
          microOrphanedTxs.map(tx => ({
            txId: tx.tx_id,
            sender_address: tx.sender_address,
            sponsor_address: tx.sponsor_address,
            sponsored: tx.sponsored,
            nonce: tx.nonce,
          }))
        );
        restoredMempoolTxs.restoredTxs.forEach(txId => {
          logger.info(`Restored micro-orphaned tx to mempool ${txId}`);
        });
      }

      const prunableTxs: TransactionHeader[] = data.txs.map(d => ({
        txId: d.tx.tx_id,
        sender_address: d.tx.sender_address,
        sponsor_address: d.tx.sponsor_address,
        sponsored: d.tx.sponsored,
        nonce: d.tx.nonce,
      }));
      const removedTxsResult = await this.pruneMempoolTxs(sql, prunableTxs);
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
        burn_block_height = ${blockOne.burn_block_height},
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

  async updatePoxSyntheticEvents<
    T extends PoxSyntheticEventTable,
    Entry extends { tx: DbTx } & ('pox2_events' extends T
      ? { pox2Events: DbPoxSyntheticEvent[] }
      : 'pox3_events' extends T
      ? { pox3Events: DbPoxSyntheticEvent[] }
      : 'pox4_events' extends T
      ? { pox4Events: DbPoxSyntheticEvent[] }
      : never)
  >(sql: PgSqlClient, poxTable: T, entries: Entry[]) {
    const values: PoxSyntheticEventInsertValues[] = [];
    for (const entry of entries) {
      let events: DbPoxSyntheticEvent[] | null = null;
      switch (poxTable) {
        case 'pox2_events':
          assert('pox2Events' in entry);
          events = entry.pox2Events;
          break;
        case 'pox3_events':
          assert('pox3Events' in entry);
          events = entry.pox3Events;
          break;
        case 'pox4_events':
          assert('pox4Events' in entry);
          events = entry.pox4Events;
          break;
        default:
          throw new Error(`unknown pox table: ${poxTable}`);
      }
      const tx = entry.tx;
      for (const event of events ?? []) {
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
        if (poxTable === 'pox4_events') {
          value.signer_key = null;
          value.end_cycle_id = null;
          value.start_burn_height = null;
        }

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
            if (poxTable === 'pox4_events') {
              value.signer_key = event.data.signer_key;
              value.end_cycle_id = event.data.end_cycle_id?.toString() ?? null;
              value.start_cycle_id = event.data.start_cycle_id?.toString() ?? null;
            }
            break;
          }
          case SyntheticPoxEventName.StackIncrease: {
            value.increase_by = event.data.increase_by.toString();
            value.total_locked = event.data.total_locked.toString();
            if (poxTable === 'pox4_events') {
              value.signer_key = event.data.signer_key;
              value.end_cycle_id = event.data.end_cycle_id?.toString() ?? null;
              value.start_cycle_id = event.data.start_cycle_id?.toString() ?? null;
            }
            break;
          }
          case SyntheticPoxEventName.StackExtend: {
            value.extend_count = event.data.extend_count.toString();
            value.unlock_burn_height = event.data.unlock_burn_height.toString();
            if (poxTable === 'pox4_events') {
              value.signer_key = event.data.signer_key;
              value.end_cycle_id = event.data.end_cycle_id?.toString() ?? null;
              value.start_cycle_id = event.data.start_cycle_id?.toString() ?? null;
            }
            break;
          }
          case SyntheticPoxEventName.DelegateStx: {
            value.amount_ustx = event.data.amount_ustx.toString();
            value.delegate_to = event.data.delegate_to;
            value.unlock_burn_height = event.data.unlock_burn_height?.toString() ?? null;
            if (poxTable === 'pox4_events') {
              value.end_cycle_id = event.data.end_cycle_id?.toString() ?? null;
              value.start_cycle_id = event.data.start_cycle_id?.toString() ?? null;
            }
            break;
          }
          case SyntheticPoxEventName.DelegateStackStx: {
            value.lock_period = event.data.lock_period.toString();
            value.lock_amount = event.data.lock_amount.toString();
            value.start_burn_height = event.data.start_burn_height.toString();
            value.unlock_burn_height = event.data.unlock_burn_height.toString();
            value.delegator = event.data.delegator;
            if (poxTable === 'pox4_events') {
              value.end_cycle_id = event.data.end_cycle_id?.toString() ?? null;
              value.start_cycle_id = event.data.start_cycle_id?.toString() ?? null;
            }
            break;
          }
          case SyntheticPoxEventName.DelegateStackIncrease: {
            value.increase_by = event.data.increase_by.toString();
            value.total_locked = event.data.total_locked.toString();
            value.delegator = event.data.delegator;
            if (poxTable === 'pox4_events') {
              value.end_cycle_id = event.data.end_cycle_id?.toString() ?? null;
              value.start_cycle_id = event.data.start_cycle_id?.toString() ?? null;
            }
            break;
          }
          case SyntheticPoxEventName.DelegateStackExtend: {
            value.extend_count = event.data.extend_count.toString();
            value.unlock_burn_height = event.data.unlock_burn_height.toString();
            value.delegator = event.data.delegator;
            if (poxTable === 'pox4_events') {
              value.end_cycle_id = event.data.end_cycle_id?.toString() ?? null;
              value.start_cycle_id = event.data.start_cycle_id?.toString() ?? null;
            }
            break;
          }
          case SyntheticPoxEventName.StackAggregationCommit: {
            value.reward_cycle = event.data.reward_cycle.toString();
            value.amount_ustx = event.data.amount_ustx.toString();
            if (poxTable === 'pox4_events') {
              value.signer_key = event.data.signer_key;
              value.end_cycle_id = event.data.end_cycle_id?.toString() ?? null;
              value.start_cycle_id = event.data.start_cycle_id?.toString() ?? null;
            }
            break;
          }
          case SyntheticPoxEventName.StackAggregationCommitIndexed: {
            value.reward_cycle = event.data.reward_cycle.toString();
            value.amount_ustx = event.data.amount_ustx.toString();
            if (poxTable === 'pox4_events') {
              value.signer_key = event.data.signer_key;
              value.end_cycle_id = event.data.end_cycle_id?.toString() ?? null;
              value.start_cycle_id = event.data.start_cycle_id?.toString() ?? null;
            }
            break;
          }
          case SyntheticPoxEventName.StackAggregationIncrease: {
            value.reward_cycle = event.data.reward_cycle.toString();
            value.amount_ustx = event.data.amount_ustx.toString();
            if (poxTable === 'pox4_events') {
              value.end_cycle_id = event.data.end_cycle_id?.toString() ?? null;
              value.start_cycle_id = event.data.start_cycle_id?.toString() ?? null;
            }
            break;
          }
          case SyntheticPoxEventName.RevokeDelegateStx: {
            value.delegate_to = event.data.delegate_to;
            if (poxTable === 'pox4_events') {
              value.end_cycle_id = event.data.end_cycle_id?.toString() ?? null;
              value.start_cycle_id = event.data.start_cycle_id?.toString() ?? null;
            }
            break;
          }
          default: {
            throw new Error(
              `Unexpected Pox synthetic event name: ${(event as DbPoxSyntheticEvent).name}`
            );
          }
        }
        values.push(value);
      }
    }
    for (const batch of batchIterate(values, INSERT_BATCH_SIZE)) {
      const res = await sql`
        INSERT INTO ${sql(String(poxTable))} ${sql(batch)}
      `;
      assert(res.count === batch.length, `Expecting ${batch.length} inserts, got ${res.count}`);
    }
  }

  async updateStxLockEvents(
    sql: PgSqlClient,
    entries: { tx: DbTx; stxLockEvents: DbStxLockEvent[] }[]
  ) {
    const values: StxLockEventInsertValues[] = [];
    for (const { tx, stxLockEvents } of entries) {
      for (const event of stxLockEvents) {
        values.push({
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
        });
      }
    }
    for (const batch of batchIterate(values, INSERT_BATCH_SIZE)) {
      const res = await sql`
        INSERT INTO stx_lock_events ${sql(batch)}
      `;
      assert(res.count === batch.length, `Expecting ${batch.length} inserts, got ${res.count}`);
    }
  }

  async updateStxBalances(
    sql: PgSqlClient,
    entries: { tx: DbTx; stxEvents: DbStxEvent[] }[],
    minerRewards: DbMinerReward[]
  ) {
    const balanceMap = new Map<string, bigint>();

    for (const { tx, stxEvents } of entries) {
      if (tx.sponsored) {
        // Decrease the tx sponsor balance by the fee
        const balance = balanceMap.get(tx.sponsor_address as string) ?? BigInt(0);
        balanceMap.set(tx.sponsor_address as string, balance - BigInt(tx.fee_rate));
      } else {
        // Decrease the tx sender balance by the fee
        const balance = balanceMap.get(tx.sender_address) ?? BigInt(0);
        balanceMap.set(tx.sender_address, balance - BigInt(tx.fee_rate));
      }

      for (const event of stxEvents) {
        if (event.sender) {
          // Decrease the tx sender balance by the transfer amount
          const balance = balanceMap.get(event.sender) ?? BigInt(0);
          balanceMap.set(event.sender, balance - BigInt(event.amount));
        }
        if (event.recipient) {
          // Increase the tx recipient balance by the transfer amount
          const balance = balanceMap.get(event.recipient) ?? BigInt(0);
          balanceMap.set(event.recipient, balance + BigInt(event.amount));
        }
      }
    }

    for (const reward of minerRewards) {
      const balance = balanceMap.get(reward.recipient) ?? BigInt(0);
      const amount =
        reward.coinbase_amount +
        reward.tx_fees_anchored +
        reward.tx_fees_streamed_confirmed +
        reward.tx_fees_streamed_produced;
      balanceMap.set(reward.recipient, balance + BigInt(amount));
    }

    const values = Array.from(balanceMap, ([address, balance]) => ({
      address,
      token: 'stx',
      balance: balance.toString(),
    }));

    for (const batch of batchIterate(values, INSERT_BATCH_SIZE)) {
      const res = await sql`
        INSERT INTO ft_balances ${sql(batch)}
        ON CONFLICT (address, token)
        DO UPDATE
        SET balance = ft_balances.balance + EXCLUDED.balance
      `;
      assert(res.count === batch.length, `Expecting ${batch.length} inserts, got ${res.count}`);
    }
  }

  async updateFtBalances(sql: PgSqlClient, entries: { ftEvents: DbFtEvent[] }[]) {
    const balanceMap = new Map<string, { address: string; token: string; balance: bigint }>();

    for (const { ftEvents } of entries) {
      for (const event of ftEvents) {
        if (event.sender) {
          // Decrease the sender balance by the transfer amount
          const key = `${event.sender}|${event.asset_identifier}`;
          const balance = balanceMap.get(key)?.balance ?? BigInt(0);
          balanceMap.set(key, {
            address: event.sender,
            token: event.asset_identifier,
            balance: balance - BigInt(event.amount),
          });
        }
        if (event.recipient) {
          // Increase the recipient balance by the transfer amount
          const key = `${event.recipient}|${event.asset_identifier}`;
          const balance = balanceMap.get(key)?.balance ?? BigInt(0);
          balanceMap.set(key, {
            address: event.recipient,
            token: event.asset_identifier,
            balance: balance + BigInt(event.amount),
          });
        }
      }
    }

    const values = Array.from(balanceMap, ([, entry]) => ({
      address: entry.address,
      token: entry.token,
      balance: entry.balance.toString(),
    }));

    for (const batch of batchIterate(values, INSERT_BATCH_SIZE)) {
      const res = await sql`
        INSERT INTO ft_balances ${sql(batch)}
        ON CONFLICT (address, token)
        DO UPDATE
        SET balance = ft_balances.balance + EXCLUDED.balance
      `;
      assert(res.count === batch.length, `Expecting ${batch.length} inserts, got ${res.count}`);
    }
  }

  async updateFtBalancesFromMicroblockReOrg(sql: PgSqlClient, microblockHashes: string[]) {
    if (microblockHashes.length === 0) return;
    await sql`
      WITH updated_txs AS (
        SELECT tx_id, sender_address, nonce, sponsor_address, fee_rate, sponsored, canonical, microblock_canonical
        FROM txs
        WHERE microblock_hash IN ${sql(microblockHashes)}
      ),
      affected_addresses AS (
          SELECT
            sender_address AS address,
            fee_rate AS fee_change,
            canonical,
            microblock_canonical,
            sponsored
          FROM updated_txs
          WHERE sponsored = false
        UNION ALL
          SELECT
            sponsor_address AS address,
            fee_rate AS fee_change,
            canonical,
            microblock_canonical,
            sponsored
          FROM updated_txs
          WHERE sponsored = true
      ),
      balances_update AS (
        SELECT
          a.address,
          SUM(CASE WHEN a.canonical AND a.microblock_canonical THEN -a.fee_change ELSE a.fee_change END) AS balance_change
        FROM affected_addresses a
        GROUP BY a.address
      )
      INSERT INTO ft_balances (address, token, balance)
      SELECT b.address, 'stx', b.balance_change
      FROM balances_update b
      ON CONFLICT (address, token)
      DO UPDATE
      SET balance = ft_balances.balance + EXCLUDED.balance
      RETURNING ft_balances.address
    `;
    await sql`
      WITH updated_events AS (
        SELECT sender, recipient, amount, asset_event_type_id, asset_identifier, canonical, microblock_canonical
        FROM ft_events
        WHERE microblock_hash IN ${sql(microblockHashes)}
      ),
      event_changes AS (
        SELECT address, asset_identifier, SUM(balance_change) AS balance_change
        FROM (
            SELECT sender AS address, asset_identifier,
              SUM(CASE WHEN canonical AND microblock_canonical THEN -amount ELSE amount END) AS balance_change
            FROM updated_events
            WHERE asset_event_type_id IN (1, 3) -- Transfers and Burns affect the sender's balance
            GROUP BY sender, asset_identifier
          UNION ALL
            SELECT recipient AS address, asset_identifier,
              SUM(CASE WHEN canonical AND microblock_canonical THEN amount ELSE -amount END) AS balance_change
            FROM updated_events
            WHERE asset_event_type_id IN (1, 2) -- Transfers and Mints affect the recipient's balance
            GROUP BY recipient, asset_identifier
        ) AS subquery
        GROUP BY address, asset_identifier
      )
      INSERT INTO ft_balances (address, token, balance)
      SELECT ec.address, ec.asset_identifier, ec.balance_change
      FROM event_changes ec
      ON CONFLICT (address, token)
      DO UPDATE
      SET balance = ft_balances.balance + EXCLUDED.balance
      RETURNING ft_balances.address
    `;
    await sql`
      WITH updated_events AS (
        SELECT sender, recipient, amount, asset_event_type_id, canonical, microblock_canonical
        FROM stx_events
        WHERE microblock_hash IN ${sql(microblockHashes)}
      ),
      event_changes AS (
        SELECT
          address,
          SUM(balance_change) AS balance_change
        FROM (
            SELECT
              sender AS address,
              SUM(CASE WHEN canonical AND microblock_canonical THEN -amount ELSE amount END) AS balance_change
            FROM updated_events
            WHERE asset_event_type_id IN (1, 3) -- Transfers and Burns affect the sender's balance
            GROUP BY sender
          UNION ALL
            SELECT
              recipient AS address,
              SUM(CASE WHEN canonical AND microblock_canonical THEN amount ELSE -amount END) AS balance_change
            FROM updated_events
            WHERE asset_event_type_id IN (1, 2) -- Transfers and Mints affect the recipient's balance
            GROUP BY recipient
        ) AS subquery
        GROUP BY address
      )
      INSERT INTO ft_balances (address, token, balance)
      SELECT ec.address, 'stx', ec.balance_change
      FROM event_changes ec
      ON CONFLICT (address, token)
      DO UPDATE
      SET balance = ft_balances.balance + EXCLUDED.balance
      RETURNING ft_balances.address
    `;
  }

  async updateStxEvents(sql: PgSqlClient, entries: { tx: DbTx; stxEvents: DbStxEvent[] }[]) {
    const values: StxEventInsertValues[] = [];
    for (const { tx, stxEvents } of entries) {
      for (const event of stxEvents) {
        values.push({
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
        });
      }
    }
    for (const batch of batchIterate(values, INSERT_BATCH_SIZE)) {
      const res = await sql`
        INSERT INTO stx_events ${sql(batch)}
      `;
      assert(res.count === batch.length, `Expecting ${batch.length} inserts, got ${res.count}`);
    }
  }

  /**
   * Update the `principal_stx_tx` table with the latest `tx_id`s that resulted in a STX
   * transfer relevant to a principal (stx address or contract id).
   * @param sql - DB client
   * @param entries - list of tx and stxEvents
   */
  async updatePrincipalStxTxs(sql: PgSqlClient, entries: { tx: DbTx; stxEvents: DbStxEvent[] }[]) {
    const values: PrincipalStxTxsInsertValues[] = [];
    for (const { tx, stxEvents } of entries) {
      const principals = new Set<string>(
        [
          tx.sender_address,
          tx.token_transfer_recipient_address,
          tx.contract_call_contract_id,
          tx.smart_contract_contract_id,
          tx.sponsor_address,
        ].filter((p): p is string => !!p)
      );
      for (const event of stxEvents) {
        if (event.sender) principals.add(event.sender);
        if (event.recipient) principals.add(event.recipient);
      }
      for (const principal of principals) {
        values.push({
          principal: principal,
          tx_id: tx.tx_id,
          block_height: tx.block_height,
          index_block_hash: tx.index_block_hash,
          microblock_hash: tx.microblock_hash,
          microblock_sequence: tx.microblock_sequence,
          tx_index: tx.tx_index,
          canonical: tx.canonical,
          microblock_canonical: tx.microblock_canonical,
        });
      }
    }

    for (const eventBatch of batchIterate(values, INSERT_BATCH_SIZE)) {
      await sql`
        INSERT INTO principal_stx_txs ${sql(eventBatch)}
        ON CONFLICT ON CONSTRAINT unique_principal_tx_id_index_block_hash_microblock_hash DO NOTHING
      `;
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
    assert(
      result.count === zonefileValues.length,
      `Expecting ${result.count} zonefile inserts, got ${zonefileValues.length}`
    );
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
    assert(
      result.count === subdomainValues.length,
      `Expecting ${subdomainValues.length} subdomain inserts, got ${result.count}`
    );
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

  async updateFtEvents(sql: PgSqlClient, entries: { tx: DbTx; ftEvents: DbFtEvent[] }[]) {
    const values: FtEventInsertValues[] = [];
    for (const { tx, ftEvents } of entries) {
      for (const event of ftEvents) {
        values.push({
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
        });
      }
    }
    for (const batch of batchIterate(values, INSERT_BATCH_SIZE)) {
      const res = await sql`
        INSERT INTO ft_events ${sql(batch)}
      `;
      assert(res.count === batch.length, `Expecting ${batch.length} inserts, got ${res.count}`);
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
        await sql`
          INSERT INTO nft_custody ${sql(Array.from(custodyInsertsMap.values()))}
          ON CONFLICT ON CONSTRAINT nft_custody_unique DO UPDATE SET
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
              EXCLUDED.block_height > nft_custody.block_height
            )
            OR (
              EXCLUDED.block_height = nft_custody.block_height
              AND EXCLUDED.microblock_sequence > nft_custody.microblock_sequence
            )
            OR (
              EXCLUDED.block_height = nft_custody.block_height
              AND EXCLUDED.microblock_sequence = nft_custody.microblock_sequence
              AND EXCLUDED.tx_index > nft_custody.tx_index
            )
            OR (
              EXCLUDED.block_height = nft_custody.block_height
              AND EXCLUDED.microblock_sequence = nft_custody.microblock_sequence
              AND EXCLUDED.tx_index = nft_custody.tx_index
              AND EXCLUDED.event_index > nft_custody.event_index
            )
        `;
      }
    }
  }

  async updateSmartContractEvents(
    sql: PgSqlClient,
    entries: { tx: DbTx; contractLogEvents: DbSmartContractEvent[] }[]
  ) {
    const values: SmartContractEventInsertValues[] = [];
    for (const { tx, contractLogEvents } of entries) {
      for (const event of contractLogEvents) {
        values.push({
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
        });
      }
    }
    for (const batch of batchIterate(values, INSERT_BATCH_SIZE)) {
      const res = await sql`
        INSERT INTO contract_logs ${sql(batch)}
      `;
      assert(res.count === batch.length, `Expecting ${batch.length} inserts, got ${res.count}`);
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

  async updatePoxSetsBatch(sql: PgSqlClient, block: DbBlock, poxSet: DbPoxSetSigners) {
    const totalWeight = poxSet.signers.reduce((acc, signer) => acc + signer.weight, 0);
    const totalStacked = poxSet.signers.reduce((acc, signer) => acc + signer.stacked_amount, 0n);

    const cycleValues: PoxCycleInsertValues = {
      canonical: block.canonical,
      block_height: block.block_height,
      index_block_hash: block.index_block_hash,
      parent_index_block_hash: block.parent_index_block_hash,
      cycle_number: poxSet.cycle_number,
      total_stacked_amount: totalStacked,
      total_weight: totalWeight,
      total_signers: poxSet.signers.length,
    };
    await sql`
      INSERT INTO pox_cycles ${sql(cycleValues)}
      ON CONFLICT ON CONSTRAINT pox_cycles_unique DO NOTHING
    `;

    for (const signer of poxSet.signers) {
      const values: PoxSetSignerValues = {
        canonical: block.canonical,
        index_block_hash: block.index_block_hash,
        parent_index_block_hash: block.parent_index_block_hash,
        block_height: block.block_height,
        cycle_number: poxSet.cycle_number,
        pox_ustx_threshold: poxSet.pox_ustx_threshold,
        signing_key: signer.signing_key,
        weight: signer.weight,
        stacked_amount: signer.stacked_amount,
        weight_percent: (signer.weight / totalWeight) * 100,
        stacked_amount_percent: new BigNumber(signer.stacked_amount.toString())
          .div(totalStacked.toString())
          .times(100)
          .toNumber(),
        total_stacked_amount: totalStacked,
        total_weight: totalWeight,
      };
      const signerInsertResult = await sql`
        INSERT into pox_sets ${sql(values)}
      `;
      if (signerInsertResult.count !== 1) {
        throw new Error(`Failed to insert pox signer set at block ${block.index_block_hash}`);
      }
    }
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
      burnBlockHeight: number;
    }
  ): Promise<{
    acceptedMicroblockTxs: DbTx[];
    orphanedMicroblockTxs: DbTx[];
    acceptedMicroblocks: string[];
    orphanedMicroblocks: string[];
  }> {
    // Find the parent microblock if this anchor block points to one. If not, perform a sanity check
    // for expected block headers in this case: Anchored blocks that do not have parent microblock
    // streams will have their parent microblock header hashes set to all 0's, and the parent
    // microblock sequence number set to 0.
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
        burnBlockHeight: blockData.burnBlockHeight,
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
        burnBlockHeight: blockData.burnBlockHeight,
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

  async updateBurnchainRewards({ rewards }: { rewards: DbBurnchainReward[] }): Promise<void> {
    return await this.sqlWriteTransaction(async sql => {
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

  async updateBurnChainBlockHeight(args: { blockHeight: number }): Promise<void> {
    const result = await this.sql<{ burn_block_height: number }[]>`
      UPDATE chain_tip SET burn_block_height = GREATEST(${args.blockHeight}, burn_block_height)
      RETURNING burn_block_height
    `;
    if (this.metrics && result.length > 0) {
      this.metrics.burnBlockHeight.set(result[0].burn_block_height);
    }
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

  async updateTx(sql: PgSqlClient, txs: DbTxRaw | DbTxRaw[]): Promise<number> {
    if (!Array.isArray(txs)) txs = [txs];
    const values: TxInsertValues[] = txs.map(tx => ({
      tx_id: tx.tx_id,
      raw_tx: tx.raw_tx,
      tx_index: tx.tx_index,
      index_block_hash: tx.index_block_hash,
      parent_index_block_hash: tx.parent_index_block_hash,
      block_hash: tx.block_hash,
      parent_block_hash: tx.parent_block_hash,
      block_height: tx.block_height,
      block_time: tx.block_time,
      burn_block_height: tx.burn_block_height,
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
      smart_contract_source_code: tx.smart_contract_source_code
        ? removeNullBytes(tx.smart_contract_source_code)
        : null,
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
      raw_result: tx.raw_result,
      event_count: tx.event_count,
      execution_cost_read_count: tx.execution_cost_read_count,
      execution_cost_read_length: tx.execution_cost_read_length,
      execution_cost_runtime: tx.execution_cost_runtime,
      execution_cost_write_count: tx.execution_cost_write_count,
      execution_cost_write_length: tx.execution_cost_write_length,
      vm_error: tx.vm_error ? removeNullBytes(tx.vm_error) : null,
    }));

    let count = 0;
    for (const eventBatch of batchIterate(values, INSERT_BATCH_SIZE)) {
      const res = await sql`
        INSERT INTO txs ${sql(eventBatch)}
        ON CONFLICT ON CONSTRAINT unique_tx_id_index_block_hash_microblock_hash DO NOTHING
      `;
      count += res.count;
    }
    return count;
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
        replaced_by_tx_id: tx.replaced_by_tx_id ?? null,
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
      }));

      // Revive mempool txs that were previously dropped.
      const revivedTxs = await sql<{ tx_id: string }[]>`
        UPDATE mempool_txs
        SET pruned = false,
            status = ${DbTxStatus.Pending},
            replaced_by_tx_id = NULL,
            receipt_block_height = ${values[0].receipt_block_height},
            receipt_time = ${values[0].receipt_time}
        WHERE tx_id IN ${sql(values.map(v => v.tx_id))}
          AND pruned = true
          AND NOT EXISTS (
            SELECT 1
            FROM txs
            WHERE txs.tx_id = mempool_txs.tx_id
              AND txs.canonical = true
              AND txs.microblock_canonical = true
          )
        RETURNING tx_id
      `;
      txIds.push(...revivedTxs.map(r => r.tx_id));

      // Insert new mempool txs.
      const inserted = await sql<{ tx_id: string }[]>`
        WITH inserted AS (
          INSERT INTO mempool_txs ${sql(values)}
          ON CONFLICT ON CONSTRAINT unique_tx_id DO NOTHING
          RETURNING tx_id
        ),
        count_update AS (
          UPDATE chain_tip SET
            mempool_tx_count = mempool_tx_count
              + (SELECT COUNT(*) FROM inserted)
              + ${revivedTxs.count},
            mempool_updated_at = NOW()
        )
        SELECT tx_id FROM inserted
      `;
      txIds.push(...inserted.map(r => r.tx_id));

      // The incoming mempool transactions might have already been mined. We need to mark them as
      // pruned to avoid inconsistent tx state.
      const pruned_tx = await sql<{ tx_id: string }[]>`
        SELECT tx_id
        FROM txs
        WHERE
          tx_id IN ${sql(batch.map(b => b.tx_id))} AND
          canonical = true AND
          microblock_canonical = true`;
      if (pruned_tx.length > 0) {
        await sql`
          WITH pruned AS (
            UPDATE mempool_txs
            SET pruned = true
            WHERE
              tx_id IN ${sql(pruned_tx.map(t => t.tx_id))} AND
              pruned = false
            RETURNING tx_id
          )
          UPDATE chain_tip SET
            mempool_tx_count = mempool_tx_count - (SELECT COUNT(*) FROM pruned),
            mempool_updated_at = NOW()
          `;
      }
    }
    await this.updateReplacedByFeeStatusForTxIds(sql, txIds);
    return txIds;
  }

  /**
   * Newly confirmed/pruned/restored transactions may have changed the RBF situation for
   * transactions with equal nonces. Look for these cases and update txs accordingly.
   * @param sql - SQL client
   * @param txIds - Updated mempool tx ids
   * @param mempool - If we should look in the mempool for these txs
   */
  private async updateReplacedByFeeStatusForTxIds(
    sql: PgSqlClient,
    txIds: string[],
    mempool: boolean = true
  ): Promise<void> {
    if (txIds.length === 0) return;

    // If a transaction with equal nonce was confirmed in a block, mark all conflicting mempool txs
    // as RBF. Otherwise, look for the one with the highest fee in the mempool and RBF all the
    // others.
    //
    // Note that we're not filtering by `pruned` when we look at the mempool, because we want the
    // RBF data to be retroactively applied to all conflicting txs we've ever seen.
    for (const batch of batchIterate(txIds, INSERT_BATCH_SIZE)) {
      await sql`
        WITH input_txids (tx_id) AS (
          VALUES ${sql(batch.map(id => [id.replace('0x', '\\x')]))}
        ),
        source_txs AS (
          SELECT DISTINCT
            tx_id,
            (CASE sponsored WHEN true THEN sponsor_address ELSE sender_address END) AS address,
            nonce
          FROM ${mempool ? sql`mempool_txs` : sql`txs`}
          WHERE tx_id IN (SELECT tx_id::bytea FROM input_txids)
        ),
        affected_groups AS (
          SELECT DISTINCT address, nonce
          FROM source_txs
        ),
        same_nonce_mempool_txs AS (
          SELECT
            m.tx_id,
            m.fee_rate,
            m.receipt_time,
            m.pruned,
            g.address,
            g.nonce
          FROM mempool_txs m
          INNER JOIN affected_groups g
            ON m.nonce = g.nonce
            AND (m.sponsor_address = g.address OR m.sender_address = g.address)
        ),
        mined_txs AS (
          SELECT
            t.tx_id,
            g.address,
            g.nonce
          FROM txs t
          INNER JOIN affected_groups g
            ON t.nonce = g.nonce
            AND (t.sponsor_address = g.address OR t.sender_address = g.address)
          WHERE t.canonical = true AND t.microblock_canonical = true
          ORDER BY t.block_height DESC, t.microblock_sequence DESC, t.tx_index DESC
        ),
        latest_mined_txs AS (
          SELECT DISTINCT ON (address, nonce) tx_id, address, nonce
          FROM mined_txs
        ),
        highest_fee_mempool_txs AS (
          SELECT DISTINCT ON (address, nonce) tx_id, address, nonce
          FROM same_nonce_mempool_txs
          ORDER BY address, nonce, fee_rate DESC, receipt_time DESC
        ),
        winning_txs AS (
          SELECT
            g.address,
            g.nonce,
            COALESCE(l.tx_id, h.tx_id) AS tx_id
          FROM affected_groups g
          LEFT JOIN latest_mined_txs l USING (address, nonce)
          LEFT JOIN highest_fee_mempool_txs h USING (address, nonce)
        ),
        txs_to_prune AS (
          SELECT
            s.tx_id,
            s.pruned
          FROM same_nonce_mempool_txs s
          INNER JOIN winning_txs w USING (address, nonce)
          WHERE s.tx_id <> w.tx_id
        ),
        pruned AS (
          UPDATE mempool_txs m
          SET pruned = TRUE,
            status = ${DbTxStatus.DroppedReplaceByFee},
            replaced_by_tx_id = (
              SELECT w.tx_id
              FROM winning_txs w
              INNER JOIN same_nonce_mempool_txs s ON w.address = s.address AND w.nonce = s.nonce
              WHERE s.tx_id = m.tx_id
            )
          FROM txs_to_prune p
          WHERE m.tx_id = p.tx_id
          RETURNING m.tx_id
        )
        UPDATE chain_tip SET
          mempool_tx_count = mempool_tx_count - (SELECT COUNT(*) FROM txs_to_prune WHERE pruned = FALSE),
          mempool_updated_at = NOW()
      `;
    }
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
      const sql = await connectPostgres({
        usageName: `mempool-debounce`,
        connectionArgs: getConnectionArgs(PgServer.primary),
        connectionConfig: getConnectionConfig(PgServer.primary),
      });
      try {
        const mempoolStats = await sql.begin(async sql => {
          return await this.getMempoolStatsInternal({ sql });
        });
        this.eventEmitter.emit('mempoolStatsUpdate', mempoolStats);
      } catch (e: unknown) {
        const connectionError = e as Error & { code: string };
        if (
          connectionError instanceof Error &&
          ['CONNECTION_ENDED', 'CONNECTION_DESTROYED', 'CONNECTION_CLOSED'].includes(
            connectionError.code
          )
        ) {
          logger.info(`Skipping mempool stats query because ${connectionError.code}`);
        } else {
          logger.error(e, `failed to run mempool stats update`);
        }
      } finally {
        await sql.end();
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
      const chainTip = await this.getChainTip(sql);
      updatedTxIds.push(...(await this.insertDbMempoolTxs(txs, chainTip, sql)));
    });
    if (!this.isEventReplay) {
      this.debounceMempoolStat();
    }
    for (const txId of updatedTxIds) {
      await this.notifier?.sendTx({ txId });
    }
  }

  async dropMempoolTxs({
    status,
    txIds,
    new_tx_id,
  }: {
    status: DbTxStatus;
    txIds: string[];
    new_tx_id: string | null;
  }): Promise<void> {
    for (const batch of batchIterate(txIds, INSERT_BATCH_SIZE)) {
      const updateResults = await this.sql<{ tx_id: string }[]>`
        WITH pruned AS (
          UPDATE mempool_txs
          SET pruned = TRUE, status = ${status}, replaced_by_tx_id = ${new_tx_id}
          WHERE tx_id IN ${this.sql(batch)} AND pruned = FALSE
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
  }

  async updateSmartContracts(sql: PgSqlClient, tx: DbTx, smartContracts: DbSmartContract[]) {
    for (const batch of batchIterate(smartContracts, INSERT_BATCH_SIZE)) {
      const values: SmartContractInsertValues[] = batch.map(smartContract => ({
        tx_id: smartContract.tx_id,
        canonical: smartContract.canonical,
        clarity_version: smartContract.clarity_version ?? null,
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
      assert(
        res.count === lockedInfos.length,
        `Expecting ${lockedInfos.length} inserts, got ${res.count}`
      );
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

    if (txs.length > 0) {
      const q = new PgWriteQueue();
      q.enqueue(async () => {
        const rowsUpdated = await this.updateTx(
          sql,
          txs.map(t => t.tx)
        );
        if (rowsUpdated !== txs.length)
          throw new Error(
            `Unexpected amount of rows updated for microblock tx insert: ${rowsUpdated}, expecting ${txs.length}`
          );
      });
      q.enqueue(() => this.updateStxEvents(sql, txs));
      q.enqueue(() => this.updatePrincipalStxTxs(sql, txs));
      q.enqueue(() => this.updateSmartContractEvents(sql, txs));
      q.enqueue(() => this.updatePoxSyntheticEvents(sql, 'pox2_events', txs));
      q.enqueue(() => this.updatePoxSyntheticEvents(sql, 'pox3_events', txs));
      q.enqueue(() => this.updatePoxSyntheticEvents(sql, 'pox4_events', txs));
      q.enqueue(() => this.updateStxLockEvents(sql, txs));
      q.enqueue(() => this.updateFtEvents(sql, txs));
      for (const entry of txs) {
        q.enqueue(() => this.updateNftEvents(sql, entry.tx, entry.nftEvents, true));
        q.enqueue(() => this.updateSmartContracts(sql, entry.tx, entry.smartContracts));
        q.enqueue(() => this.updateNamespaces(sql, entry.tx, entry.namespaces));
        q.enqueue(() => this.updateNames(sql, entry.tx, entry.names));
      }
      await q.done();
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
      burnBlockHeight: number;
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
        block_hash = ${args.blockHash}, burn_block_time = ${args.burnBlockTime},
        burn_block_height = ${args.burnBlockHeight}
      WHERE microblock_hash IN ${sql(args.microblocks)}
        AND (index_block_hash = ${args.indexBlockHash} OR index_block_hash = '\\x'::bytea)
      RETURNING ${sql(TX_COLUMNS)}
    `;
    // Any txs restored need to be pruned from the mempool
    const updatedMbTxs = updatedMbTxsQuery.map(r => parseTxQueryResult(r));
    const txsToPrune: TransactionHeader[] = updatedMbTxs
      .filter(tx => tx.canonical && tx.microblock_canonical)
      .map(tx => ({
        txId: tx.tx_id,
        sender_address: tx.sender_address,
        sponsor_address: tx.sponsor_address,
        sponsored: tx.sponsored,
        nonce: tx.nonce,
      }));
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
    }
  ): Promise<void> {
    await sql`
      INSERT INTO nft_custody
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
        ORDER BY
          asset_identifier,
          value,
          txs.block_height DESC,
          txs.microblock_sequence DESC,
          txs.tx_index DESC,
          nft.event_index DESC
      )
      ON CONFLICT ON CONSTRAINT nft_custody_unique DO UPDATE SET
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
  async restoreMempoolTxs(
    sql: PgSqlClient,
    transactions: TransactionHeader[]
  ): Promise<{ restoredTxs: string[] }> {
    if (transactions.length === 0) return { restoredTxs: [] };
    if (logger.isLevelEnabled('debug'))
      for (const tx of transactions)
        logger.debug(
          `Restoring mempool tx: ${tx.txId} sender: ${tx.sender_address} nonce: ${tx.nonce}`
        );

    // Restore new non-canonical txs into the mempool. Also restore transactions for the same
    // senders/sponsors with the same `nonce`s. We will recalculate replace-by-fee ordering shortly
    // afterwards.
    const inputData = transactions.map(t => [
      t.txId.replace('0x', '\\x'),
      t.sender_address,
      t.sponsor_address ?? 'null',
      t.sponsored.toString(),
      t.nonce,
    ]);
    const updatedRows = await sql<{ tx_id: string }[]>`
      WITH input_data (tx_id, sender_address, sponsor_address, sponsored, nonce) AS (
        VALUES ${sql(inputData)}
      ),
      sponsored_inputs AS (SELECT * FROM input_data WHERE sponsored::boolean),
      non_sponsored_inputs AS (SELECT * FROM input_data WHERE NOT sponsored::boolean),
      affected_sponsored AS (
        SELECT m.tx_id
        FROM mempool_txs m
        INNER JOIN sponsored_inputs i ON m.nonce = i.nonce::int
        AND (m.sponsor_address = i.sponsor_address OR m.sender_address = i.sponsor_address)
      ),
      affected_non_sponsored AS (
        SELECT m.tx_id
        FROM mempool_txs m
        INNER JOIN non_sponsored_inputs i ON m.nonce = i.nonce::int
        AND (m.sponsor_address = i.sender_address OR m.sender_address = i.sender_address)
      ),
      affected_mempool_tx_ids AS (
        SELECT tx_id FROM affected_sponsored
        UNION
        SELECT tx_id FROM affected_non_sponsored
        UNION
        SELECT tx_id::bytea FROM input_data
      ),
      restored AS (
        UPDATE mempool_txs
        SET pruned = false, status = ${DbTxStatus.Pending}, replaced_by_tx_id = NULL
        WHERE pruned = true AND tx_id IN (SELECT DISTINCT tx_id FROM affected_mempool_tx_ids)
        RETURNING tx_id
      ),
      count_update AS (
        UPDATE chain_tip SET
          mempool_tx_count = mempool_tx_count + (SELECT COUNT(*) FROM restored),
          mempool_updated_at = NOW()
      )
      SELECT tx_id FROM restored
    `;
    const restoredTxIds = updatedRows.map(r => r.tx_id);
    if (logger.isLevelEnabled('debug'))
      for (const txId of restoredTxIds) logger.debug(`Restored mempool tx: ${txId}`);

    // Transactions that didn't exist in the mempool need to be inserted into the mempool
    const txIdsRequiringInsertion = transactions
      .filter(tx => !restoredTxIds.includes(tx.txId))
      .map(tx => tx.txId);
    if (txIdsRequiringInsertion.length) {
      logger.debug(
        `To restore mempool txs, ${txIdsRequiringInsertion.length} txs require insertion`
      );
      const txs: TxQueryResult[] = await sql`
        SELECT DISTINCT ON(tx_id) ${sql(TX_COLUMNS)}
        FROM txs
        WHERE tx_id IN ${sql(txIdsRequiringInsertion)}
        ORDER BY tx_id, block_height DESC, microblock_sequence DESC, tx_index DESC
      `;
      if (txs.length !== txIdsRequiringInsertion.length) {
        logger.error(`Not all txs requiring insertion were found`);
      }

      const mempoolTxs = convertTxQueryResultToDbMempoolTx(txs);
      await this.updateMempoolTxs({ mempoolTxs });
      if (logger.isLevelEnabled('debug'))
        for (const tx of mempoolTxs) logger.debug(`Inserted non-existing mempool tx: ${tx.tx_id}`);
    }

    return { restoredTxs: [...restoredTxIds, ...txIdsRequiringInsertion] };
  }

  /**
   * Remove transactions in the mempool table. This should be called when transactions are
   * mined into a block.
   * @param txIds - List of transactions to update in the mempool
   */
  async pruneMempoolTxs(
    sql: PgSqlClient,
    transactions: TransactionHeader[]
  ): Promise<{ removedTxs: string[] }> {
    if (transactions.length === 0) return { removedTxs: [] };
    if (logger.isLevelEnabled('debug'))
      for (const tx of transactions)
        logger.debug(
          `Pruning mempool tx: ${tx.txId} sender: ${tx.sender_address} nonce: ${tx.nonce}`
        );

    // Prune confirmed txs from the mempool. Also prune transactions for the same senders/sponsors
    // with the same `nonce`s. We'll recalculate replaced-by-fee data later when new block data is
    // written to the DB.
    const inputData = transactions.map(t => [
      t.txId.replace('0x', '\\x'),
      t.sender_address,
      t.sponsor_address ?? 'null',
      t.sponsored.toString(),
      t.nonce,
    ]);
    const updateResults = await sql<{ tx_id: string }[]>`
      WITH input_data (tx_id, sender_address, sponsor_address, sponsored, nonce) AS (
        VALUES ${sql(inputData)}
      ),
      sponsored_inputs AS (SELECT * FROM input_data WHERE sponsored::boolean),
      non_sponsored_inputs AS (SELECT * FROM input_data WHERE NOT sponsored::boolean),
      affected_sponsored AS (
        SELECT m.tx_id
        FROM mempool_txs m
        INNER JOIN sponsored_inputs i ON m.nonce = i.nonce::int
        AND (m.sponsor_address = i.sponsor_address OR m.sender_address = i.sponsor_address)
      ),
      affected_non_sponsored AS (
        SELECT m.tx_id
        FROM mempool_txs m
        INNER JOIN non_sponsored_inputs i ON m.nonce = i.nonce::int
        AND (m.sponsor_address = i.sender_address OR m.sender_address = i.sender_address)
      ),
      affected_mempool_tx_ids AS (
        SELECT tx_id FROM affected_sponsored
        UNION
        SELECT tx_id FROM affected_non_sponsored
        UNION
        SELECT tx_id::bytea FROM input_data
      ),
      pruned AS (
        UPDATE mempool_txs
        SET pruned = true, replaced_by_tx_id = NULL
        WHERE pruned = false AND tx_id IN (SELECT tx_id FROM affected_mempool_tx_ids)
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
   * Deletes mempool txs that should be dropped by block age or time age depending on which Stacks
   * epoch we're on.
   * @param sql - DB client
   * @returns List of deleted `tx_id`s
   */
  async deleteGarbageCollectedMempoolTxs(sql: PgSqlClient): Promise<{ deletedTxs: string[] }> {
    // Is 3.0 active? Check if the latest block was signed by signers.
    const nakamotoActive =
      (
        await sql<{ index_block_hash: string }[]>`
          SELECT b.index_block_hash
          FROM blocks AS b
          INNER JOIN chain_tip AS c ON c.index_block_hash = b.index_block_hash
          WHERE b.signer_bitvec IS NOT NULL
          LIMIT 1
        `
      ).count > 0;
    // If 3.0 is active, drop transactions older than 2560 minutes.
    // If 2.5 or earlier is active, drop transactions older than 256 blocks.
    const deletedTxResults = await sql<{ tx_id: string }[]>`
      WITH pruned AS (
        UPDATE mempool_txs
        SET pruned = TRUE, status = ${DbTxStatus.DroppedApiGarbageCollect}
        WHERE pruned = FALSE AND
          ${
            nakamotoActive
              ? sql`receipt_time <= EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - INTERVAL '2560 minutes'))::int`
              : sql`receipt_block_height <= (SELECT block_height - 256 FROM chain_tip)`
          }
        RETURNING tx_id
      ),
      count_update AS (
        UPDATE chain_tip SET
          mempool_tx_count = mempool_tx_count - (SELECT COUNT(*) FROM pruned),
          mempool_updated_at = NOW()
      )
      SELECT tx_id FROM pruned
    `;
    const txIds = deletedTxResults.map(r => r.tx_id);
    if (txIds.length > 0) logger.debug(`Garbage collected ${txIds.length} mempool txs`);
    return { deletedTxs: deletedTxResults.map(r => r.tx_id) };
  }

  async markEntitiesCanonical(
    sql: PgSqlClient,
    indexBlockHash: string,
    canonical: boolean,
    updatedEntities: ReOrgUpdatedEntities
  ): Promise<{
    txsMarkedCanonical: TransactionHeader[];
    txsMarkedNonCanonical: TransactionHeader[];
  }> {
    const result: {
      txsMarkedCanonical: TransactionHeader[];
      txsMarkedNonCanonical: TransactionHeader[];
    } = {
      txsMarkedCanonical: [],
      txsMarkedNonCanonical: [],
    };

    const q = new PgWriteQueue();
    q.enqueue(async () => {
      const txResult = await sql<
        {
          tx_id: string;
          sender_address: string;
          sponsor_address: string | null;
          sponsored: boolean;
          nonce: number;
          update_balances_count: number;
        }[]
      >`
        WITH updated_txs AS (
          UPDATE txs
          SET canonical = ${canonical}
          WHERE index_block_hash = ${indexBlockHash} AND canonical != ${canonical}
          RETURNING tx_id, sender_address, nonce, sponsor_address, fee_rate, sponsored, canonical
        ),
        affected_addresses AS (
            SELECT 
              sender_address AS address,
              fee_rate AS fee_change,
              canonical,
              sponsored
            FROM updated_txs
            WHERE sponsored = false
          UNION ALL
            SELECT 
              sponsor_address AS address,
              fee_rate AS fee_change,
              canonical,
              sponsored
            FROM updated_txs
            WHERE sponsored = true
        ),
        balances_update AS (
          SELECT
            a.address,
            SUM(CASE WHEN a.canonical THEN -a.fee_change ELSE a.fee_change END) AS balance_change
          FROM affected_addresses a
          GROUP BY a.address
        ),
        update_ft_balances AS (
          INSERT INTO ft_balances (address, token, balance)
          SELECT b.address, 'stx', b.balance_change
          FROM balances_update b
          ON CONFLICT (address, token)
          DO UPDATE
          SET balance = ft_balances.balance + EXCLUDED.balance
          RETURNING ft_balances.address
        )
        SELECT tx_id, sender_address, sponsor_address, sponsored, nonce,
          (SELECT COUNT(*)::int FROM update_ft_balances) AS update_balances_count
        FROM updated_txs
      `;
      const txs = txResult.map(row => ({
        txId: row.tx_id,
        sender_address: row.sender_address,
        sponsor_address: row.sponsor_address ?? undefined,
        sponsored: row.sponsored,
        nonce: row.nonce,
      }));
      if (canonical) {
        updatedEntities.markedCanonical.txs += txResult.count;
        result.txsMarkedCanonical = txs;
      } else {
        updatedEntities.markedNonCanonical.txs += txResult.count;
        result.txsMarkedNonCanonical = txs;
      }
      if (txResult.count) {
        await sql`
          UPDATE principal_stx_txs
          SET canonical = ${canonical}
          WHERE tx_id IN ${sql(txs.map(t => t.txId))}
            AND index_block_hash = ${indexBlockHash} AND canonical != ${canonical}
        `;
      }
    });
    q.enqueue(async () => {
      const minerRewardResults = await sql<{ updated_rewards_count: number }[]>`
        WITH updated_rewards AS (
          UPDATE miner_rewards
          SET canonical = ${canonical}
          WHERE index_block_hash = ${indexBlockHash} AND canonical != ${canonical}
          RETURNING recipient, coinbase_amount, tx_fees_anchored, tx_fees_streamed_confirmed, tx_fees_streamed_produced, canonical
        ),
        reward_changes AS (
          SELECT 
            recipient AS address,
            SUM(CASE WHEN canonical THEN 
                (coinbase_amount + tx_fees_anchored + tx_fees_streamed_confirmed + tx_fees_streamed_produced) 
              ELSE 
                -(coinbase_amount + tx_fees_anchored + tx_fees_streamed_confirmed + tx_fees_streamed_produced) 
              END) AS balance_change
          FROM updated_rewards
          GROUP BY recipient
        ),
        update_balances AS (
          INSERT INTO ft_balances (address, token, balance)
          SELECT rc.address, 'stx', rc.balance_change
          FROM reward_changes rc
          ON CONFLICT (address, token)
          DO UPDATE
          SET balance = ft_balances.balance + EXCLUDED.balance
          RETURNING ft_balances.address
        )
        SELECT 
          (SELECT COUNT(*)::int FROM updated_rewards) AS updated_rewards_count
      `;
      const updateCount = minerRewardResults[0]?.updated_rewards_count ?? 0;
      if (canonical) {
        updatedEntities.markedCanonical.minerRewards += updateCount;
      } else {
        updatedEntities.markedNonCanonical.minerRewards += updateCount;
      }
    });
    q.enqueue(async () => {
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
    });
    q.enqueue(async () => {
      const stxResults = await sql<{ updated_events_count: number }[]>`
        WITH updated_events AS (
          UPDATE stx_events
          SET canonical = ${canonical}
          WHERE index_block_hash = ${indexBlockHash} AND canonical != ${canonical}
          RETURNING sender, recipient, amount, asset_event_type_id, canonical
        ),
        event_changes AS (
          SELECT 
            address,
            SUM(balance_change) AS balance_change
          FROM (
              SELECT 
                sender AS address,
                SUM(CASE WHEN canonical THEN -amount ELSE amount END) AS balance_change
              FROM updated_events
              WHERE asset_event_type_id IN (1, 3) -- Transfers and Burns affect the sender's balance
              GROUP BY sender
            UNION ALL
              SELECT 
                recipient AS address,
                SUM(CASE WHEN canonical THEN amount ELSE -amount END) AS balance_change
              FROM updated_events
              WHERE asset_event_type_id IN (1, 2) -- Transfers and Mints affect the recipient's balance
              GROUP BY recipient
          ) AS subquery
          GROUP BY address
        ),
        update_balances AS (
          INSERT INTO ft_balances (address, token, balance)
          SELECT ec.address, 'stx', ec.balance_change
          FROM event_changes ec
          ON CONFLICT (address, token)
          DO UPDATE
          SET balance = ft_balances.balance + EXCLUDED.balance
          RETURNING ft_balances.address
        )
        SELECT 
          (SELECT COUNT(*)::int FROM updated_events) AS updated_events_count
      `;
      const updateCount = stxResults[0]?.updated_events_count ?? 0;
      if (canonical) {
        updatedEntities.markedCanonical.stxEvents += updateCount;
      } else {
        updatedEntities.markedNonCanonical.stxEvents += updateCount;
      }
    });
    q.enqueue(async () => {
      const ftResult = await sql<{ updated_events_count: number }[]>`
        WITH updated_events AS (
          UPDATE ft_events
          SET canonical = ${canonical}
          WHERE index_block_hash = ${indexBlockHash} AND canonical != ${canonical}
          RETURNING sender, recipient, amount, asset_event_type_id, asset_identifier, canonical
        ),
        event_changes AS (
          SELECT address, asset_identifier, SUM(balance_change) AS balance_change
          FROM (
              SELECT sender AS address, asset_identifier,
                SUM(CASE WHEN canonical THEN -amount ELSE amount END) AS balance_change
              FROM updated_events
              WHERE asset_event_type_id IN (1, 3) -- Transfers and Burns affect the sender's balance
              GROUP BY sender, asset_identifier
            UNION ALL
              SELECT recipient AS address, asset_identifier,
                SUM(CASE WHEN canonical THEN amount ELSE -amount END) AS balance_change
              FROM updated_events
              WHERE asset_event_type_id IN (1, 2) -- Transfers and Mints affect the recipient's balance
              GROUP BY recipient, asset_identifier
          ) AS subquery
          GROUP BY address, asset_identifier
        ),
        update_balances AS (
          INSERT INTO ft_balances (address, token, balance)
          SELECT ec.address, ec.asset_identifier, ec.balance_change
          FROM event_changes ec
          ON CONFLICT (address, token)
          DO UPDATE
          SET balance = ft_balances.balance + EXCLUDED.balance
          RETURNING ft_balances.address
        )
        SELECT 
          (SELECT COUNT(*)::int FROM updated_events) AS updated_events_count
      `;
      const updateCount = ftResult[0]?.updated_events_count ?? 0;
      if (canonical) {
        updatedEntities.markedCanonical.ftEvents += updateCount;
      } else {
        updatedEntities.markedNonCanonical.ftEvents += updateCount;
      }
    });
    q.enqueue(async () => {
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
      if (nftResult.count)
        await this.updateNftCustodyFromReOrg(sql, { index_block_hash: indexBlockHash });
    });
    q.enqueue(async () => {
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
    });
    q.enqueue(async () => {
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
    });
    q.enqueue(async () => {
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
    });
    q.enqueue(async () => {
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
    });
    q.enqueue(async () => {
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
    });
    q.enqueue(async () => {
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
    });
    q.enqueue(async () => {
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
    });
    q.enqueue(async () => {
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
    });
    q.enqueue(async () => {
      const poxSetResult = await sql`
        UPDATE pox_sets
        SET canonical = ${canonical}
        WHERE index_block_hash = ${indexBlockHash} AND canonical != ${canonical}
      `;
      if (canonical) {
        updatedEntities.markedCanonical.poxSigners += poxSetResult.count;
      } else {
        updatedEntities.markedNonCanonical.poxSigners += poxSetResult.count;
      }
    });
    q.enqueue(async () => {
      const poxCycleResult = await sql`
        UPDATE pox_cycles
        SET canonical = ${canonical}
        WHERE index_block_hash = ${indexBlockHash} AND canonical != ${canonical}
      `;
      if (canonical) {
        updatedEntities.markedCanonical.poxCycles += poxCycleResult.count;
      } else {
        updatedEntities.markedNonCanonical.poxCycles += poxCycleResult.count;
      }
    });

    await q.done();

    return result;
  }

  /**
   * Recursively restore previously orphaned blocks to canonical.
   * @param sql - The SQL client
   * @param indexBlockHash - The index block hash that we will restore first
   * @param updatedEntities - The updated entities
   * @returns The updated entities
   */
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
    updatedEntities.markedCanonical.blockHeaders.unshift({
      index_block_hash: restoredBlockResult[0].index_block_hash,
      block_height: restoredBlockResult[0].block_height,
      block_time: restoredBlockResult[0].block_time,
    });

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
        await sql`
          UPDATE burnchain_rewards
          SET canonical = false
          WHERE canonical = true AND burn_block_hash = ${orphanedBlock.burn_block_hash}
        `;
        const microCanonicalUpdateResult = await this.updateMicroCanonical(sql, {
          isCanonical: false,
          blockHeight: orphanedBlock.block_height,
          blockHash: orphanedBlock.block_hash,
          indexBlockHash: orphanedBlock.index_block_hash,
          parentIndexBlockHash: orphanedBlock.parent_index_block_hash,
          parentMicroblockHash: orphanedBlock.parent_microblock_hash,
          parentMicroblockSequence: orphanedBlock.parent_microblock_sequence,
          burnBlockTime: orphanedBlock.burn_block_time,
          burnBlockHeight: orphanedBlock.burn_block_height,
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
      updatedEntities.markedNonCanonical.blockHeaders.unshift({
        index_block_hash: orphanedBlockResult[0].index_block_hash,
        block_height: orphanedBlockResult[0].block_height,
        block_time: orphanedBlockResult[0].block_time,
      });
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
      burnBlockHeight: restoredBlock.burn_block_height,
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
    updatedEntities.markedCanonical.microblockHashes.push(
      ...microCanonicalUpdateResult.acceptedMicroblocks
    );
    updatedEntities.markedNonCanonical.microblocks += microblocksOrphaned.size;
    updatedEntities.markedNonCanonical.microblockHashes.push(
      ...microCanonicalUpdateResult.orphanedMicroblocks
    );

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

    // Do we have a parent that is non-canonical? If so, restore it recursively.
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
      block_time: block.block_time,
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
      tx_total_size: block.tx_total_size,
      tx_count: block.tx_count,
      signer_bitvec: block.signer_bitvec,
      signer_signatures: block.signer_signatures,
      tenure_height: block.tenure_height,
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
      block_time: tx.block_time ?? 0,
      burn_block_height: tx.burn_block_height,
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
      raw_result: tx.raw_result,
      event_count: tx.event_count,
      execution_cost_read_count: tx.execution_cost_read_count,
      execution_cost_read_length: tx.execution_cost_read_length,
      execution_cost_runtime: tx.execution_cost_runtime,
      execution_cost_write_count: tx.execution_cost_write_count,
      execution_cost_write_length: tx.execution_cost_write_length,
      vm_error: tx.vm_error ?? null,
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

  async getLastIngestedSnpRedisMsgId(): Promise<string> {
    const [{ last_redis_msg_id }] = await this.sql<
      { last_redis_msg_id: string }[]
    >`SELECT last_redis_msg_id FROM snp_state`;
    return last_redis_msg_id;
  }

  async updateLastIngestedSnpRedisMsgId(sql: PgSqlClient, msgId: string): Promise<void> {
    await sql`UPDATE snp_state SET last_redis_msg_id = ${msgId}`;
  }

  async close(args?: { timeout?: number }): Promise<void> {
    if (this._debounceMempoolStat.debounce) {
      clearTimeout(this._debounceMempoolStat.debounce);
    }
    await this.redisNotifier?.close();
    await super.close(args);
  }
}
