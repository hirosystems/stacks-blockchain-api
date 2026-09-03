import assert from 'node:assert';
import * as prom from 'prom-client';
import { getOrAdd, I32_MAX } from '../helpers.js';
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
  PrincipalTxsInsertValues,
  BnsSubdomainInsertValues,
  BnsZonefileInsertValues,
  FtEventInsertValues,
  NftEventInsertValues,
  SmartContractEventInsertValues,
  MicroblockQueryResult,
  BurnchainBlockInsertValues,
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
  Pox4SyntheticEventInsertValues,
  DbTxRaw,
  DbMempoolTxRaw,
  DbChainTip,
  NftCustodyInsertValues,
  DataStoreBnsBlockTxData,
  DbPox4SyntheticEvent,
  Pox4SyntheticEventTable,
  DbPoxSetSigners,
  PoxSetSignerValues,
  PoxCycleInsertValues,
  DbAssetEventTypeId,
  DbAssetType,
  DbBurnBlockPoxTx,
  Pox5SyntheticEventInsertValues,
  DbBondInsertValues,
  DbTxLocation,
  DbBondRegistrationInsertValues,
  DbBondAllowlistEntryInsertValues,
  DbPrincipalBondPositionInsertValues,
  DbPrincipalBondPositionStatus,
  bondLockupTypeFromString,
  DbBondRewardCalculationInsertValues,
  DbBondRewardDistributionInsertValues,
  DbPrincipalBondRewardDistributionInsertValues,
  DbPrincipalBondRewardClaimInsertValues,
  DbPrincipalStxRewardDistributionInsertValues,
  DbSignerKeyGrantInsertValues,
  DbSignerKeyGrantKind,
  DbSignerRewardClaimInsertValues,
  PrincipalTxBalanceChangeInsertValues,
} from './common.js';
import {
  BLOCK_COLUMNS,
  convertTxQueryResultToDbMempoolTx,
  isNakamotoBlock,
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
  poxVersionFromContractName,
} from './helpers.js';
import { PgNotifier } from './pg-notifier.js';
import { MIGRATIONS_DIR, PgStore } from './pg-store.js';
import * as zoneFileParser from 'zone-file';
import { parseResolver, parseZoneFileTxt } from '../event-stream/bns/bns-helpers.js';
import {
  PgSqlClient,
  batchIterate,
  connectPostgres,
  isProdEnv,
  isTestEnv,
  runMigrations,
  logger,
} from '@stacks/api-toolkit';
import {
  PgServer,
  getConnectionArgs,
  getConnectionConfig,
  getPgConnectionDescription,
} from './connection.js';
import { BigNumber } from 'bignumber.js';
import { RedisNotifier } from './redis-notifier.js';
import { ENV } from '../env.js';
import {
  Pox4EventName,
  Pox5EventAddToAllowlist,
  Pox5EventAnnounceL1EarlyExit,
  Pox5EventBondDistribution,
  Pox5EventCalculateRewards,
  Pox5EventClaimRewards,
  Pox5EventClaimStakerRewardsForSigner,
  Pox5EventGrantSignerKey,
  Pox5EventName,
  Pox5EventRegisterForBond,
  Pox5EventRegisterSigner,
  Pox5EventRevokeSignerGrant,
  Pox5EventSetupBond,
  Pox5EventStake,
  Pox5EventStakeUpdate,
  Pox5EventUnstake,
  Pox5EventUnstakeSbtc,
  Pox5EventUpdateBondRegistration,
} from '@stacks/codec';

const INSERT_BATCH_SIZE = 500;

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
    logger.info(
      `Connecting to postgres at ${getPgConnectionDescription(PgServer.primary)} [${usageName}]`
    );
    const sql = await connectPostgres({
      usageName: usageName,
      connectionArgs: getConnectionArgs(PgServer.primary),
      connectionConfig: getConnectionConfig(PgServer.primary),
    });
    if (!skipMigrations) {
      await runMigrations(MIGRATIONS_DIR, 'up', getConnectionArgs(PgServer.primary), {
        logger: {
          debug: _msg => {},
          info: msg => {
            if (isTestEnv) return;
            if (msg.includes('Migrating files')) {
              logger.info(`Performing SQL migrations, this may take a while...`);
            } else if (msg.startsWith('> - ')) {
              logger.info(`Pending migration: ${msg.substring(4)}`);
            } else if (msg.startsWith('### MIGRATION')) {
              logger.info(`Running migration: ${msg.replace(/#/g, '').trim().substring(10)}`);
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

  async updateEventObserverTimestamp(eventPath: string): Promise<void> {
    await this.sql`
      INSERT INTO event_observer_timestamps (id, receive_timestamp, event_path)
      VALUES (0, NOW(), ${eventPath})
      ON CONFLICT (event_path) DO UPDATE SET
        receive_timestamp = EXCLUDED.receive_timestamp
    `;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    let skippedDuplicateBlock = false;

    await this.sqlWriteTransaction(async sql => {
      const chainTip = await this.getChainTip(sql);
      if (isNakamotoBlock(data.block)) {
        // Nakamoto blocks are validated by signers before they reach the event stream, so they are
        // always immediately canonical even when they re-org the chain onto a shorter fork.
        // Canonical flips of already-known blocks only ever happen via a new descendant block, so a
        // re-delivered block event (e.g. from an SNP stream replay after the chain tip moved
        // backwards) must be ignored entirely.
        const existingBlock = await sql`
          SELECT 1 FROM blocks WHERE index_block_hash = ${data.block.index_block_hash} LIMIT 1
        `;
        if (existingBlock.count > 0) {
          logger.debug(
            `Ignoring duplicate event for already ingested block ${data.block.block_height} ${data.block.index_block_hash}`
          );
          skippedDuplicateBlock = true;
          return;
        }
        reorg = await this.handleReorgNakamoto(sql, data.block, chainTip);
        isCanonical = true;
      } else {
        reorg = await this.handleReorg(sql, data.block, chainTip.block_height);
        isCanonical = data.block.block_height > chainTip.block_height;
      }
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
          q.enqueue(() => this.updateStxSupply(sql, data.txs, data.minerRewards));
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
          q.enqueue(() => this.updatePrincipalTxs(sql, newTxData));
          q.enqueue(() => this.updateSmartContractEvents(sql, newTxData));
          q.enqueue(() => this.updatePox4SyntheticEvents(sql, 'pox2_events', newTxData));
          q.enqueue(() => this.updatePox4SyntheticEvents(sql, 'pox3_events', newTxData));
          q.enqueue(() => this.updatePox4SyntheticEvents(sql, 'pox4_events', newTxData));
          q.enqueue(() => this.insertPox5SyntheticEvents(sql, newTxData));
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
          ),
          new_bond_count AS (
            SELECT COUNT(*)::int AS bond_count
            FROM bonds
            WHERE canonical = true
              AND microblock_canonical = true
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
            tx_count_unanchored = (SELECT tx_count FROM new_tx_count),
            bond_count = (SELECT bond_count FROM new_bond_count)
        `;
        if (this.metrics) {
          this.metrics.blockHeight.set(data.block.block_height);
        }
      }
    });
    if (skippedDuplicateBlock) return;
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

  private async insertPox5SyntheticEvents(sql: PgSqlClient, txs: DataStoreTxEventData[]) {
    const poxValues: Pox5SyntheticEventInsertValues[] = [];
    const bondEventCounts = new Map<number, number>();
    for (const tx of txs) {
      if (tx.pox5Events.length === 0) continue;
      const txLocation: DbTxLocation = {
        tx_id: tx.tx.tx_id,
        tx_index: tx.tx.tx_index,
        block_height: tx.tx.block_height,
        block_hash: tx.tx.block_hash,
        block_time: tx.tx.block_time,
        burn_block_height: tx.tx.burn_block_height,
        burn_block_time: tx.tx.burn_block_time,
        parent_block_hash: tx.tx.parent_block_hash,
        index_block_hash: tx.tx.index_block_hash,
        parent_index_block_hash: tx.tx.parent_index_block_hash,
        microblock_hash: tx.tx.microblock_hash,
        microblock_sequence: tx.tx.microblock_sequence,
        microblock_canonical: tx.tx.microblock_canonical,
        canonical: tx.tx.canonical,
      };
      for (const poxEvent of tx.pox5Events) {
        poxValues.push({
          ...txLocation,
          event_index: poxEvent.event_index,
          name: poxEvent.name,
          data: poxEvent.data,
        });
        // Accumulate the per-bond event tally for the `bonds.event_count` counter. A null
        // `bond_index` (an STX-only claim-staker-rewards-for-signer event) is not a bond event.
        // Only canonical events count: a side-fork block's events are persisted here too (marked
        // non-canonical), but they must not enter the counter until the reorg delta flips them
        // canonical.
        const bondIndexData = (poxEvent.data as { bond_index?: string | null }).bond_index;
        if (bondIndexData != null && txLocation.canonical && txLocation.microblock_canonical) {
          const bondIndex = parseInt(bondIndexData);
          bondEventCounts.set(bondIndex, (bondEventCounts.get(bondIndex) ?? 0) + 1);
        }
        switch (poxEvent.name) {
          case Pox5EventName.SetupBond:
            await this.updateBond(sql, txLocation, poxEvent);
            break;
          case Pox5EventName.AddToAllowlist:
            await this.updateBondAllowlistEntry(sql, txLocation, poxEvent);
            break;
          case Pox5EventName.RegisterForBond:
          case Pox5EventName.UpdateBondRegistration:
            await this.updateBondRegistration(sql, txLocation, poxEvent);
            await this.updatePrincipalBondPosition(sql, txLocation, poxEvent);
            break;
          case Pox5EventName.AnnounceL1EarlyExit:
          case Pox5EventName.UnstakeSbtc:
            await this.updatePrincipalBondPosition(sql, txLocation, poxEvent);
            break;
          case Pox5EventName.CalculateRewards:
            await this.updateBondRewardCalculation(sql, txLocation, poxEvent);
            break;
          case Pox5EventName.BondDistribution:
            await this.updateBondRewardDistribution(sql, txLocation, poxEvent);
            break;
          case Pox5EventName.ClaimStakerRewardsForSigner:
            await this.updatePrincipalBondRewardClaim(sql, txLocation, poxEvent);
            break;
          case Pox5EventName.ClaimRewards:
            await this.updateSignerRewardClaim(sql, txLocation, poxEvent);
            break;
          case Pox5EventName.Stake:
          case Pox5EventName.StakeUpdate:
          case Pox5EventName.Unstake:
            await this.upsertStxLockedBalance(sql, txLocation, poxEvent);
            break;
          case Pox5EventName.RegisterSigner:
            await this.upsertStakingSigner(sql, txLocation, poxEvent);
            await this.insertSignerKeyGrant(sql, txLocation, poxEvent);
            break;
          case Pox5EventName.GrantSignerKey:
          case Pox5EventName.RevokeSignerGrant:
            await this.insertSignerKeyGrant(sql, txLocation, poxEvent);
            break;
          case Pox5EventName.AllowContractCaller:
          case Pox5EventName.DisallowContractCaller:
          case Pox5EventName.SetBondAdmin:
            // No-op
            break;
        }
      }
    }
    for (const batch of batchIterate(poxValues, INSERT_BATCH_SIZE)) {
      await sql`
        INSERT INTO pox5_events ${sql(batch)}
      `;
    }
    // Maintain each bond's materialized event_count on write, like registered_count. Runs after the
    // per-event handlers above, so a setup-bond's own `bonds` row already exists when its event is
    // counted.
    for (const [bondIndex, count] of bondEventCounts) {
      await sql`
        UPDATE bonds
        SET event_count = event_count + ${count}
        WHERE bond_index = ${bondIndex}
          AND canonical = true
          AND microblock_canonical = true
      `;
    }
  }

  private async updateBond(sql: PgSqlClient, txLocation: DbTxLocation, event: Pox5EventSetupBond) {
    const bond: DbBondInsertValues = {
      ...txLocation,
      bond_index: parseInt(event.data.bond_index),
      target_rate: parseInt(event.data.target_rate),
      stx_value_ratio: parseInt(event.data.stx_value_ratio),
      min_ustx_ratio: parseInt(event.data.min_ustx_ratio),
      early_unlock_bytes: event.data.early_unlock_bytes,
      first_reward_cycle: parseInt(event.data.first_reward_cycle),
      bond_start_height: parseInt(event.data.bond_start_height),
      unlock_cycle: parseInt(event.data.unlock_cycle),
      unlock_burn_height: parseInt(event.data.unlock_burn_height),
    };
    await sql`
      INSERT INTO bonds ${sql(bond)}
    `;
  }

  private async updateBondRegistration(
    sql: PgSqlClient,
    txLocation: DbTxLocation,
    event: Pox5EventRegisterForBond | Pox5EventUpdateBondRegistration
  ) {
    const bondIndex = parseInt(event.data.bond_index);
    const staker = event.data.staker;
    const amountUstx = event.data.amount_ustx;
    const satsTotal =
      event.name === Pox5EventName.RegisterForBond ? event.data.sats_total : event.data.amount_sats;

    if (event.name === Pox5EventName.RegisterForBond) {
      const bondRegistration: DbBondRegistrationInsertValues = {
        ...txLocation,
        bond_index: bondIndex,
        signer: event.data.signer,
        staker,
        amount_ustx: amountUstx,
        sats_total: satsTotal,
        first_reward_cycle: parseInt(event.data.first_reward_cycle),
        unlock_burn_height: parseInt(event.data.unlock_burn_height),
        unlock_cycle: parseInt(event.data.unlock_cycle),
        // Capture the BTC/sBTC lockup provenance from the event. `txs` lists the
        // proven L1 outputs for an L1 lockup and is null for an sBTC lockup.
        btc_lockup_type: bondLockupTypeFromString(event.data.btc_lockup.type),
        btc_lockup_txs: event.data.btc_lockup.txs
          ? JSON.stringify(event.data.btc_lockup.txs)
          : null,
      };
      await sql`
        INSERT INTO bond_registrations ${sql(bondRegistration)}
      `;
      if (!(txLocation.canonical && txLocation.microblock_canonical)) {
        // Side-fork registration: the flag-carrying row above is enough.
        return;
      }
      // Maintain the bond's registered_count on write (a new registration).
      await sql`
        UPDATE bonds
        SET registered_count = registered_count + 1
        WHERE bond_index = ${bondIndex}
          AND canonical = true
          AND microblock_canonical = true
      `;
    } else {
      if (!(txLocation.canonical && txLocation.microblock_canonical)) {
        // A registration update mutates the canonical registration row in place; a side-fork update
        // must not touch it.
        return;
      }
      const updateResult = await sql`
        UPDATE bond_registrations SET
          signer = ${event.data.signer},
          sats_total = ${satsTotal},
          amount_ustx = ${amountUstx}
        WHERE bond_index = ${bondIndex}
          AND staker = ${staker}
          AND canonical = true
          AND microblock_canonical = true
      `;
      if (updateResult.count === 0) {
        logger.warn(
          `Bond registration not found for bond index ${event.data.bond_index} and staker ${event.data.staker}`
        );
      }
    }
  }

  private async updatePrincipalBondPosition(
    sql: PgSqlClient,
    txLocation: DbTxLocation,
    event:
      | Pox5EventRegisterForBond
      | Pox5EventUpdateBondRegistration
      | Pox5EventAnnounceL1EarlyExit
      | Pox5EventUnstakeSbtc
  ) {
    const isCanonicalTx = txLocation.canonical && txLocation.microblock_canonical;
    switch (event.name) {
      case Pox5EventName.RegisterForBond:
      case Pox5EventName.UpdateBondRegistration: {
        const bondIndex = parseInt(event.data.bond_index);
        const position: DbPrincipalBondPositionInsertValues = {
          ...txLocation,
          principal: event.data.staker,
          bond_index: bondIndex,
          status: DbPrincipalBondPositionStatus.Enrolled,
          active: true,
          btc_locked:
            event.name === Pox5EventName.RegisterForBond
              ? event.data.sats_total
              : event.data.amount_sats,
          stx_locked: event.data.amount_ustx,
          btc_paid_out: '0',
        };
        if (!isCanonicalTx) {
          // Side-fork registration: insert the flag-carrying position only if this (principal,
          // bond) has none. The reorg flip-and-delta restores the bond and principal aggregates
          // from it if the fork wins. Never clobber an existing (canonical) position, and never
          // touch aggregates. (When a position already exists the side-fork version is
          // unrepresentable under the one-row-per-(principal, bond) schema and is dropped.)
          await sql`
            INSERT INTO principal_bond_positions ${sql(position)}
            ON CONFLICT (principal, bond_index) DO NOTHING
          `;
          break;
        }
        await sql`
          WITH existing_position AS (
            SELECT btc_locked, stx_locked
            FROM principal_bond_positions
            WHERE principal = ${position.principal}
              AND bond_index = ${bondIndex}
              AND canonical = true
              AND microblock_canonical = true
          ),
          upserted_position AS (
            INSERT INTO principal_bond_positions ${sql(position)}
            ON CONFLICT (principal, bond_index) DO UPDATE SET
              tx_id = EXCLUDED.tx_id,
              tx_index = EXCLUDED.tx_index,
              block_height = EXCLUDED.block_height,
              index_block_hash = EXCLUDED.index_block_hash,
              parent_index_block_hash = EXCLUDED.parent_index_block_hash,
              microblock_hash = EXCLUDED.microblock_hash,
              microblock_sequence = EXCLUDED.microblock_sequence,
              microblock_canonical = EXCLUDED.microblock_canonical,
              canonical = EXCLUDED.canonical,
              status = EXCLUDED.status,
              active = EXCLUDED.active,
              btc_locked = EXCLUDED.btc_locked,
              stx_locked = EXCLUDED.stx_locked
            RETURNING btc_locked, stx_locked
          ),
          delta AS (
            SELECT
              upserted_position.btc_locked::numeric
                - COALESCE(existing_position.btc_locked::numeric, 0) AS btc_delta,
              upserted_position.stx_locked::numeric
                - COALESCE(existing_position.stx_locked::numeric, 0) AS stx_delta,
              -- A brand-new canonical position adds 1 to the principal's bond count.
              CASE WHEN existing_position.btc_locked IS NULL THEN 1 ELSE 0 END AS count_delta
            FROM upserted_position
            LEFT JOIN existing_position ON true
          ),
          bond_update AS (
            UPDATE bonds
            SET
              btc_locked = bonds.btc_locked + delta.btc_delta,
              stx_locked = bonds.stx_locked + delta.stx_delta
            FROM delta
            WHERE bonds.bond_index = ${bondIndex}
              AND bonds.canonical = true
              AND bonds.microblock_canonical = true
            RETURNING 1
          )
          INSERT INTO principal_staking_totals
            (principal, bond_count, bond_btc_locked, bond_stx_locked)
          SELECT ${position.principal}, delta.count_delta, delta.btc_delta, delta.stx_delta
          FROM delta
          ON CONFLICT (principal) DO UPDATE SET
            bond_count = principal_staking_totals.bond_count + EXCLUDED.bond_count,
            bond_btc_locked = principal_staking_totals.bond_btc_locked + EXCLUDED.bond_btc_locked,
            bond_stx_locked = principal_staking_totals.bond_stx_locked + EXCLUDED.bond_stx_locked
        `;
        break;
      }
      case Pox5EventName.AnnounceL1EarlyExit:
        if (!isCanonicalTx) {
          // Side-fork exit: an in-place mutation of the canonical position. Skip.
          return;
        }
        await sql`
          WITH updated_position AS (
            UPDATE principal_bond_positions
            SET
              status = ${DbPrincipalBondPositionStatus.EarlyExit},
              active = false
            WHERE principal = ${event.data.staker}
              AND bond_index = ${parseInt(event.data.bond_index)}
              AND canonical = true
              AND microblock_canonical = true
            RETURNING
              bond_index,
              btc_locked::numeric AS previous_btc_locked,
              stx_locked::numeric AS previous_stx_locked,
              btc_locked::numeric AS new_btc_locked,
              stx_locked::numeric AS new_stx_locked
          ),
          delta AS (
            SELECT
              SUM(new_btc_locked - previous_btc_locked) AS btc_delta,
              SUM(new_stx_locked - previous_stx_locked) AS stx_delta,
              bond_index
            FROM updated_position
            GROUP BY bond_index
          )
          UPDATE bonds
          SET
            btc_locked = bonds.btc_locked + delta.btc_delta,
            stx_locked = bonds.stx_locked + delta.stx_delta
          FROM delta
          WHERE bonds.bond_index = delta.bond_index
            AND bonds.canonical = true
            AND bonds.microblock_canonical = true
        `;
        return;
      case Pox5EventName.UnstakeSbtc:
        if (!isCanonicalTx) {
          // Side-fork unstake: an in-place mutation of the canonical position — skip.
          return;
        }
        await sql`
          WITH existing_position AS (
            SELECT bond_index, btc_locked::numeric AS btc_locked, stx_locked::numeric AS stx_locked
            FROM principal_bond_positions
            WHERE principal = ${event.data.staker}
              AND bond_index = ${parseInt(event.data.bond_index)}
              AND canonical = true
              AND microblock_canonical = true
          ),
          updated_position AS (
            UPDATE principal_bond_positions
            SET
              ${event.data.new_amount_sats == '0' ? sql`status = ${DbPrincipalBondPositionStatus.EarlyExit},` : sql``}
              btc_locked = ${event.data.new_amount_sats}
            WHERE principal = ${event.data.staker}
              AND bond_index = ${parseInt(event.data.bond_index)}
              AND canonical = true
              AND microblock_canonical = true
            RETURNING
              bond_index,
              btc_locked::numeric AS new_btc_locked,
              stx_locked::numeric AS new_stx_locked
          ),
          delta AS (
            SELECT
              updated_position.new_btc_locked - existing_position.btc_locked AS btc_delta,
              updated_position.new_stx_locked - existing_position.stx_locked AS stx_delta,
              updated_position.bond_index
            FROM updated_position
            INNER JOIN existing_position USING (bond_index)
          ),
          bond_update AS (
            UPDATE bonds
            SET
              btc_locked = bonds.btc_locked + delta.btc_delta,
              stx_locked = bonds.stx_locked + delta.stx_delta
            FROM delta
            WHERE bonds.bond_index = delta.bond_index
              AND bonds.canonical = true
              AND bonds.microblock_canonical = true
            RETURNING 1
          )
          INSERT INTO principal_staking_totals (principal, bond_btc_locked, bond_stx_locked)
          SELECT ${event.data.staker}, delta.btc_delta, delta.stx_delta
          FROM delta
          ON CONFLICT (principal) DO UPDATE SET
            bond_btc_locked = principal_staking_totals.bond_btc_locked + EXCLUDED.bond_btc_locked,
            bond_stx_locked = principal_staking_totals.bond_stx_locked + EXCLUDED.bond_stx_locked
        `;
        return;
    }
  }

  /** Per-bond reward distribution, from the pox-5 `bond-distribution` event. */
  private async updateBondRewardDistribution(
    sql: PgSqlClient,
    txLocation: DbTxLocation,
    event: Pox5EventBondDistribution
  ) {
    const bondIndex = parseInt(event.data.bond_index);
    const rewardDistribution: DbBondRewardDistributionInsertValues = {
      ...txLocation,
      bond_index: bondIndex,
      target_yield: event.data.target_yield,
      bond_rewards: event.data.bond_rewards,
      bond_staked_sats: event.data.bond_staked_sats,
      accrued_rewards_per_sat: event.data.accrued_rewards_per_sat,
      cumulative_rewards_per_sat: event.data.cumulative_rewards_per_sat,
    };
    await sql`
      INSERT INTO bond_reward_distributions ${sql(rewardDistribution)}
    `;

    // Split this distribution across the bond's participants by their staked
    // weight: each participant accrues `floor(staked_sats * per_sat / PRECISION)`
    // (PRECISION = 1e18). The bond's per-sat rate is uniform, so this is the
    // participant's exact share (modulo integer-rounding dust).
    const perSat = event.data.accrued_rewards_per_sat;
    const participantRewards = await sql<{ principal: string; reward_amount: string }[]>`
      SELECT principal,
        floor(btc_locked::numeric * ${perSat}::numeric / 1000000000000000000)::text AS reward_amount
      FROM principal_bond_positions
      WHERE bond_index = ${bondIndex}
        AND canonical = true
        AND microblock_canonical = true
        AND floor(btc_locked::numeric * ${perSat}::numeric / 1000000000000000000) > 0
    `;
    if (participantRewards.length === 0) {
      return;
    }
    const rewardRows: DbPrincipalBondRewardDistributionInsertValues[] = participantRewards.map(
      p => ({
        ...txLocation,
        principal: p.principal,
        bond_index: bondIndex,
        reward_amount: p.reward_amount,
      })
    );
    for (const batch of batchIterate(rewardRows, INSERT_BATCH_SIZE)) {
      await sql`
        INSERT INTO principal_bond_reward_distributions ${sql(batch)}
      `;
    }
    if (!(txLocation.canonical && txLocation.microblock_canonical)) {
      // Side-fork distribution: the flag-carrying source rows above are enough. The reorg
      // flip-and-delta credits the accrued totals from them if the fork wins. Applying them now
      // would corrupt canonical totals and double-count on the flip.
      return;
    }
    for (const p of participantRewards) {
      await sql`
        UPDATE principal_bond_positions
        SET accrued_rewards = accrued_rewards + ${p.reward_amount}::numeric
        WHERE principal = ${p.principal}
          AND bond_index = ${bondIndex}
          AND canonical = true
          AND microblock_canonical = true
      `;
      await sql`
        INSERT INTO principal_staking_totals (principal, bond_accrued_rewards)
        VALUES (${p.principal}, ${p.reward_amount}::numeric)
        ON CONFLICT (principal) DO UPDATE SET
          bond_accrued_rewards = principal_staking_totals.bond_accrued_rewards + EXCLUDED.bond_accrued_rewards
      `;
    }
  }

  /**
   * Record a per-staker reward claim (pox-5 `claim-staker-rewards-for-signer`)
   * and, for bond claims, roll the claimed amount into the position's running
   * `claimed_rewards` total. Claims with a null `bond_index` are STX-staking
   * reward claims — they only get a source row (no bond position to update).
   */
  private async updatePrincipalBondRewardClaim(
    sql: PgSqlClient,
    txLocation: DbTxLocation,
    event: Pox5EventClaimStakerRewardsForSigner
  ) {
    const bondIndex = event.data.bond_index === null ? null : parseInt(event.data.bond_index);
    const claim: DbPrincipalBondRewardClaimInsertValues = {
      ...txLocation,
      principal: event.data.staker,
      signer_manager: event.data.signer_manager,
      reward_cycle: parseInt(event.data.reward_cycle),
      bond_index: bondIndex,
      rewards_claimed: event.data.rewards_claimed,
    };
    await sql`
      INSERT INTO principal_bond_reward_claims ${sql(claim)}
    `;
    if (!(txLocation.canonical && txLocation.microblock_canonical)) {
      // Side-fork claim: the flag-carrying source row above is enough. The reorg flip-and-delta
      // rolls the claimed amounts into the position and totals if the fork wins.
      return;
    }
    if (bondIndex === null) {
      // STX-staking reward claim (no bond): roll into the staker's running
      // STX-staking claimed total.
      await sql`
        INSERT INTO principal_staking_totals (principal, stx_claimed_rewards)
        VALUES (${event.data.staker}, ${event.data.rewards_claimed}::numeric)
        ON CONFLICT (principal) DO UPDATE
        SET stx_claimed_rewards = principal_staking_totals.stx_claimed_rewards + EXCLUDED.stx_claimed_rewards
      `;
      return;
    }
    await sql`
      UPDATE principal_bond_positions
      SET claimed_rewards = claimed_rewards + ${event.data.rewards_claimed}::numeric
      WHERE principal = ${event.data.staker}
        AND bond_index = ${bondIndex}
        AND canonical = true
        AND microblock_canonical = true
    `;
    await sql`
      INSERT INTO principal_staking_totals (principal, bond_claimed_rewards)
      VALUES (${event.data.staker}, ${event.data.rewards_claimed}::numeric)
      ON CONFLICT (principal) DO UPDATE SET
        bond_claimed_rewards = principal_staking_totals.bond_claimed_rewards + EXCLUDED.bond_claimed_rewards
    `;
  }

  /**
   * Record a per-signer reward claim aggregate (pox-5 `claim-rewards`). This is
   * audit/bookkeeping only — the per-staker effects are handled by the
   * `claim-staker-rewards-for-signer` events — so no running totals are touched.
   */
  private async updateSignerRewardClaim(
    sql: PgSqlClient,
    txLocation: DbTxLocation,
    event: Pox5EventClaimRewards
  ) {
    const claim: DbSignerRewardClaimInsertValues = {
      ...txLocation,
      signer_manager: event.data.signer_manager,
      reward_cycle: parseInt(event.data.reward_cycle),
      stx_earned: event.data.stx_rewards.earned,
      stx_rewards_per_token: event.data.stx_rewards.rewards_per_token,
      bond_rewards: JSON.stringify(event.data.bond_rewards),
      bond_totals: event.data.bond_totals,
      total_rewards: event.data.total_rewards,
    };
    await sql`
      INSERT INTO signer_reward_claims ${sql(claim)}
    `;
  }

  /** Cycle-level reward aggregate, from the pox-5 `calculate-rewards` event. */
  private async updateBondRewardCalculation(
    sql: PgSqlClient,
    txLocation: DbTxLocation,
    event: Pox5EventCalculateRewards
  ) {
    const rewardCalculation: DbBondRewardCalculationInsertValues = {
      ...txLocation,
      calculation_height: parseInt(event.data.calculation_height),
      gross_accrued_rewards: event.data.gross_accrued_rewards,
      total_bond_rewards: event.data.total_bond_rewards,
      reserve_deposit: event.data.reserve_deposit,
      reserve_balance: event.data.reserve_balance,
      stx_cycle: parseInt(event.data.stx_cycle),
      total_stx_staker_rewards: event.data.total_stx_staker_rewards,
      cycle_staked_ustx: event.data.cycle_staked_ustx,
      accrued_rewards_per_ustx: event.data.accrued_rewards_per_ustx,
      cumulative_rewards_per_ustx: event.data.cumulative_rewards_per_ustx,
    };
    await sql`
      INSERT INTO bond_reward_calculations ${sql(rewardCalculation)}
    `;

    // Split the STX-staker reward pool across the current pox-5 STX lockers by
    // their locked weight: each staker accrues `floor(locked_ustx * per_ustx /
    // PRECISION)` (PRECISION = 1e18). The per-uSTX rate is uniform, so this is
    // the staker's share of `total_stx_staker_rewards` (modulo rounding dust).
    const perUstx = event.data.accrued_rewards_per_ustx;
    const rewardCycle = parseInt(event.data.stx_cycle);
    const stakerRewards = await sql<{ principal: string; reward_amount: string }[]>`
      SELECT principal,
        floor(locked_amount::numeric * ${perUstx}::numeric / 1000000000000000000)::text AS reward_amount
      FROM stx_locked_balances
      WHERE pox_version = 5
        AND floor(locked_amount::numeric * ${perUstx}::numeric / 1000000000000000000) > 0
    `;
    if (stakerRewards.length === 0) {
      return;
    }
    const rewardRows: DbPrincipalStxRewardDistributionInsertValues[] = stakerRewards.map(s => ({
      ...txLocation,
      principal: s.principal,
      reward_cycle: rewardCycle,
      reward_amount: s.reward_amount,
    }));
    for (const batch of batchIterate(rewardRows, INSERT_BATCH_SIZE)) {
      await sql`
        INSERT INTO principal_stx_reward_distributions ${sql(batch)}
      `;
    }
    if (!(txLocation.canonical && txLocation.microblock_canonical)) {
      // Side-fork calculation: the flag-carrying source rows above are enough. The reorg
      // flip-and-delta credits the STX accrued totals from them if the fork wins.
      return;
    }
    for (const s of stakerRewards) {
      await sql`
        INSERT INTO principal_staking_totals (principal, stx_accrued_rewards)
        VALUES (${s.principal}, ${s.reward_amount}::numeric)
        ON CONFLICT (principal) DO UPDATE
        SET stx_accrued_rewards = principal_staking_totals.stx_accrued_rewards + EXCLUDED.stx_accrued_rewards
      `;
    }
  }

  /** Low-level upsert of a principal's materialized STX lock (latest lock wins). */
  private async setStxLockedBalance(
    sql: PgSqlClient,
    values: {
      principal: string;
      lockedAmount: string;
      unlockBurnHeight: string | number;
      poxVersion: number;
      lockTxId: string;
      lockBlockHeight: number;
      burnchainLockHeight: string | number;
      /** The pox-5 signer the staker staked under, or null for pox-1..4 locks. */
      signer?: string | null;
    }
  ) {
    const insertValues = {
      principal: values.principal,
      locked_amount: values.lockedAmount,
      unlock_burn_height: values.unlockBurnHeight,
      pox_version: values.poxVersion,
      lock_tx_id: values.lockTxId,
      lock_block_height: values.lockBlockHeight,
      burnchain_lock_height: values.burnchainLockHeight,
      signer: values.signer ?? null,
    };
    await sql`
      INSERT INTO stx_locked_balances ${sql(insertValues)}
      ON CONFLICT (principal) DO UPDATE SET
        locked_amount = EXCLUDED.locked_amount,
        unlock_burn_height = EXCLUDED.unlock_burn_height,
        pox_version = EXCLUDED.pox_version,
        lock_tx_id = EXCLUDED.lock_tx_id,
        lock_block_height = EXCLUDED.lock_block_height,
        burnchain_lock_height = EXCLUDED.burnchain_lock_height,
        signer = EXCLUDED.signer
    `;
  }

  /**
   * Materialize a principal's current STX lock state (latest lock wins). Called for pox-5 `stake` /
   * `stake-update` / `unstake` events, which all carry the absolute locked amount and the
   * `unlock_burn_height`. `unstake` is included deliberately: it doesn't unlock instantly — it sets
   * the lock's unlock height to the end of the current cycle, and the materialized lock stays
   * locked until that burn height is reached (zeroed out on read by lock expiry).
   */
  private async upsertStxLockedBalance(
    sql: PgSqlClient,
    txLocation: DbTxLocation,
    event: Pox5EventStake | Pox5EventStakeUpdate | Pox5EventUnstake
  ) {
    if (!(txLocation.canonical && txLocation.microblock_canonical)) {
      // Side-fork lock event: the materialized lock is latest-wins per principal,
      // so applying it would clobber the canonical lock. If the fork wins, the
      // post-reorg lock re-materialization recomputes it from the canonical
      // pox5_events.
      return;
    }
    await this.setStxLockedBalance(sql, {
      principal: event.data.staker,
      lockedAmount: event.data.amount_ustx,
      unlockBurnHeight: event.data.unlock_burn_height,
      poxVersion: 5,
      lockTxId: txLocation.tx_id,
      lockBlockHeight: txLocation.block_height,
      burnchainLockHeight: txLocation.burn_block_height,
      // pox-5 stake/stake-update/unstake all carry the signer the staker staked under.
      signer: event.data.signer,
    });
  }

  /**
   * Materialize a pox-5 signer's currently-registered key (pox-5
   * `register-signer`). The contract keys its `signers` map by the signer
   * principal and overwrites on re-registration, so this is a latest-wins
   * upsert keyed by `signer`.
   */
  private async upsertStakingSigner(
    sql: PgSqlClient,
    txLocation: DbTxLocation,
    event: Pox5EventRegisterSigner
  ) {
    if (!(txLocation.canonical && txLocation.microblock_canonical)) {
      // Side-fork registration: the materialized signer key is latest-wins per signer, so applying
      // it would clobber the canonical key. If the fork wins, the post-reorg signer
      // re-materialization recomputes it from the canonical pox5_events.
      return;
    }
    await sql`
      INSERT INTO staking_signers (signer, signer_key, tx_id, block_height, burn_block_height)
      VALUES (
        ${event.data.signer}, ${event.data.signer_key}, ${txLocation.tx_id},
        ${txLocation.block_height}, ${txLocation.burn_block_height}
      )
      ON CONFLICT (signer) DO UPDATE SET
        signer_key = EXCLUDED.signer_key,
        tx_id = EXCLUDED.tx_id,
        block_height = EXCLUDED.block_height,
        burn_block_height = EXCLUDED.burn_block_height
    `;
  }

  /**
   * Append a signer key binding event (pox-5 `register-signer`, `grant-signer-key`, or
   * `revoke-signer-grant`) to the `signer_key_grants` history. Bindings are resolved against cycle
   * anchor blocks at read time, so this is a plain insert with no derived state.
   */
  private async insertSignerKeyGrant(
    sql: PgSqlClient,
    txLocation: DbTxLocation,
    event: (Pox5EventRegisterSigner | Pox5EventGrantSignerKey | Pox5EventRevokeSignerGrant) & {
      event_index: number;
    }
  ) {
    const grant: DbSignerKeyGrantInsertValues = {
      ...txLocation,
      kind:
        event.name === Pox5EventName.RegisterSigner
          ? DbSignerKeyGrantKind.Register
          : event.name === Pox5EventName.GrantSignerKey
            ? DbSignerKeyGrantKind.Grant
            : DbSignerKeyGrantKind.Revoke,
      signer_manager:
        'signer_manager' in event.data ? event.data.signer_manager : event.data.signer,
      signer_key: event.data.signer_key,
      auth_id: 'auth_id' in event.data ? event.data.auth_id : null,
      event_index: event.event_index,
    };
    await sql`
      INSERT INTO signer_key_grants ${sql(grant)}
    `;
  }

  /**
   * Recompute the materialized `staking_signers` rows for every signer touched
   * by a block whose canonical flag just flipped during a reorg. A signer's
   * registered key is a latest-wins value (not additive), so we re-derive it
   * from the latest canonical `register-signer` event in `pox5_events`. Must run
   * after the `pox5_events` canonical flips for this block have completed.
   */
  private async recomputeStakingSigners(sql: PgSqlClient, indexBlockHash: string) {
    const affectedRows = await sql<{ signer: string }[]>`
      SELECT data->>'signer' AS signer
      FROM pox5_events
      WHERE index_block_hash = ${indexBlockHash} AND name = 'register-signer'
    `;
    const signers = affectedRows.map(r => r.signer);
    if (signers.length === 0) {
      return;
    }
    for (const batch of batchIterate(signers, INSERT_BATCH_SIZE)) {
      await sql`
        DELETE FROM staking_signers WHERE signer IN ${sql(batch)}
      `;
      await sql`
        INSERT INTO staking_signers (signer, signer_key, tx_id, block_height, burn_block_height)
        SELECT DISTINCT ON (signer)
          data->>'signer' AS signer,
          decode(substr(data->>'signer_key', 3), 'hex') AS signer_key,
          tx_id,
          block_height,
          burn_block_height
        FROM pox5_events
        WHERE canonical = true AND microblock_canonical = true
          AND name = 'register-signer'
          AND data->>'signer' IN ${sql(batch)}
        ORDER BY signer,
          block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
      `;
    }
  }

  /**
   * Recompute the materialized `stx_locked_balances` rows for every principal touched by a block
   * whose canonical flag just flipped during a reorg.
   *
   * Locked STX is a SET/latest-wins value (not additive like ft_balances), so a reorg can't be
   * handled with signed deltas — instead we re-derive each affected principal's current lock from
   * the latest applicable canonical lock-changing event across all blocks: pox-1..4
   * `stx_lock_events` and the synthetic pox-5 `stake`/`stake-update`/`unstake` events (which all set
   * the lock with an absolute amount and `unlock_burn_height`).
   *
   * Must run AFTER the `stx_lock_events` and `pox5_events` canonical flips for this block have
   * completed (i.e. after the reorg queue drains), so the "latest canonical event" reflects the
   * post-flip state. Because the recompute reads global canonical state, the last-flipped block
   * touching a principal always produces that principal's final, correct value.
   */
  private async recomputeStxLockedBalances(sql: PgSqlClient, indexBlockHash: string) {
    // Principals whose lock state may have changed in this block.
    const affectedRows = await sql<{ principal: string }[]>`
      SELECT locked_address AS principal
      FROM stx_lock_events
      WHERE index_block_hash = ${indexBlockHash} AND contract_name <> 'pox-5'
      UNION
      SELECT data->>'staker' AS principal
      FROM pox5_events
      WHERE index_block_hash = ${indexBlockHash}
        AND name IN ('stake', 'stake-update', 'unstake')
    `;
    const principals = affectedRows.map(r => r.principal);
    if (principals.length === 0) {
      return;
    }
    // Process affected principals in chunks (same approach as other batched write paths). For each
    // chunk: drop their current materialized rows, then re-insert the correct rows (if any) derived
    // from the latest canonical lock-changing event.
    for (const batch of batchIterate(principals, INSERT_BATCH_SIZE)) {
      await sql`
        DELETE FROM stx_locked_balances
        WHERE principal IN ${sql(batch)}
      `;
      await sql`
        INSERT INTO stx_locked_balances (
          principal, locked_amount, unlock_burn_height, pox_version,
          lock_tx_id, lock_block_height, burnchain_lock_height, signer
        )
        SELECT principal, locked_amount, unlock_burn_height, pox_version,
          lock_tx_id, lock_block_height, burnchain_lock_height, signer
        FROM (
          SELECT DISTINCT ON (principal)
            principal, is_set, locked_amount, unlock_burn_height, pox_version,
            lock_tx_id, lock_block_height, burnchain_lock_height, signer
          FROM (
            -- pox-1..4 lock events (locked_amount = 0 means the lock was cleared)
            SELECT
              e.locked_address AS principal,
              e.block_height, e.microblock_sequence, e.tx_index, e.event_index,
              (e.locked_amount > 0) AS is_set,
              e.locked_amount,
              e.unlock_height AS unlock_burn_height,
              CASE e.contract_name
                WHEN 'pox' THEN 1 WHEN 'pox-2' THEN 2 WHEN 'pox-3' THEN 3 WHEN 'pox-4' THEN 4 ELSE 0
              END AS pox_version,
              e.tx_id AS lock_tx_id,
              e.block_height AS lock_block_height,
              b.burn_block_height AS burnchain_lock_height,
              NULL AS signer
            FROM stx_lock_events e
            JOIN blocks b ON b.index_block_hash = e.index_block_hash
            WHERE e.canonical = true AND e.microblock_canonical = true
              AND e.contract_name <> 'pox-5'
              AND e.locked_address IN ${sql(batch)}
            UNION ALL
            -- pox-5 stake / stake-update / unstake all set the lock with an
            -- absolute amount + unlock_burn_height. unstake moves the unlock
            -- height to the end of the current cycle (it does NOT clear the
            -- lock); the lock then expires on read once that height is reached.
            SELECT
              p.data->>'staker' AS principal,
              p.block_height, p.microblock_sequence, p.tx_index, p.event_index,
              true AS is_set,
              (p.data->>'amount_ustx')::numeric AS locked_amount,
              (p.data->>'unlock_burn_height')::bigint AS unlock_burn_height,
              5 AS pox_version,
              p.tx_id AS lock_tx_id,
              p.block_height AS lock_block_height,
              p.burn_block_height AS burnchain_lock_height,
              p.data->>'signer' AS signer
            FROM pox5_events p
            WHERE p.canonical = true AND p.microblock_canonical = true
              AND p.name IN ('stake', 'stake-update', 'unstake')
              AND p.data->>'staker' IN ${sql(batch)}
          ) candidates
          ORDER BY principal,
            block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
        ) latest
        WHERE latest.is_set
      `;
    }
  }

  private async updateBondAllowlistEntry(
    sql: PgSqlClient,
    txLocation: DbTxLocation,
    event: Pox5EventAddToAllowlist
  ) {
    const bondIndex = parseInt(event.data.bond_index);
    const maxSats = event.data.max_sats;
    const bondAllowlistEntry: DbBondAllowlistEntryInsertValues = {
      ...txLocation,
      bond_index: bondIndex,
      staker: event.data.staker,
      max_sats: maxSats,
    };
    if (!(txLocation.canonical && txLocation.microblock_canonical)) {
      // Side-fork event: persist the flag-carrying entry (the reorg flip-and-delta restores the
      // bond's capacity/count from it if the fork wins) but leave the canonical bond's counters
      // untouched.
      await sql`
        INSERT INTO bond_allowlist_entries ${sql(bondAllowlistEntry)}
      `;
      return;
    }
    await sql`
      WITH inserted AS (
        INSERT INTO bond_allowlist_entries ${sql(bondAllowlistEntry)}
        RETURNING bond_index, max_sats
      )
      UPDATE bonds AS b
      SET
        btc_capacity = b.btc_capacity + i.max_sats::numeric,
        allowed_count = b.allowed_count + 1
      FROM inserted AS i
      WHERE b.bond_index = i.bond_index
        AND b.canonical = true
        AND b.microblock_canonical = true
    `;
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
    if (data.pox_v4_unlock_height !== undefined) {
      // update the pox_state.pox_v4_unlock_height singleton
      await sql`
        UPDATE pox_state
        SET pox_v4_unlock_height = ${data.pox_v4_unlock_height}
        WHERE pox_v4_unlock_height != ${data.pox_v4_unlock_height}
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
      // Same-height fork handling; see `updateBurnchainRewards` for the reasoning.
      const orphanedSlotHolders = await sql<{ address: string }[]>`
        UPDATE reward_slot_holders
        SET canonical = false
        WHERE burn_block_height = ${burnchainBlockHeight}
          AND burn_block_hash != ${burnchainBlockHash}
          AND canonical = true
      `;
      if (orphanedSlotHolders.count > 0) {
        logger.warn(
          `Invalidated ${orphanedSlotHolders.count} burnchain reward slot holders after fork detected at burnchain block ${burnchainBlockHash}`
        );
      }
      if (slotHolders.length === 0) {
        return;
      }
      const values: RewardSlotHolderInsertValues[] = slotHolders.map(val => ({
        canonical: true,
        burn_block_hash: val.burn_block_hash,
        burn_block_height: val.burn_block_height,
        address: val.address,
        slot_index: val.slot_index,
      }));
      await sql`
        INSERT INTO reward_slot_holders ${sql(values)}
        ON CONFLICT ON CONSTRAINT reward_slot_holders_unique_idx DO UPDATE
        SET canonical = true
        WHERE reward_slot_holders.canonical = false
      `;
    });
  }

  async updateBurnBlockPoxTxs(args: {
    burnchainBlockHash: string;
    burnchainBlockHeight: number;
    burnBlockPoxTxs: DbBurnBlockPoxTx[];
  }): Promise<void> {
    await this.sqlWriteTransaction(async sql => {
      // Orphan same-height rows under a different hash (burnchain fork), keeping the materialized
      // per-recipient counts in sync. See `updateBurnchainRewards` for the reasoning; this too must
      // run even when the new burn block carries no pox txs.
      await sql`
        WITH orphaned AS (
          UPDATE burn_block_pox_txs
          SET canonical = false
          WHERE burn_block_height = ${args.burnchainBlockHeight}
            AND burn_block_hash != ${args.burnchainBlockHash}
            AND canonical = true
          RETURNING recipient
        ),
        count_deltas AS (
          SELECT recipient, COUNT(*) AS count
          FROM orphaned
          GROUP BY recipient
        )
        UPDATE burn_block_pox_tx_counts AS pc
        SET count = pc.count - cd.count
        FROM count_deltas AS cd
        WHERE pc.recipient = cd.recipient
      `;
      if (args.burnBlockPoxTxs.length === 0) return;
      // Re-delivered rows that are already canonical conflict without updating and are excluded
      // from the count deltas. Rows restored from a previously orphaned fork flip back to
      // canonical and count again.
      await sql`
        WITH inserts AS (
          INSERT INTO burn_block_pox_txs ${sql(args.burnBlockPoxTxs)}
          ON CONFLICT ON CONSTRAINT burn_block_pox_txs_unique_idx DO UPDATE
          SET canonical = true
          WHERE burn_block_pox_txs.canonical = false
          RETURNING recipient, canonical
        ),
        count_deltas AS (
          SELECT recipient, COUNT(*) AS count
          FROM inserts
          WHERE canonical = true
          GROUP BY recipient
        )
        INSERT INTO burn_block_pox_tx_counts (recipient, count)
        (SELECT recipient, count FROM count_deltas)
        ON CONFLICT (recipient) DO UPDATE SET count = burn_block_pox_tx_counts.count + EXCLUDED.count
      `;
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
          pox5Events: entry.pox5Events.map(e => ({ ...e, block_height: blockHeight })),
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
            },
            bond_count = (
              SELECT COUNT(*)::int
              FROM bonds
              WHERE canonical = true
                AND microblock_canonical = true
            )
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

  async updatePox4SyntheticEvents<
    T extends Pox4SyntheticEventTable,
    Entry extends { tx: DbTx } & ('pox2_events' extends T
      ? { pox2Events: DbPox4SyntheticEvent[] }
      : 'pox3_events' extends T
        ? { pox3Events: DbPox4SyntheticEvent[] }
        : 'pox4_events' extends T
          ? { pox4Events: DbPox4SyntheticEvent[] }
          : never),
  >(sql: PgSqlClient, poxTable: T, entries: Entry[]) {
    const values: Pox4SyntheticEventInsertValues[] = [];
    for (const entry of entries) {
      // eslint-disable-next-line no-useless-assignment
      let events: DbPox4SyntheticEvent[] | null = null;
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
        assert(event.pox_version === 'pox4', 'only pox4 events are supported');
        const value: Pox4SyntheticEventInsertValues = {
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
          case Pox4EventName.HandleUnlock: {
            value.first_cycle_locked = event.data.first_cycle_locked.toString();
            value.first_unlocked_cycle = event.data.first_unlocked_cycle.toString();
            break;
          }
          case Pox4EventName.StackStx: {
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
          case Pox4EventName.StackIncrease: {
            value.increase_by = event.data.increase_by.toString();
            value.total_locked = event.data.total_locked.toString();
            if (poxTable === 'pox4_events') {
              value.signer_key = event.data.signer_key;
              value.end_cycle_id = event.data.end_cycle_id?.toString() ?? null;
              value.start_cycle_id = event.data.start_cycle_id?.toString() ?? null;
            }
            break;
          }
          case Pox4EventName.StackExtend: {
            value.extend_count = event.data.extend_count.toString();
            value.unlock_burn_height = event.data.unlock_burn_height.toString();
            if (poxTable === 'pox4_events') {
              value.signer_key = event.data.signer_key;
              value.end_cycle_id = event.data.end_cycle_id?.toString() ?? null;
              value.start_cycle_id = event.data.start_cycle_id?.toString() ?? null;
            }
            break;
          }
          case Pox4EventName.DelegateStx: {
            value.amount_ustx = event.data.amount_ustx.toString();
            value.delegate_to = event.data.delegate_to;
            value.unlock_burn_height = event.data.unlock_burn_height?.toString() ?? null;
            if (poxTable === 'pox4_events') {
              value.end_cycle_id = event.data.end_cycle_id?.toString() ?? null;
              value.start_cycle_id = event.data.start_cycle_id?.toString() ?? null;
            }
            break;
          }
          case Pox4EventName.DelegateStackStx: {
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
          case Pox4EventName.DelegateStackIncrease: {
            value.increase_by = event.data.increase_by.toString();
            value.total_locked = event.data.total_locked.toString();
            value.delegator = event.data.delegator;
            if (poxTable === 'pox4_events') {
              value.end_cycle_id = event.data.end_cycle_id?.toString() ?? null;
              value.start_cycle_id = event.data.start_cycle_id?.toString() ?? null;
            }
            break;
          }
          case Pox4EventName.DelegateStackExtend: {
            value.extend_count = event.data.extend_count.toString();
            value.unlock_burn_height = event.data.unlock_burn_height.toString();
            value.delegator = event.data.delegator;
            if (poxTable === 'pox4_events') {
              value.end_cycle_id = event.data.end_cycle_id?.toString() ?? null;
              value.start_cycle_id = event.data.start_cycle_id?.toString() ?? null;
            }
            break;
          }
          case Pox4EventName.StackAggregationCommit: {
            value.reward_cycle = event.data.reward_cycle.toString();
            value.amount_ustx = event.data.amount_ustx.toString();
            if (poxTable === 'pox4_events') {
              value.signer_key = event.data.signer_key;
              value.end_cycle_id = event.data.end_cycle_id?.toString() ?? null;
              value.start_cycle_id = event.data.start_cycle_id?.toString() ?? null;
            }
            break;
          }
          case Pox4EventName.StackAggregationCommitIndexed: {
            value.reward_cycle = event.data.reward_cycle.toString();
            value.amount_ustx = event.data.amount_ustx.toString();
            if (poxTable === 'pox4_events') {
              value.signer_key = event.data.signer_key;
              value.end_cycle_id = event.data.end_cycle_id?.toString() ?? null;
              value.start_cycle_id = event.data.start_cycle_id?.toString() ?? null;
            }
            break;
          }
          case Pox4EventName.StackAggregationIncrease: {
            value.reward_cycle = event.data.reward_cycle.toString();
            value.amount_ustx = event.data.amount_ustx.toString();
            if (poxTable === 'pox4_events') {
              value.end_cycle_id = event.data.end_cycle_id?.toString() ?? null;
              value.start_cycle_id = event.data.start_cycle_id?.toString() ?? null;
            }
            break;
          }
          case Pox4EventName.RevokeDelegateStx: {
            value.delegate_to = event.data.delegate_to;
            if (poxTable === 'pox4_events') {
              value.end_cycle_id = event.data.end_cycle_id?.toString() ?? null;
              value.start_cycle_id = event.data.start_cycle_id?.toString() ?? null;
            }
            break;
          }
          default: {
            throw new Error(
              `Unexpected Pox synthetic event name: ${(event as DbPox4SyntheticEvent).name}`
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

    // Materialize the locked balance from these lock events. pox-5 locks are
    // owned by the synthetic stake/stake-update/unstake handlers, so skip them
    // here to avoid double-writes; pox-1..4 (and any future versions emitting
    // stx_lock events) are inherited here. Applied in block order so the latest
    // lock per principal wins.
    for (const { tx, stxLockEvents } of entries) {
      for (const event of stxLockEvents) {
        const poxVersion = poxVersionFromContractName(event.contract_name);
        if (poxVersion === undefined || poxVersion === 5) {
          continue;
        }
        await this.setStxLockedBalance(sql, {
          principal: event.locked_address,
          lockedAmount: event.locked_amount.toString(),
          unlockBurnHeight: event.unlock_height,
          poxVersion,
          lockTxId: event.tx_id,
          lockBlockHeight: event.block_height,
          burnchainLockHeight: tx.burn_block_height,
        });
      }
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

  /**
   * Advance the materialized total liquid STX supply counter on `chain_tip` with this block's
   * delta: mints − burns + matured miner coinbase rewards. Reorg corrections are applied in
   * `markEntitiesCanonical` and `updateFtBalancesFromMicroblockReOrg`, mirroring the
   * `ft_balances` 'stx' updates.
   */
  async updateStxSupply(
    sql: PgSqlClient,
    entries: { stxEvents: DbStxEvent[] }[],
    minerRewards: DbMinerReward[]
  ) {
    let delta = 0n;
    for (const { stxEvents } of entries) {
      for (const event of stxEvents) {
        if (event.asset_event_type_id === DbAssetEventTypeId.Mint) {
          delta += BigInt(event.amount);
        } else if (event.asset_event_type_id === DbAssetEventTypeId.Burn) {
          delta -= BigInt(event.amount);
        }
      }
    }
    for (const reward of minerRewards) {
      delta += BigInt(reward.coinbase_amount);
    }
    if (delta === 0n) return;
    await sql`UPDATE chain_tip SET stx_supply = stx_supply + ${delta.toString()}`;
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
      ),
      update_balances AS (
        INSERT INTO ft_balances (address, token, balance)
        SELECT ec.address, 'stx', ec.balance_change
        FROM event_changes ec
        ON CONFLICT (address, token)
        DO UPDATE
        SET balance = ft_balances.balance + EXCLUDED.balance
        RETURNING ft_balances.address
      ),
      supply_change AS (
        SELECT SUM(
          CASE asset_event_type_id
            WHEN 2 THEN (CASE WHEN canonical AND microblock_canonical THEN amount ELSE -amount END) -- Mint
            WHEN 3 THEN (CASE WHEN canonical AND microblock_canonical THEN -amount ELSE amount END) -- Burn
            ELSE 0
          END
        ) AS delta
        FROM updated_events
      )
      UPDATE chain_tip
      SET stx_supply = stx_supply + (SELECT delta FROM supply_change)
      WHERE EXISTS (SELECT 1 FROM supply_change WHERE delta IS NOT NULL)
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
      // Also bump the materialized `principal_stx_event_counts` for each canonical event: the
      // recipient's inbound count (transfers and mints) and the sender's outbound count (transfers
      // and burns). Follows the `principal_tx_counts` convention of counting `canonical = true`
      // rows.
      const res = await sql<{ inserted: number }[]>`
        WITH inserts AS (
          INSERT INTO stx_events ${sql(batch)}
          RETURNING sender, recipient, canonical
        ),
        count_deltas AS (
          SELECT
            COALESCE(i.principal, o.principal) AS principal,
            COALESCE(i.count, 0) AS inbound_count,
            COALESCE(o.count, 0) AS outbound_count
          FROM (
            SELECT recipient AS principal, COUNT(*) AS count
            FROM inserts
            WHERE canonical = true AND recipient IS NOT NULL
            GROUP BY recipient
          ) AS i
          FULL OUTER JOIN (
            SELECT sender AS principal, COUNT(*) AS count
            FROM inserts
            WHERE canonical = true AND sender IS NOT NULL
            GROUP BY sender
          ) AS o ON i.principal = o.principal
        ),
        count_updates AS (
          INSERT INTO principal_stx_event_counts (principal, inbound_count, outbound_count)
          (SELECT principal, inbound_count, outbound_count FROM count_deltas)
          ON CONFLICT (principal) DO UPDATE SET
            inbound_count = principal_stx_event_counts.inbound_count + EXCLUDED.inbound_count,
            outbound_count = principal_stx_event_counts.outbound_count + EXCLUDED.outbound_count
          RETURNING principal
        )
        SELECT COUNT(*)::int AS inserted FROM inserts
      `;
      const inserted = res[0]?.inserted ?? 0;
      assert(inserted === batch.length, `Expecting ${batch.length} inserts, got ${inserted}`);
    }
  }

  /**
   * Update the `principal_txs` table with the latest `tx_id`s that resulted in activity for a
   * principal (contract or address), and mark the type of token balance that was affected.
   * Also populates the `principal_tx_balance_changes` table with one row per
   * (principal, asset_type, asset_identifier) touched by each tx.
   * @param sql - DB client
   * @param txs - list of transactions
   */
  async updatePrincipalTxs(sql: PgSqlClient, txs: DataStoreTxEventData[]) {
    type PrincipalRow = {
      stx: boolean;
      ft: boolean;
      nft: boolean;
      stx_sent: BigNumber;
      stx_received: BigNumber;
      stx_mints: number;
      stx_burns: number;
      stx_transfers: number;
      ft_mints: number;
      ft_burns: number;
      ft_transfers: number;
      nft_mints: number;
      nft_burns: number;
      nft_transfers: number;
    };
    type BalanceChangeRow = {
      principal: string;
      asset_type: DbAssetType;
      asset_identifier: string;
      sent: BigNumber;
      received: BigNumber;
    };
    const STX_ASSET_IDENTIFIER = 'stx';
    const values: PrincipalTxsInsertValues[] = [];
    const balanceChangeValues: PrincipalTxBalanceChangeInsertValues[] = [];
    for (const { tx, stxEvents, ftEvents, nftEvents } of txs) {
      // Mark principals who participated in this transaction, along with the type of token balance
      // they affected.
      const principals = new Map<string, PrincipalRow>();
      const addPrincipal = (principal: string, data?: Partial<PrincipalRow>) => {
        const entry = principals.get(principal);
        principals.set(principal, {
          stx: entry?.stx || data?.stx || false,
          ft: entry?.ft || data?.ft || false,
          nft: entry?.nft || data?.nft || false,
          stx_sent: (entry?.stx_sent ?? new BigNumber(0)).plus(data?.stx_sent ?? 0n),
          stx_received: (entry?.stx_received ?? new BigNumber(0)).plus(data?.stx_received ?? 0n),
          stx_mints: (entry?.stx_mints ?? 0) + (data?.stx_mints ?? 0),
          stx_burns: (entry?.stx_burns ?? 0) + (data?.stx_burns ?? 0),
          stx_transfers: (entry?.stx_transfers ?? 0) + (data?.stx_transfers ?? 0),
          ft_mints: (entry?.ft_mints ?? 0) + (data?.ft_mints ?? 0),
          ft_burns: (entry?.ft_burns ?? 0) + (data?.ft_burns ?? 0),
          ft_transfers: (entry?.ft_transfers ?? 0) + (data?.ft_transfers ?? 0),
          nft_mints: (entry?.nft_mints ?? 0) + (data?.nft_mints ?? 0),
          nft_burns: (entry?.nft_burns ?? 0) + (data?.nft_burns ?? 0),
          nft_transfers: (entry?.nft_transfers ?? 0) + (data?.nft_transfers ?? 0),
        });
      };

      // Per-asset balance changes for this tx, keyed by `${principal}|${asset_type}|${asset_id}`.
      // Note: for NFTs we count tokens moved (each event contributes 1 to sent/received) since
      // the schema stores numeric counts rather than the underlying token values.
      const balanceChanges = new Map<string, BalanceChangeRow>();
      const addBalanceChange = (
        principal: string,
        asset_type: DbAssetType,
        asset_identifier: string,
        sent: BigNumber,
        received: BigNumber
      ) => {
        const key = `${principal}|${asset_type}|${asset_identifier}`;
        const entry = balanceChanges.get(key);
        balanceChanges.set(key, {
          principal,
          asset_type,
          asset_identifier,
          sent: (entry?.sent ?? new BigNumber(0)).plus(sent),
          received: (entry?.received ?? new BigNumber(0)).plus(received),
        });
      };

      // Record participating principals. No amounts yet, that will be included in stx_events below.
      addPrincipal(tx.sender_address);
      if (tx.token_transfer_recipient_address)
        addPrincipal(tx.token_transfer_recipient_address, { stx: true });
      if (tx.contract_call_contract_id) addPrincipal(tx.contract_call_contract_id);
      if (tx.smart_contract_contract_id) addPrincipal(tx.smart_contract_contract_id);

      // Record fee paid.
      const feePayer = tx.sponsor_address ?? tx.sender_address;
      const feeAmount = new BigNumber(tx.fee_rate);
      addPrincipal(feePayer, { stx: true, stx_sent: feeAmount });
      addBalanceChange(
        feePayer,
        DbAssetType.Stx,
        STX_ASSET_IDENTIFIER,
        feeAmount,
        new BigNumber(0)
      );

      // Record token amounts and event counts.
      for (const event of stxEvents) {
        switch (event.asset_event_type_id) {
          case DbAssetEventTypeId.Mint:
            if (event.recipient) {
              addPrincipal(event.recipient, {
                stx: true,
                stx_received: new BigNumber(event.amount),
                stx_mints: 1,
              });
              addBalanceChange(
                event.recipient,
                DbAssetType.Stx,
                STX_ASSET_IDENTIFIER,
                new BigNumber(0),
                new BigNumber(event.amount)
              );
            }
            break;
          case DbAssetEventTypeId.Burn:
            if (event.sender) {
              addPrincipal(event.sender, {
                stx: true,
                stx_sent: new BigNumber(event.amount),
                stx_burns: 1,
              });
              addBalanceChange(
                event.sender,
                DbAssetType.Stx,
                STX_ASSET_IDENTIFIER,
                new BigNumber(event.amount),
                new BigNumber(0)
              );
            }
            break;
          case DbAssetEventTypeId.Transfer:
            if (event.sender) {
              addPrincipal(event.sender, {
                stx: true,
                stx_sent: new BigNumber(event.amount),
                stx_transfers: 1,
              });
              addBalanceChange(
                event.sender,
                DbAssetType.Stx,
                STX_ASSET_IDENTIFIER,
                new BigNumber(event.amount),
                new BigNumber(0)
              );
            }
            if (event.recipient) {
              addPrincipal(event.recipient, {
                stx: true,
                stx_received: new BigNumber(event.amount),
                stx_transfers: 1,
              });
              addBalanceChange(
                event.recipient,
                DbAssetType.Stx,
                STX_ASSET_IDENTIFIER,
                new BigNumber(0),
                new BigNumber(event.amount)
              );
            }
            break;
        }
      }
      for (const event of ftEvents) {
        switch (event.asset_event_type_id) {
          case DbAssetEventTypeId.Mint:
            if (event.recipient) {
              addPrincipal(event.recipient, { ft: true, ft_mints: 1 });
              addBalanceChange(
                event.recipient,
                DbAssetType.Ft,
                event.asset_identifier,
                new BigNumber(0),
                new BigNumber(event.amount)
              );
            }
            break;
          case DbAssetEventTypeId.Burn:
            if (event.sender) {
              addPrincipal(event.sender, { ft: true, ft_burns: 1 });
              addBalanceChange(
                event.sender,
                DbAssetType.Ft,
                event.asset_identifier,
                new BigNumber(event.amount),
                new BigNumber(0)
              );
            }
            break;
          case DbAssetEventTypeId.Transfer:
            if (event.sender) {
              addPrincipal(event.sender, { ft: true, ft_transfers: 1 });
              addBalanceChange(
                event.sender,
                DbAssetType.Ft,
                event.asset_identifier,
                new BigNumber(event.amount),
                new BigNumber(0)
              );
            }
            if (event.recipient) {
              addPrincipal(event.recipient, {
                ft: true,
                ft_transfers: 1,
              });
              addBalanceChange(
                event.recipient,
                DbAssetType.Ft,
                event.asset_identifier,
                new BigNumber(0),
                new BigNumber(event.amount)
              );
            }
            break;
        }
      }
      for (const event of nftEvents) {
        switch (event.asset_event_type_id) {
          case DbAssetEventTypeId.Mint:
            if (event.recipient) {
              addPrincipal(event.recipient, { nft: true, nft_mints: 1 });
              addBalanceChange(
                event.recipient,
                DbAssetType.Nft,
                event.asset_identifier,
                new BigNumber(0),
                new BigNumber(1)
              );
            }
            break;
          case DbAssetEventTypeId.Burn:
            if (event.sender) {
              addPrincipal(event.sender, { nft: true, nft_burns: 1 });
              addBalanceChange(
                event.sender,
                DbAssetType.Nft,
                event.asset_identifier,
                new BigNumber(1),
                new BigNumber(0)
              );
            }
            break;
          case DbAssetEventTypeId.Transfer:
            if (event.sender) {
              addPrincipal(event.sender, { nft: true, nft_transfers: 1 });
              addBalanceChange(
                event.sender,
                DbAssetType.Nft,
                event.asset_identifier,
                new BigNumber(1),
                new BigNumber(0)
              );
            }
            if (event.recipient) {
              addPrincipal(event.recipient, { nft: true, nft_transfers: 1 });
              addBalanceChange(
                event.recipient,
                DbAssetType.Nft,
                event.asset_identifier,
                new BigNumber(0),
                new BigNumber(1)
              );
            }
            break;
        }
      }

      // Count balance change rows per principal so the principal_txs row carries
      // `balance_change_count` — used by the API to know how many rows to expect from
      // the drill-in endpoint without an extra COUNT(*) query.
      const balanceChangeCounts = new Map<string, number>();
      for (const row of balanceChanges.values()) {
        balanceChangeCounts.set(row.principal, (balanceChangeCounts.get(row.principal) ?? 0) + 1);
      }

      for (const [principal, data] of principals.entries()) {
        values.push({
          principal,
          tx_id: tx.tx_id,
          block_height: tx.block_height,
          index_block_hash: tx.index_block_hash,
          microblock_hash: tx.microblock_hash,
          microblock_sequence: tx.microblock_sequence,
          tx_index: tx.tx_index,
          canonical: tx.canonical,
          microblock_canonical: tx.microblock_canonical,
          stx_balance_affected: data.stx,
          ft_balance_affected: data.ft,
          nft_balance_affected: data.nft,
          stx_sent: data.stx_sent.toFixed(),
          stx_received: data.stx_received.toFixed(),
          stx_mint_event_count: data.stx_mints,
          stx_burn_event_count: data.stx_burns,
          stx_transfer_event_count: data.stx_transfers,
          ft_mint_event_count: data.ft_mints,
          ft_burn_event_count: data.ft_burns,
          ft_transfer_event_count: data.ft_transfers,
          nft_mint_event_count: data.nft_mints,
          nft_burn_event_count: data.nft_burns,
          nft_transfer_event_count: data.nft_transfers,
          balance_change_count: balanceChangeCounts.get(principal) ?? 0,
        });
      }

      for (const change of balanceChanges.values()) {
        balanceChangeValues.push({
          principal: change.principal,
          tx_id: tx.tx_id,
          block_height: tx.block_height,
          index_block_hash: tx.index_block_hash,
          microblock_hash: tx.microblock_hash,
          microblock_sequence: tx.microblock_sequence,
          tx_index: tx.tx_index,
          canonical: tx.canonical,
          microblock_canonical: tx.microblock_canonical,
          asset_type: change.asset_type,
          asset_identifier: change.asset_identifier,
          sent: change.sent.toFixed(),
          received: change.received.toFixed(),
        });
      }
    }
    for (const batch of batchIterate(values, INSERT_BATCH_SIZE)) {
      await sql`
        WITH inserts AS (
          INSERT INTO principal_txs ${sql(batch)}
          ON CONFLICT ON CONSTRAINT principal_txs_unique DO NOTHING
          RETURNING principal, canonical
        ),
        count_deltas AS (
          SELECT principal, COUNT(*) AS count
          FROM inserts
          WHERE canonical = true
          GROUP BY principal
        )
        INSERT INTO principal_tx_counts (principal, count)
        (SELECT principal, count FROM count_deltas)
        ON CONFLICT (principal) DO UPDATE SET count = principal_tx_counts.count + EXCLUDED.count
      `;
    }
    for (const batch of batchIterate(balanceChangeValues, INSERT_BATCH_SIZE)) {
      await sql`
        INSERT INTO principal_tx_balance_changes ${sql(batch)}
        ON CONFLICT ON CONSTRAINT unique_principal_tx_balance_changes DO NOTHING
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
    _microblock: boolean = false
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
    // Update contract_log_counts (only for canonical events)
    const countDeltas = new Map<string, number>();
    for (const v of values) {
      if (v.canonical) {
        countDeltas.set(v.contract_identifier, (countDeltas.get(v.contract_identifier) ?? 0) + 1);
      }
    }
    for (const [contractId, count] of countDeltas) {
      await sql`
        INSERT INTO contract_log_counts (contract_identifier, count)
        VALUES (${contractId}, ${count})
        ON CONFLICT (contract_identifier)
        DO UPDATE SET count = contract_log_counts.count + EXCLUDED.count
      `;
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
    // Update contract_log_counts (only for canonical events)
    if (event.canonical) {
      await sql`
        INSERT INTO contract_log_counts (contract_identifier, count)
        VALUES (${event.contract_identifier}, 1)
        ON CONFLICT (contract_identifier)
        DO UPDATE SET count = contract_log_counts.count + 1
      `;
    }
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

  async updateBurnchainBlock({
    burnchainBlockHash,
    burnchainBlockHeight,
    burnAmount,
    rewardAmount,
  }: {
    burnchainBlockHash: string;
    burnchainBlockHeight: number;
    burnAmount: bigint;
    rewardAmount: bigint;
  }): Promise<void> {
    return await this.sqlWriteTransaction(async sql => {
      // Same-height fork handling; see `updateBurnchainRewards` for the reasoning.
      await sql`
        UPDATE burn_blocks
        SET canonical = false
        WHERE burn_block_height = ${burnchainBlockHeight}
          AND burn_block_hash != ${burnchainBlockHash}
          AND canonical = true
      `;
      const values: BurnchainBlockInsertValues = {
        canonical: true,
        burn_block_hash: burnchainBlockHash,
        burn_block_height: burnchainBlockHeight,
        burn_amount: burnAmount.toString(),
        reward_amount: rewardAmount.toString(),
      };
      await sql`
        INSERT INTO burn_blocks ${sql(values)}
        ON CONFLICT ON CONSTRAINT burn_blocks_unique_idx DO UPDATE
        SET canonical = true
        WHERE burn_blocks.canonical = false
      `;
    });
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
      // The burnchain is linear: a new burn block at this height means any rewards previously
      // stored at the same height under a different hash belong to an orphaned burnchain fork. This
      // must run even when `rewards` is empty. A zero-recipient burn block is how the node reports
      // a replacement block that paid no rewards. Heights above this one are never touched: the
      // node announces every replacement block of a burnchain fork individually, and it may also
      // re-deliver old burn blocks out of order, which must not orphan newer data.
      const orphanedRewards = await sql`
        UPDATE burnchain_rewards
        SET canonical = false
        WHERE burn_block_height = ${burnchainBlockHeight}
          AND burn_block_hash != ${burnchainBlockHash}
          AND canonical = true
      `;
      if (orphanedRewards.count > 0) {
        logger.warn(
          `Invalidated ${orphanedRewards.count} burnchain rewards after fork detected at burnchain block ${burnchainBlockHash}`
        );
      }
      if (rewards.length === 0) return;
      const values: BurnchainRewardInsertValues[] = rewards.map(reward => ({
        canonical: true,
        burn_block_hash: reward.burn_block_hash,
        burn_block_height: reward.burn_block_height,
        reward_recipient: reward.reward_recipient,
        reward_amount: reward.reward_amount,
        reward_index: reward.reward_index,
      }));
      // Idempotent against re-delivered events. The conflict update restores canonical status when
      // the burnchain forks back to a previously orphaned block.
      await sql`
        INSERT INTO burnchain_rewards ${sql(values)}
        ON CONFLICT ON CONSTRAINT burnchain_rewards_unique_idx DO UPDATE
        SET canonical = true
        WHERE burnchain_rewards.canonical = false
      `;
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
          SELECT m.tx_id, m.fee_rate, m.receipt_time, m.pruned, g.address, g.nonce
          FROM mempool_txs m
          INNER JOIN affected_groups g
            ON m.sender_address = g.address AND m.nonce = g.nonce
          UNION
          SELECT m.tx_id, m.fee_rate, m.receipt_time, m.pruned, g.address, g.nonce
          FROM mempool_txs m
          INNER JOIN affected_groups g
            ON m.sponsor_address = g.address AND m.nonce = g.nonce
        ),
        mined_txs AS (
          SELECT t.tx_id, g.address, g.nonce,
            t.block_height, t.microblock_sequence, t.tx_index
          FROM txs t
          INNER JOIN affected_groups g
            ON t.sender_address = g.address AND t.nonce = g.nonce
          WHERE t.canonical = true AND t.microblock_canonical = true
          UNION
          SELECT t.tx_id, g.address, g.nonce,
            t.block_height, t.microblock_sequence, t.tx_index
          FROM txs t
          INNER JOIN affected_groups g
            ON t.sponsor_address = g.address AND t.nonce = g.nonce
          WHERE t.canonical = true AND t.microblock_canonical = true
        ),
        latest_mined_txs AS (
          SELECT DISTINCT ON (address, nonce) tx_id, address, nonce
          FROM mined_txs
          ORDER BY address, nonce, block_height DESC, microblock_sequence DESC, tx_index DESC
        ),
        highest_fee_mempool_txs AS (
          SELECT DISTINCT ON (address, nonce) tx_id, address, nonce
          FROM same_nonce_mempool_txs
          ORDER BY address, nonce, fee_rate DESC, receipt_time DESC
        ),
        winning_txs AS (
          SELECT DISTINCT
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
              LIMIT 1
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
      Math.min(
        ENV.MEMPOOL_STATS_DEBOUNCE_MAX_INTERVAL - waited,
        ENV.MEMPOOL_STATS_DEBOUNCE_INTERVAL
      )
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
    const replaced_by = new_tx_id ?? null;
    for (const batch of batchIterate(txIds, INSERT_BATCH_SIZE)) {
      const updateResults = await this.sql<{ tx_id: string }[]>`
        WITH pruned AS (
          UPDATE mempool_txs
          SET pruned = TRUE, status = ${status}, replaced_by_tx_id = ${replaced_by}
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
        abi: smartContract.abi ? (JSON.parse(smartContract.abi) ?? 'null') : 'null',
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      q.enqueue(() => this.updatePrincipalTxs(sql, txs));
      q.enqueue(() => this.updateSmartContractEvents(sql, txs));
      q.enqueue(() => this.updatePox4SyntheticEvents(sql, 'pox2_events', txs));
      q.enqueue(() => this.updatePox4SyntheticEvents(sql, 'pox3_events', txs));
      q.enqueue(() => this.updatePox4SyntheticEvents(sql, 'pox4_events', txs));
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
        UPDATE principal_txs
        SET microblock_canonical = ${args.isMicroCanonical},
          canonical = ${args.isCanonical}, index_block_hash = ${args.indexBlockHash}
        WHERE microblock_hash IN ${sql(args.microblocks)}
          AND (index_block_hash = ${args.indexBlockHash} OR index_block_hash = '\\x'::bytea)
          AND tx_id IN ${sql(txIds)}
      `;
      await sql`
        UPDATE principal_tx_balance_changes
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
        INNER JOIN sponsored_inputs i ON m.sponsor_address = i.sponsor_address AND m.nonce = i.nonce::int
        UNION
        SELECT m.tx_id
        FROM mempool_txs m
        INNER JOIN sponsored_inputs i ON m.sender_address = i.sponsor_address AND m.nonce = i.nonce::int
      ),
      affected_non_sponsored AS (
        SELECT m.tx_id
        FROM mempool_txs m
        INNER JOIN non_sponsored_inputs i ON m.sponsor_address = i.sender_address AND m.nonce = i.nonce::int
        UNION
        SELECT m.tx_id
        FROM mempool_txs m
        INNER JOIN non_sponsored_inputs i ON m.sender_address = i.sender_address AND m.nonce = i.nonce::int
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
        INNER JOIN sponsored_inputs i ON m.sponsor_address = i.sponsor_address AND m.nonce = i.nonce::int
        UNION
        SELECT m.tx_id
        FROM mempool_txs m
        INNER JOIN sponsored_inputs i ON m.sender_address = i.sponsor_address AND m.nonce = i.nonce::int
      ),
      affected_non_sponsored AS (
        SELECT m.tx_id
        FROM mempool_txs m
        INNER JOIN non_sponsored_inputs i ON m.sponsor_address = i.sender_address AND m.nonce = i.nonce::int
        UNION
        SELECT m.tx_id
        FROM mempool_txs m
        INNER JOIN non_sponsored_inputs i ON m.sender_address = i.sender_address AND m.nonce = i.nonce::int
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
          WITH updates AS (
            UPDATE principal_txs
            SET canonical = ${canonical}
            WHERE tx_id IN ${sql(txs.map(t => t.txId))}
              AND index_block_hash = ${indexBlockHash}
              AND canonical != ${canonical}
            RETURNING principal
          ),
          count_deltas AS (
            SELECT principal, COUNT(*) AS count
            FROM updates
            GROUP BY principal
          )
          UPDATE principal_tx_counts AS pc
          SET count = ${canonical ? sql`pc.count + cd.count` : sql`pc.count - cd.count`}
          FROM count_deltas AS cd
          WHERE pc.principal = cd.principal
        `;
        await sql`
          UPDATE principal_tx_balance_changes
          SET canonical = ${canonical}
          WHERE tx_id IN ${sql(txs.map(t => t.txId))}
            AND index_block_hash = ${indexBlockHash}
            AND canonical != ${canonical}
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
        ),
        supply_change AS (
          SELECT SUM(CASE WHEN canonical THEN coinbase_amount ELSE -coinbase_amount END) AS delta
          FROM updated_rewards
        ),
        update_stx_supply AS (
          UPDATE chain_tip
          SET stx_supply = stx_supply + (SELECT delta FROM supply_change)
          WHERE EXISTS (SELECT 1 FROM supply_change WHERE delta IS NOT NULL)
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
        ),
        count_deltas AS (
          SELECT
            COALESCE(i.principal, o.principal) AS principal,
            COALESCE(i.count, 0) AS inbound_count,
            COALESCE(o.count, 0) AS outbound_count
          FROM (
            SELECT recipient AS principal, COUNT(*) AS count
            FROM updated_events
            WHERE recipient IS NOT NULL
            GROUP BY recipient
          ) AS i
          FULL OUTER JOIN (
            SELECT sender AS principal, COUNT(*) AS count
            FROM updated_events
            WHERE sender IS NOT NULL
            GROUP BY sender
          ) AS o ON i.principal = o.principal
        ),
        update_event_counts AS (
          -- Upsert rather than update: a principal whose only events were ingested in a
          -- non-canonical block has no counts row yet when that block is restored to canonical.
          INSERT INTO principal_stx_event_counts (principal, inbound_count, outbound_count)
          SELECT
            principal,
            ${canonical ? sql`inbound_count` : sql`-inbound_count`},
            ${canonical ? sql`outbound_count` : sql`-outbound_count`}
          FROM count_deltas
          ON CONFLICT (principal) DO UPDATE SET
            inbound_count = principal_stx_event_counts.inbound_count + EXCLUDED.inbound_count,
            outbound_count = principal_stx_event_counts.outbound_count + EXCLUDED.outbound_count
          RETURNING principal
        ),
        supply_change AS (
          SELECT SUM(
            CASE asset_event_type_id
              WHEN 2 THEN (CASE WHEN canonical THEN amount ELSE -amount END) -- Mint
              WHEN 3 THEN (CASE WHEN canonical THEN -amount ELSE amount END) -- Burn
              ELSE 0
            END
          ) AS delta
          FROM updated_events
        ),
        update_stx_supply AS (
          UPDATE chain_tip
          SET stx_supply = stx_supply + (SELECT delta FROM supply_change)
          WHERE EXISTS (SELECT 1 FROM supply_change WHERE delta IS NOT NULL)
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
    // pox-5 tables that only need their canonical flag flipped (no derived
    // bond counters depend on them).
    for (const pox5Table of [
      'bonds',
      'bond_reward_distributions',
      'bond_reward_calculations',
      'signer_reward_claims',
      'signer_key_grants',
    ]) {
      q.enqueue(async () => {
        await sql`
          UPDATE ${sql(pox5Table)}
          SET canonical = ${canonical}
          WHERE index_block_hash = ${indexBlockHash} AND canonical != ${canonical}
        `;
      });
    }
    // The bond aggregate counters live on the `bonds` row and are maintained
    // incrementally. On reorg we flip the child rows' canonical flag and apply
    // a signed delta (+ when restoring, − when orphaning) to the parent bond's
    // counters — the same flip-and-delta approach used for ft_balances above.
    // No `bonds.canonical` guard on the delta: the delta must apply symmetrically
    // in both directions (orphan then restore) to avoid double-counting, exactly
    // like the ft_balances upsert.
    q.enqueue(async () => {
      // Flip pox5_events and apply the bond-scoped event delta to the parent bond's `event_count`
      // (only events carrying a non-null `bond_index` count). The delta is restricted to
      // microblock-canonical rows to mirror the insert-time tally;
      // `pox5_events.microblock_canonical` never changes after insert, so the two stay symmetric.
      await sql`
        WITH updated AS (
          UPDATE pox5_events
          SET canonical = ${canonical}
          WHERE index_block_hash = ${indexBlockHash} AND canonical != ${canonical}
          RETURNING (data->>'bond_index')::int AS bond_index, canonical, microblock_canonical
        ),
        changes AS (
          SELECT bond_index, SUM(CASE WHEN canonical THEN 1 ELSE -1 END) AS count_change
          FROM updated
          WHERE bond_index IS NOT NULL AND microblock_canonical = TRUE
          GROUP BY bond_index
        )
        UPDATE bonds AS b
        SET event_count = b.event_count + c.count_change
        FROM changes c
        WHERE b.bond_index = c.bond_index
      `;
    });
    q.enqueue(async () => {
      await sql`
        WITH updated AS (
          UPDATE bond_allowlist_entries
          SET canonical = ${canonical}
          WHERE index_block_hash = ${indexBlockHash} AND canonical != ${canonical}
          RETURNING bond_index, max_sats, canonical
        ),
        changes AS (
          SELECT bond_index,
            SUM(CASE WHEN canonical THEN max_sats::numeric ELSE -max_sats::numeric END) AS capacity_change,
            SUM(CASE WHEN canonical THEN 1 ELSE -1 END) AS count_change
          FROM updated
          GROUP BY bond_index
        )
        UPDATE bonds AS b
        SET btc_capacity = b.btc_capacity + c.capacity_change,
            allowed_count = b.allowed_count + c.count_change
        FROM changes c
        WHERE b.bond_index = c.bond_index
      `;
    });
    q.enqueue(async () => {
      await sql`
        WITH updated AS (
          UPDATE bond_registrations
          SET canonical = ${canonical}
          WHERE index_block_hash = ${indexBlockHash} AND canonical != ${canonical}
          RETURNING bond_index, canonical
        ),
        changes AS (
          SELECT bond_index, SUM(CASE WHEN canonical THEN 1 ELSE -1 END) AS count_change
          FROM updated
          GROUP BY bond_index
        )
        UPDATE bonds AS b
        SET registered_count = b.registered_count + c.count_change
        FROM changes c
        WHERE b.bond_index = c.bond_index
      `;
    });
    q.enqueue(async () => {
      await sql`
        WITH updated AS (
          UPDATE principal_bond_positions
          SET canonical = ${canonical}
          WHERE index_block_hash = ${indexBlockHash} AND canonical != ${canonical}
          RETURNING principal, bond_index, btc_locked, stx_locked, btc_paid_out, canonical
        ),
        bond_changes AS (
          SELECT bond_index,
            SUM(CASE WHEN canonical THEN btc_locked::numeric ELSE -btc_locked::numeric END) AS btc_change,
            SUM(CASE WHEN canonical THEN stx_locked::numeric ELSE -stx_locked::numeric END) AS stx_change,
            SUM(CASE WHEN canonical THEN btc_paid_out::numeric ELSE -btc_paid_out::numeric END) AS paid_change
          FROM updated
          GROUP BY bond_index
        ),
        bond_update AS (
          UPDATE bonds AS b
          SET btc_locked = b.btc_locked + c.btc_change,
              stx_locked = b.stx_locked + c.stx_change,
              btc_paid_out = b.btc_paid_out + c.paid_change
          FROM bond_changes c
          WHERE b.bond_index = c.bond_index
          RETURNING 1
        ),
        principal_changes AS (
          SELECT principal,
            SUM(CASE WHEN canonical THEN 1 ELSE -1 END) AS count_change,
            SUM(CASE WHEN canonical THEN btc_locked::numeric ELSE -btc_locked::numeric END) AS btc_change,
            SUM(CASE WHEN canonical THEN stx_locked::numeric ELSE -stx_locked::numeric END) AS stx_change
          FROM updated
          GROUP BY principal
        )
        INSERT INTO principal_staking_totals
          (principal, bond_count, bond_btc_locked, bond_stx_locked)
        SELECT principal, count_change, btc_change, stx_change FROM principal_changes
        ON CONFLICT (principal) DO UPDATE SET
          bond_count = principal_staking_totals.bond_count + EXCLUDED.bond_count,
          bond_btc_locked = principal_staking_totals.bond_btc_locked + EXCLUDED.bond_btc_locked,
          bond_stx_locked = principal_staking_totals.bond_stx_locked + EXCLUDED.bond_stx_locked
      `;
    });
    q.enqueue(async () => {
      // Flip the per-participant reward source rows and apply the signed delta to
      // each participant's running accrued_rewards total (ft_events → ft_balances).
      await sql`
        WITH updated AS (
          UPDATE principal_bond_reward_distributions
          SET canonical = ${canonical}
          WHERE index_block_hash = ${indexBlockHash} AND canonical != ${canonical}
          RETURNING principal, bond_index, reward_amount, canonical
        ),
        changes AS (
          SELECT principal, bond_index,
            SUM(CASE WHEN canonical THEN reward_amount::numeric ELSE -reward_amount::numeric END) AS reward_change
          FROM updated
          GROUP BY principal, bond_index
        ),
        pos_update AS (
          UPDATE principal_bond_positions p
          SET accrued_rewards = p.accrued_rewards + c.reward_change
          FROM changes c
          WHERE p.principal = c.principal AND p.bond_index = c.bond_index
          RETURNING 1
        ),
        principal_changes AS (
          SELECT principal, SUM(reward_change) AS reward_change
          FROM changes
          GROUP BY principal
        )
        INSERT INTO principal_staking_totals (principal, bond_accrued_rewards)
        SELECT principal, reward_change FROM principal_changes
        ON CONFLICT (principal) DO UPDATE SET
          bond_accrued_rewards = principal_staking_totals.bond_accrued_rewards + EXCLUDED.bond_accrued_rewards
      `;
    });
    q.enqueue(async () => {
      // Flip the per-staker reward claim source rows and apply the signed delta
      // to each bond position's running claimed_rewards total (bond claims).
      await sql`
        WITH updated AS (
          UPDATE principal_bond_reward_claims
          SET canonical = ${canonical}
          WHERE index_block_hash = ${indexBlockHash} AND canonical != ${canonical}
          RETURNING principal, bond_index, rewards_claimed, canonical
        ),
        changes AS (
          SELECT principal, bond_index,
            SUM(CASE WHEN canonical THEN rewards_claimed::numeric ELSE -rewards_claimed::numeric END) AS claim_change
          FROM updated
          WHERE bond_index IS NOT NULL
          GROUP BY principal, bond_index
        ),
        pos_update AS (
          UPDATE principal_bond_positions p
          SET claimed_rewards = p.claimed_rewards + c.claim_change
          FROM changes c
          WHERE p.principal = c.principal AND p.bond_index = c.bond_index
          RETURNING 1
        ),
        principal_changes AS (
          SELECT principal, SUM(claim_change) AS claim_change
          FROM changes
          GROUP BY principal
        )
        INSERT INTO principal_staking_totals (principal, bond_claimed_rewards)
        SELECT principal, claim_change FROM principal_changes
        ON CONFLICT (principal) DO UPDATE SET
          bond_claimed_rewards = principal_staking_totals.bond_claimed_rewards + EXCLUDED.bond_claimed_rewards
      `;
      // The flip above also settled the STX-staking claims (NULL bond_index);
      // apply their signed delta to the STX-staking claimed total. The rows are
      // now at `canonical`, so the direction follows that flag.
      await sql`
        WITH changes AS (
          SELECT principal, SUM(rewards_claimed::numeric) AS total
          FROM principal_bond_reward_claims
          WHERE index_block_hash = ${indexBlockHash}
            AND canonical = ${canonical}
            AND bond_index IS NULL
          GROUP BY principal
        )
        UPDATE principal_staking_totals p
        SET stx_claimed_rewards = ${
          canonical ? sql`p.stx_claimed_rewards + c.total` : sql`p.stx_claimed_rewards - c.total`
        }
        FROM changes c
        WHERE p.principal = c.principal
      `;
    });
    q.enqueue(async () => {
      // Flip the per-staker STX reward distribution source rows and apply the
      // signed delta to each staker's running STX-staking accrued_rewards total.
      await sql`
        WITH updated AS (
          UPDATE principal_stx_reward_distributions
          SET canonical = ${canonical}
          WHERE index_block_hash = ${indexBlockHash} AND canonical != ${canonical}
          RETURNING principal, reward_amount, canonical
        ),
        changes AS (
          SELECT principal,
            SUM(CASE WHEN canonical THEN reward_amount::numeric ELSE -reward_amount::numeric END) AS reward_change
          FROM updated
          GROUP BY principal
        )
        UPDATE principal_staking_totals p
        SET stx_accrued_rewards = p.stx_accrued_rewards + c.reward_change
        FROM changes c
        WHERE p.principal = c.principal
      `;
    });
    q.enqueue(async () => {
      const contractLogResult = await sql<{ contract_identifier: string; delta: number }[]>`
        WITH updated AS (
          UPDATE contract_logs
          SET canonical = ${canonical}
          WHERE index_block_hash = ${indexBlockHash} AND canonical != ${canonical}
          RETURNING contract_identifier
        )
        SELECT contract_identifier, COUNT(*)::int AS delta FROM updated GROUP BY contract_identifier
      `;
      for (const row of contractLogResult) {
        await sql`
          UPDATE contract_log_counts
          SET count = count + ${canonical ? row.delta : -row.delta}
          WHERE contract_identifier = ${row.contract_identifier}
        `;
      }
      const totalCount = contractLogResult.reduce((sum, r) => sum + r.delta, 0);
      if (canonical) {
        updatedEntities.markedCanonical.contractLogs += totalCount;
      } else {
        updatedEntities.markedNonCanonical.contractLogs += totalCount;
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
    // Note: `burnchain_rewards` and `burn_block_pox_txs` record burnchain-level facts and are
    // deliberately not flipped here. A Stacks-level re-org (even one orphaning a full tenure) does
    // not un-pay bitcoin: their canonical status is maintained exclusively by `/new_burn_block`
    // ingestion, which orphans same-height rows when the burnchain itself forks.

    await q.done();

    // Recompute the materialized locked-STX balances and staking signer registry
    // for entities touched by this block. Must run after the queue drains so the
    // `stx_lock_events` / `pox5_events` canonical flips above are visible.
    await this.recomputeStxLockedBalances(sql, indexBlockHash);
    await this.recomputeStakingSigners(sql, indexBlockHash);

    return result;
  }

  /**
   * Marks a single currently-canonical block (and all its associated entities) as non-canonical,
   * restoring its transactions to the mempool. Microblock canonical-status results are returned to
   * the caller instead of being tallied into `updatedEntities` so callers can dedupe them against
   * other canonical-flip operations happening as part of the same re-org (see
   * `restoreOrphanedChain`).
   */
  private async markBlockNonCanonical(
    sql: PgSqlClient,
    block: DbBlock,
    updatedEntities: ReOrgUpdatedEntities
  ): Promise<{ orphanedMicroblocks: string[]; acceptedMicroblocks: string[] }> {
    await sql`
      UPDATE blocks
      SET canonical = false
      WHERE index_block_hash = ${block.index_block_hash} AND canonical = true
    `;
    const microCanonicalUpdateResult = await this.updateMicroCanonical(sql, {
      isCanonical: false,
      blockHeight: block.block_height,
      blockHash: block.block_hash,
      indexBlockHash: block.index_block_hash,
      parentIndexBlockHash: block.parent_index_block_hash,
      parentMicroblockHash: block.parent_microblock_hash,
      parentMicroblockSequence: block.parent_microblock_sequence,
      burnBlockTime: block.burn_block_time,
      burnBlockHeight: block.burn_block_height,
    });
    updatedEntities.markedNonCanonical.blocks++;
    updatedEntities.markedNonCanonical.blockHeaders.unshift({
      index_block_hash: block.index_block_hash,
      block_height: block.block_height,
      block_time: block.block_time,
    });
    const markNonCanonicalResult = await this.markEntitiesCanonical(
      sql,
      block.index_block_hash,
      false,
      updatedEntities
    );
    const restoredMempoolTxs = await this.restoreMempoolTxs(
      sql,
      markNonCanonicalResult.txsMarkedNonCanonical
    );
    updatedEntities.restoredMempoolTxs += restoredMempoolTxs.restoredTxs.length;
    return {
      orphanedMicroblocks: microCanonicalUpdateResult.orphanedMicroblocks,
      acceptedMicroblocks: microCanonicalUpdateResult.acceptedMicroblocks,
    };
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
      SELECT ${sql(BLOCK_COLUMNS)}
      FROM blocks
      WHERE block_height = ${restoredBlockResult[0].block_height}
        AND index_block_hash != ${indexBlockHash} AND canonical = true
    `;

    const microblocksOrphaned = new Set<string>();
    const microblocksAccepted = new Set<string>();

    if (orphanedBlockResult.length > 0) {
      const orphanedBlocks = orphanedBlockResult.map(b => parseBlockQueryResult(b));
      for (const orphanedBlock of orphanedBlocks) {
        const microCanonicalUpdateResult = await this.markBlockNonCanonical(
          sql,
          orphanedBlock,
          updatedEntities
        );
        microCanonicalUpdateResult.orphanedMicroblocks.forEach(mb => {
          microblocksOrphaned.add(mb);
          microblocksAccepted.delete(mb);
        });
        microCanonicalUpdateResult.acceptedMicroblocks.forEach(mb => {
          microblocksOrphaned.delete(mb);
          microblocksAccepted.add(mb);
        });
      }
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

  /**
   * Marks all canonical blocks above the given height (and their associated entities) as
   * non-canonical, walking down from the current chain tip. Used when a Nakamoto block re-orgs the
   * chain onto a fork that is shorter than (or equal in length to) the current canonical chain,
   * which moves the chain tip backwards.
   */
  private async orphanCanonicalBlocksAboveHeight(
    sql: PgSqlClient,
    height: number,
    updatedEntities: ReOrgUpdatedEntities
  ): Promise<void> {
    const blocksToOrphanResult = await sql<BlockQueryResult[]>`
      SELECT ${sql(BLOCK_COLUMNS)}
      FROM blocks
      WHERE block_height > ${height} AND canonical = true
      ORDER BY block_height DESC
    `;
    if (blocksToOrphanResult.length > 1) {
      logger.debug(
        `Orphaning ${blocksToOrphanResult.length} canonical blocks above height ${height}, chain tip is moving backwards`
      );
    }
    for (const blockToOrphan of blocksToOrphanResult) {
      const block = parseBlockQueryResult(blockToOrphan);
      const { orphanedMicroblocks } = await this.markBlockNonCanonical(sql, block, updatedEntities);
      updatedEntities.markedNonCanonical.microblocks += orphanedMicroblocks.length;
      updatedEntities.markedNonCanonical.microblockHashes.push(...orphanedMicroblocks);
    }
  }

  /**
   * Handles a re-org for an incoming Nakamoto block. Nakamoto blocks are validated by signers
   * before they reach the event stream, so an incoming block always becomes the new canonical chain
   * tip immediately, even when it builds on a fork that is shorter than the current canonical chain
   * (i.e. the chain tip can move backwards).
   */
  async handleReorgNakamoto(
    sql: PgSqlClient,
    block: DbBlock,
    chainTip: DbChainTip
  ): Promise<ReOrgUpdatedEntities> {
    const updatedEntities = newReOrgUpdatedEntities();
    // Common case: the new block builds off the current chain tip.
    if (block.parent_index_block_hash === chainTip.index_block_hash) {
      return updatedEntities;
    }
    if (block.block_height <= 1) {
      return updatedEntities;
    }
    const parentResult = await sql<
      {
        canonical: boolean;
        index_block_hash: string;
        burn_block_hash: string;
        parent_index_block_hash: string;
      }[]
    >`
      SELECT canonical, index_block_hash, burn_block_hash, parent_index_block_hash
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
    // The two operations below never flip the same block: the orphaned suffix covers heights >=
    // this block's height, while the restored chain covers heights <= the parent's height.
    if (block.block_height <= chainTip.block_height) {
      // The new block re-orgs the chain onto a fork that doesn't extend past the current chain
      // tip. Orphan all canonical blocks at or above the new block's height.
      await this.orphanCanonicalBlocksAboveHeight(sql, block.block_height - 1, updatedEntities);
    }
    if (!parentResult[0].canonical) {
      // The new block builds off a previously orphaned chain. Restore canonical status for this
      // chain, orphaning any conflicting blocks along the way.
      await this.restoreOrphanedChain(sql, parentResult[0].index_block_hash, updatedEntities);
    }
    await this.updateChainTipTxCountsAfterReorg(sql, updatedEntities);
    logger.info(
      updatedEntities,
      `Re-org resolved. Nakamoto block ${block.block_height} ${block.index_block_hash} is the new canonical chain tip.`
    );
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
          burn_block_hash: string;
          parent_index_block_hash: string;
        }[]
      >`
        SELECT canonical, index_block_hash, burn_block_hash, parent_index_block_hash
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
      await this.updateChainTipTxCountsAfterReorg(sql, updatedEntities);
    }
    return updatedEntities;
  }

  /**
   * Reflect updated transaction totals in the `chain_tip` table after a re-org has marked entities
   * canonical/non-canonical.
   */
  private async updateChainTipTxCountsAfterReorg(
    sql: PgSqlClient,
    updatedEntities: ReOrgUpdatedEntities
  ): Promise<void> {
    const txCountDelta =
      updatedEntities.markedCanonical.txs - updatedEntities.markedNonCanonical.txs;
    await sql`
      UPDATE chain_tip SET
        tx_count = tx_count + ${txCountDelta},
        tx_count_unanchored = tx_count_unanchored + ${txCountDelta},
        bond_count = (
          SELECT COUNT(*)::int
          FROM bonds
          WHERE canonical = true
            AND microblock_canonical = true
        )
    `;
  }

  async close(args?: { timeout?: number }): Promise<void> {
    if (this._debounceMempoolStat.debounce) {
      clearTimeout(this._debounceMempoolStat.debounce);
    }
    await this.redisNotifier?.close();
    await super.close(args);
  }
}
