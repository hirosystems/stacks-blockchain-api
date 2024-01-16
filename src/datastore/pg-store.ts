import {
  AddressTokenOfferingLocked,
  AddressUnlockSchedule,
  TransactionType,
} from '@stacks/stacks-blockchain-api-types';
import { ClarityAbi } from '@stacks/transactions';
import { getTxTypeId, getTxTypeString } from '../api/controllers/db-controller';
import {
  assertNotNullish,
  FoundOrNot,
  unwrapOptional,
  bnsHexValueToName,
  bnsNameCV,
  getBnsSmartContractId,
  bnsNameFromSubdomain,
  ChainID,
  REPO_DIR,
} from '../helpers';
import { PgStoreEventEmitter } from './pg-store-event-emitter';
import {
  BlockIdentifier,
  BlockQueryResult,
  BlocksWithMetadata,
  ContractTxQueryResult,
  DbAssetEventTypeId,
  DbBlock,
  DbBnsName,
  DbBnsNamespace,
  DbBnsSubdomain,
  DbBnsZoneFile,
  DbBurnchainReward,
  DbChainTip,
  DbEvent,
  DbEventTypeId,
  DbFtBalance,
  DbFtEvent,
  DbGetBlockWithMetadataOpts,
  DbGetBlockWithMetadataResponse,
  DbInboundStxTransfer,
  DbMempoolFeePriority,
  DbMempoolStats,
  DbMempoolTx,
  DbMicroblock,
  DbMinerReward,
  DbNftEvent,
  DbRewardSlotHolder,
  DbSearchResult,
  DbSmartContract,
  DbSmartContractEvent,
  DbStxBalance,
  DbStxEvent,
  DbStxLockEvent,
  DbTokenOfferingLocked,
  DbTx,
  DbTxGlobalStatus,
  DbTxStatus,
  DbTxTypeId,
  DbTxWithAssetTransfers,
  FaucetRequestQueryResult,
  MempoolTxQueryResult,
  MicroblockQueryResult,
  NftEventWithTxMetadata,
  NftHoldingInfo,
  NftHoldingInfoWithTxMetadata,
  PoxSyntheticEventQueryResult,
  RawTxQueryResult,
  StxUnlockEvent,
  TransferQueryResult,
  PoxSyntheticEventTable,
  DbPoxStacker,
  DbPoxSyntheticEvent,
} from './common';
import {
  abiColumn,
  BLOCK_COLUMNS,
  MEMPOOL_TX_COLUMNS,
  MICROBLOCK_COLUMNS,
  parseBlockQueryResult,
  parseDbEvents,
  parseDbPoxSyntheticEvent,
  parseFaucetRequestQueryResult,
  parseMempoolTxQueryResult,
  parseMicroblockQueryResult,
  parseQueryResultToSmartContract,
  parseTxQueryResult,
  parseTxsWithAssetTransfers,
  POX_SYNTHETIC_EVENT_COLUMNS,
  prefixedCols,
  TX_COLUMNS,
  unsafeCols,
  validateZonefileHash,
} from './helpers';
import { PgNotifier } from './pg-notifier';
import { SyntheticPoxEventName } from '../pox-helpers';
import { BasePgStore, PgSqlClient, connectPostgres } from '@hirosystems/api-toolkit';
import {
  PgServer,
  getConnectionArgs,
  getConnectionConfig,
  getPgConnectionEnvValue,
} from './connection';
import * as path from 'path';
import { PgStoreV2 } from './pg-store-v2';
import { MempoolOrderByParam, OrderParam } from '../api/query-helpers';

export const MIGRATIONS_DIR = path.join(REPO_DIR, 'migrations');

/**
 * This is the main interface between the API and the Postgres database. It contains all methods that
 * query the DB in search for blockchain data to be returned via endpoints or WebSockets/Socket.IO.
 * It also provides an `EventEmitter` to notify the rest of the API whenever an important DB write has
 * happened in the `PgServer.primary` server (see `.env`).
 */
export class PgStore extends BasePgStore {
  readonly v2: PgStoreV2;
  readonly eventEmitter: PgStoreEventEmitter;
  readonly notifier?: PgNotifier;

  constructor(sql: PgSqlClient, notifier: PgNotifier | undefined = undefined) {
    super(sql);
    this.notifier = notifier;
    this.eventEmitter = new PgStoreEventEmitter();
    this.v2 = new PgStoreV2(this);
  }

  static async connect({
    usageName,
    withNotifier = true,
  }: {
    usageName: string;
    withNotifier?: boolean;
  }): Promise<PgStore> {
    const sql = await connectPostgres({
      usageName: usageName,
      connectionArgs: getConnectionArgs(),
      connectionConfig: getConnectionConfig(),
    });
    const notifier = withNotifier ? await PgNotifier.create(usageName) : undefined;
    const store = new PgStore(sql, notifier);
    await store.connectPgNotifier();
    return store;
  }

  async close(): Promise<void> {
    await this.notifier?.close();
    await super.close({
      timeout: parseInt(getPgConnectionEnvValue('CLOSE_TIMEOUT', PgServer.default) ?? '5'),
    });
  }

  /**
   * Connects to the `PgNotifier`. Its messages will be forwarded to the rest of the API components
   * though the EventEmitter.
   */
  async connectPgNotifier() {
    await this.notifier?.connect(notification => {
      switch (notification.type) {
        case 'blockUpdate':
          this.eventEmitter.emit('blockUpdate', notification.payload.blockHash);
          break;
        case 'microblockUpdate':
          this.eventEmitter.emit('microblockUpdate', notification.payload.microblockHash);
          break;
        case 'txUpdate':
          this.eventEmitter.emit('txUpdate', notification.payload.txId);
          break;
        case 'addressUpdate':
          this.eventEmitter.emit(
            'addressUpdate',
            notification.payload.address,
            notification.payload.blockHeight
          );
          break;
        case 'tokensUpdate':
          this.eventEmitter.emit('tokensUpdate', notification.payload.contractID);
          break;
        case 'nameUpdate':
          this.eventEmitter.emit('nameUpdate', notification.payload.nameInfo);
          break;
        case 'tokenMetadataUpdateQueued':
          this.eventEmitter.emit('tokenMetadataUpdateQueued', notification.payload.queueId);
          break;
        case 'nftEventUpdate':
          this.eventEmitter.emit(
            'nftEventUpdate',
            notification.payload.txId,
            notification.payload.eventIndex
          );
          break;
        case 'smartContractUpdate':
          this.eventEmitter.emit('smartContractUpdate', notification.payload.contractId);
          break;
        case 'smartContractLogUpdate':
          this.eventEmitter.emit(
            'smartContractLogUpdate',
            notification.payload.txId,
            notification.payload.eventIndex
          );
          break;
        case 'configStateUpdate':
          this.eventEmitter.emit('configStateUpdate', notification.payload);
          break;
      }
    });
  }

  async getChainTip(): Promise<DbChainTip> {
    const tipResult = await this.sql<DbChainTip[]>`SELECT * FROM chain_tip`;
    const tip = tipResult[0];
    return {
      block_height: tip?.block_height ?? 0,
      block_count: tip?.block_count ?? 0,
      block_hash: tip?.block_hash ?? '',
      index_block_hash: tip?.index_block_hash ?? '',
      burn_block_height: tip?.burn_block_height ?? 0,
      microblock_hash: tip?.microblock_hash ?? undefined,
      microblock_sequence: tip?.microblock_sequence ?? undefined,
      microblock_count: tip?.microblock_count ?? 0,
      tx_count: tip?.tx_count ?? 0,
      tx_count_unanchored: tip?.tx_count_unanchored ?? 0,
      mempool_tx_count: tip?.mempool_tx_count ?? 0,
    };
  }

  async getBlockWithMetadata<TWithTxs extends boolean, TWithMicroblocks extends boolean>(
    blockIdentifier: BlockIdentifier,
    metadata?: DbGetBlockWithMetadataOpts<TWithTxs, TWithMicroblocks>
  ): Promise<FoundOrNot<DbGetBlockWithMetadataResponse<TWithTxs, TWithMicroblocks>>> {
    return await this.sqlTransaction(async sql => {
      const block = await this.getBlockInternal(sql, blockIdentifier);
      if (!block.found) {
        return { found: false };
      }
      let txs: DbTx[] | null = null;
      const microblocksAccepted: DbMicroblock[] = [];
      const microblocksStreamed: DbMicroblock[] = [];
      const microblock_tx_count: Record<string, number> = {};
      if (metadata?.txs) {
        const txQuery = await sql<ContractTxQueryResult[]>`
          SELECT ${unsafeCols(sql, [...TX_COLUMNS, abiColumn()])}
          FROM txs
          WHERE index_block_hash = ${block.result.index_block_hash}
            AND canonical = true AND microblock_canonical = true
          ORDER BY microblock_sequence DESC, tx_index DESC
        `;
        txs = txQuery.map(r => parseTxQueryResult(r));
      }
      if (metadata?.microblocks) {
        const microblocksQuery = await sql<
          (MicroblockQueryResult & { transaction_count: number })[]
        >`
          SELECT ${sql(MICROBLOCK_COLUMNS)}, (
            SELECT COUNT(tx_id)::integer as transaction_count
            FROM txs
            WHERE txs.microblock_hash = microblocks.microblock_hash
            AND canonical = true AND microblock_canonical = true
          )
          FROM microblocks
          WHERE parent_index_block_hash
            IN ${sql([block.result.index_block_hash, block.result.parent_index_block_hash])}
          AND microblock_canonical = true
          ORDER BY microblock_sequence ASC
        `;
        for (const mb of microblocksQuery) {
          const parsedMicroblock = parseMicroblockQueryResult(mb);
          const count = mb.transaction_count;
          if (parsedMicroblock.parent_index_block_hash === block.result.parent_index_block_hash) {
            microblocksAccepted.push(parsedMicroblock);
            microblock_tx_count[parsedMicroblock.microblock_hash] = count;
          }
          if (parsedMicroblock.parent_index_block_hash === block.result.index_block_hash) {
            microblocksStreamed.push(parsedMicroblock);
          }
        }
      }
      type ResultType = DbGetBlockWithMetadataResponse<TWithTxs, TWithMicroblocks>;
      const result: ResultType = {
        block: block.result,
        txs: txs as ResultType['txs'],
        microblocks: {
          accepted: microblocksAccepted,
          streamed: microblocksStreamed,
        } as ResultType['microblocks'],
        microblock_tx_count,
      };
      return {
        found: true,
        result: result,
      };
    });
  }

  async getPoxForcedUnlockHeightsInternal(sql: PgSqlClient): Promise<
    FoundOrNot<{
      pox1UnlockHeight: number | null;
      pox2UnlockHeight: number | null;
      pox3UnlockHeight: number | null;
    }>
  > {
    const query = await sql<
      { pox_v1_unlock_height: string; pox_v2_unlock_height: string; pox_v3_unlock_height: string }[]
    >`
      SELECT pox_v1_unlock_height, pox_v2_unlock_height, pox_v3_unlock_height
      FROM pox_state
      LIMIt 1
    `;
    if (query.length === 0) {
      return { found: false };
    }
    const pox1UnlockHeight = parseInt(query[0].pox_v1_unlock_height) || null;
    const pox2UnlockHeight = parseInt(query[0].pox_v2_unlock_height) || null;
    const pox3UnlockHeight = parseInt(query[0].pox_v3_unlock_height) || null;
    if (pox2UnlockHeight === 0) {
      return { found: false };
    }
    return { found: true, result: { pox1UnlockHeight, pox2UnlockHeight, pox3UnlockHeight } };
  }

  async getPoxForceUnlockHeights() {
    return this.getPoxForcedUnlockHeightsInternal(this.sql);
  }

  async getBlock(blockIdentifer: BlockIdentifier): Promise<FoundOrNot<DbBlock>> {
    return this.getBlockInternal(this.sql, blockIdentifer);
  }

  async getBlockInternal(
    sql: PgSqlClient,
    blockIdentifer: BlockIdentifier
  ): Promise<FoundOrNot<DbBlock>> {
    const result = await sql<BlockQueryResult[]>`
      SELECT ${sql(BLOCK_COLUMNS)}
      FROM blocks
      WHERE ${
        'hash' in blockIdentifer
          ? sql`block_hash = ${blockIdentifer.hash}`
          : 'height' in blockIdentifer
          ? sql`block_height = ${blockIdentifer.height}`
          : 'burnBlockHash' in blockIdentifer
          ? sql`burn_block_hash = ${blockIdentifer.burnBlockHash}`
          : sql`burn_block_height = ${blockIdentifer.burnBlockHeight}`
      }
      ORDER BY canonical DESC, block_height DESC
      LIMIT 1
    `;
    if (result.length === 0) {
      return { found: false } as const;
    }
    const row = result[0];
    const block = parseBlockQueryResult(row);
    return { found: true, result: block } as const;
  }

  async getBlockByHeightInternal(
    sql: PgSqlClient,
    blockHeight: number
  ): Promise<FoundOrNot<DbBlock>> {
    const result = await sql<BlockQueryResult[]>`
      SELECT ${sql(BLOCK_COLUMNS)}
      FROM blocks
      WHERE block_height = ${blockHeight} AND canonical = true
    `;
    if (result.length === 0) {
      return { found: false } as const;
    }
    const row = result[0];
    const block = parseBlockQueryResult(row);
    return { found: true, result: block } as const;
  }

  async getCurrentBlock(): Promise<FoundOrNot<DbBlock>> {
    return this.getCurrentBlockInternal(this.sql);
  }

  async getCurrentBlockHeight(): Promise<FoundOrNot<number>> {
    const result = await this.sql<{ block_height: number }[]>`SELECT block_height FROM chain_tip`;
    if (result.length === 0) {
      return { found: false } as const;
    }
    const row = result[0];
    return { found: true, result: row.block_height } as const;
  }

  async getCurrentBlockInternal(sql: PgSqlClient): Promise<FoundOrNot<DbBlock>> {
    const result = await sql<BlockQueryResult[]>`
      SELECT ${sql(BLOCK_COLUMNS.map(c => `b.${c}`))}
      FROM blocks b
      INNER JOIN chain_tip t USING (index_block_hash, block_hash, block_height, burn_block_height)
      LIMIT 1
    `;
    if (result.length === 0) {
      return { found: false } as const;
    }
    const row = result[0];
    const block = parseBlockQueryResult(row);
    return { found: true, result: block } as const;
  }

  /**
   * Returns Block information with metadata, including accepted and streamed microblocks hash
   * @returns `BlocksWithMetadata` object including list of Blocks with metadata and total count.
   * @deprecated use `getV2Blocks`
   */
  async getBlocksWithMetadata({
    limit,
    offset,
  }: {
    limit: number;
    offset: number;
  }): Promise<BlocksWithMetadata> {
    return await this.sqlTransaction(async sql => {
      // Get blocks with count.
      const countQuery = await sql<{ count: number }[]>`
        SELECT block_count AS count FROM chain_tip
      `;
      const block_count = countQuery[0].count;
      const blocksQuery = await sql<BlockQueryResult[]>`
        SELECT ${sql(BLOCK_COLUMNS)}
        FROM blocks
        WHERE canonical = true
        ORDER BY block_height DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `;
      const blocks = blocksQuery.map(r => parseBlockQueryResult(r));
      const blockHashValues: string[] = [];
      const indexBlockHashValues: string[] = [];
      blocks.forEach(block => {
        const indexBytea = block.index_block_hash;
        const parentBytea = block.parent_index_block_hash;
        indexBlockHashValues.push(indexBytea, parentBytea);
        blockHashValues.push(indexBytea);
      });
      if (blockHashValues.length === 0) {
        return {
          results: [],
          total: block_count,
        };
      }

      // get txs in those blocks
      const txs = await sql<{ tx_id: string; index_block_hash: string }[]>`
        SELECT tx_id, index_block_hash
        FROM txs
        WHERE index_block_hash IN ${sql(blockHashValues)}
          AND canonical = true AND microblock_canonical = true
        ORDER BY microblock_sequence DESC, tx_index DESC
      `;

      // get microblocks in those blocks
      const microblocksQuery = await sql<
        {
          parent_index_block_hash: string;
          index_block_hash: string;
          microblock_hash: string;
          transaction_count: number;
        }[]
      >`
          SELECT parent_index_block_hash, index_block_hash, microblock_hash, (
            SELECT COUNT(tx_id)::integer as transaction_count
            FROM txs
            WHERE txs.microblock_hash = microblocks.microblock_hash
            AND canonical = true AND microblock_canonical = true
          )
          FROM microblocks
          WHERE parent_index_block_hash IN ${sql(indexBlockHashValues)}
          AND microblock_canonical = true
          ORDER BY microblock_sequence DESC
        `;
      // parse data to return
      const blocksMetadata = blocks.map(block => {
        const transactions = txs
          .filter(tx => tx.index_block_hash === block.index_block_hash)
          .map(tx => tx.tx_id);
        const microblocksAccepted = microblocksQuery
          .filter(
            microblock => block.parent_index_block_hash === microblock.parent_index_block_hash
          )
          .map(mb => {
            return {
              microblock_hash: mb.microblock_hash,
              transaction_count: mb.transaction_count,
            };
          });
        const microblocksStreamed = microblocksQuery
          .filter(microblock => block.parent_index_block_hash === microblock.index_block_hash)
          .map(mb => mb.microblock_hash);
        const microblock_tx_count: Record<string, number> = {};
        microblocksAccepted.forEach(mb => {
          microblock_tx_count[mb.microblock_hash] = mb.transaction_count;
        });
        return {
          block,
          txs: transactions,
          microblocks_accepted: microblocksAccepted.map(mb => mb.microblock_hash),
          microblocks_streamed: microblocksStreamed,
          microblock_tx_count,
        };
      });
      const results: BlocksWithMetadata = {
        results: blocksMetadata,
        total: block_count,
      };
      return results;
    });
  }

  /**
   * @deprecated Only used in tests
   */
  async getBlockTxs(indexBlockHash: string) {
    const result = await this.sql<{ tx_id: string; tx_index: number }[]>`
      SELECT tx_id, tx_index
      FROM txs
      WHERE index_block_hash = ${indexBlockHash} AND canonical = true AND microblock_canonical = true
    `;
    const txIds = result.sort(tx => tx.tx_index).map(tx => tx.tx_id);
    return { results: txIds };
  }

  async getBlockTxsRows(blockHash: string): Promise<FoundOrNot<DbTx[]>> {
    return await this.sqlTransaction(async sql => {
      const blockQuery = await this.getBlockInternal(sql, { hash: blockHash });
      if (!blockQuery.found) {
        throw new Error(`Could not find block by hash ${blockHash}`);
      }
      const result = await sql<ContractTxQueryResult[]>`
        SELECT ${unsafeCols(sql, [...TX_COLUMNS, abiColumn()])}
        FROM txs
        WHERE index_block_hash = ${blockQuery.result.index_block_hash}
          AND canonical = true AND microblock_canonical = true
        ORDER BY microblock_sequence ASC, tx_index ASC
      `;
      if (result.length === 0) {
        return { found: false } as const;
      }
      const parsed = result.map(r => parseTxQueryResult(r));
      return { found: true, result: parsed };
    });
  }

  async getMicroblock(args: {
    microblockHash: string;
  }): Promise<FoundOrNot<{ microblock: DbMicroblock; txs: string[] }>> {
    return await this.sqlTransaction(async sql => {
      const result = await sql<MicroblockQueryResult[]>`
        SELECT ${sql(MICROBLOCK_COLUMNS)}
        FROM microblocks
        WHERE microblock_hash = ${args.microblockHash}
        ORDER BY canonical DESC, microblock_canonical DESC
        LIMIT 1
      `;
      if (result.length === 0) {
        return { found: false } as const;
      }
      const txQuery = await sql<{ tx_id: string }[]>`
        SELECT tx_id
        FROM txs
        WHERE microblock_hash = ${args.microblockHash} AND canonical = true AND microblock_canonical = true
        ORDER BY tx_index DESC
      `;
      const microblock = parseMicroblockQueryResult(result[0]);
      const txs = txQuery.map(row => row.tx_id);
      return { found: true, result: { microblock, txs } };
    });
  }

  async getMicroblocks(args: {
    limit: number;
    offset: number;
  }): Promise<{ result: { microblock: DbMicroblock; txs: string[] }[]; total: number }> {
    return await this.sqlTransaction(async sql => {
      const countQuery = await sql<
        { total: number }[]
      >`SELECT microblock_count AS total FROM chain_tip`;
      const microblockQuery = await sql<
        (MicroblockQueryResult & { tx_id?: string | null; tx_index?: number | null })[]
      >`
      SELECT microblocks.*, txs.tx_id
      FROM microblocks LEFT JOIN txs USING(microblock_hash)
      WHERE microblocks.canonical = true AND microblocks.microblock_canonical = true AND
        txs.canonical = true AND txs.microblock_canonical = true
      ORDER BY microblocks.block_height DESC, microblocks.microblock_sequence DESC, txs.tx_index DESC
      LIMIT ${args.limit}
      OFFSET ${args.offset};
      `;
      const microblocks: { microblock: DbMicroblock; txs: string[] }[] = [];
      microblockQuery.forEach(row => {
        const mb = parseMicroblockQueryResult(row);
        let existing = microblocks.find(
          item => item.microblock.microblock_hash === mb.microblock_hash
        );
        if (!existing) {
          existing = { microblock: mb, txs: [] };
          microblocks.push(existing);
        }
        if (row.tx_id) {
          existing.txs.push(row.tx_id);
        }
      });
      return {
        result: microblocks,
        total: countQuery[0].total,
      };
    });
  }

  async getUnanchoredTxsInternal(sql: PgSqlClient): Promise<{ txs: DbTx[] }> {
    // Get transactions that have been streamed in microblocks but not yet accepted or rejected in an anchor block.
    const { block_height } = await this.getChainTip();
    const unanchoredBlockHeight = block_height + 1;
    const query = await sql<ContractTxQueryResult[]>`
      SELECT ${unsafeCols(sql, [...TX_COLUMNS, abiColumn()])}
      FROM txs
      WHERE canonical = true AND microblock_canonical = true AND block_height = ${unanchoredBlockHeight}
      ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC
    `;
    const txs = query.map(row => parseTxQueryResult(row));
    return { txs: txs };
  }

  async getUnanchoredTxs(): Promise<{ txs: DbTx[] }> {
    return await this.sqlTransaction(async sql => {
      return this.getUnanchoredTxsInternal(sql);
    });
  }

  async getAddressNonceAtBlock(args: {
    stxAddress: string;
    blockIdentifier: BlockIdentifier;
  }): Promise<FoundOrNot<{ lastExecutedTxNonce: number | null; possibleNextNonce: number }>> {
    return await this.sqlTransaction(async sql => {
      const dbBlock = await this.getBlockInternal(sql, args.blockIdentifier);
      if (!dbBlock.found) {
        return { found: false };
      }
      const nonceQuery = await sql<{ nonce: number | null }[]>`
        SELECT MAX(nonce) nonce
        FROM txs
        WHERE ((sender_address = ${args.stxAddress} AND sponsored = false) OR (sponsor_address = ${args.stxAddress} AND sponsored = true))
        AND canonical = true AND microblock_canonical = true
        AND block_height <= ${dbBlock.result.block_height}
      `;
      let lastExecutedTxNonce: number | null = null;
      let possibleNextNonce = 0;
      if (nonceQuery.length > 0 && typeof nonceQuery[0].nonce === 'number') {
        lastExecutedTxNonce = nonceQuery[0].nonce;
        possibleNextNonce = lastExecutedTxNonce + 1;
      } else {
        possibleNextNonce = 0;
      }
      return { found: true, result: { lastExecutedTxNonce, possibleNextNonce } };
    });
  }

  async getAddressNonces(args: { stxAddress: string }): Promise<{
    lastExecutedTxNonce: number | null;
    lastMempoolTxNonce: number | null;
    possibleNextNonce: number;
    detectedMissingNonces: number[];
    detectedMempoolNonces: number[];
  }> {
    return await this.sqlTransaction(async sql => {
      const executedTxNonce = await sql<{ nonce: number | null }[]>`
        SELECT MAX(nonce) nonce
        FROM txs
        WHERE sender_address = ${args.stxAddress}
        AND canonical = true AND microblock_canonical = true
      `;
      const executedTxSponsorNonce = await sql<{ nonce: number | null }[]>`
        SELECT MAX(sponsor_nonce) nonce
        FROM txs
        WHERE sponsor_address = ${args.stxAddress} AND sponsored = true
        AND canonical = true AND microblock_canonical = true
      `;
      const mempoolTxNonce = await sql<{ nonce: number | null }[]>`
        SELECT MAX(nonce) nonce
        FROM mempool_txs
        WHERE sender_address = ${args.stxAddress}
        AND pruned = false
      `;
      const mempoolTxSponsorNonce = await sql<{ nonce: number | null }[]>`
        SELECT MAX(sponsor_nonce) nonce
        FROM mempool_txs
        WHERE sponsor_address = ${args.stxAddress} AND sponsored= true
        AND pruned = false
      `;

      let lastExecutedTxNonce = executedTxNonce[0]?.nonce ?? null;
      const lastExecutedTxSponsorNonce = executedTxSponsorNonce[0]?.nonce ?? null;
      if (lastExecutedTxNonce != null || lastExecutedTxSponsorNonce != null) {
        lastExecutedTxNonce = Math.max(lastExecutedTxNonce ?? 0, lastExecutedTxSponsorNonce ?? 0);
      }

      let lastMempoolTxNonce = mempoolTxNonce[0]?.nonce ?? null;
      const lastMempoolTxSponsorNonce = mempoolTxSponsorNonce[0]?.nonce ?? null;

      if (lastMempoolTxNonce != null || lastMempoolTxSponsorNonce != null) {
        lastMempoolTxNonce = Math.max(lastMempoolTxNonce ?? 0, lastMempoolTxSponsorNonce ?? 0);
      }

      let possibleNextNonce = 0;
      if (lastExecutedTxNonce !== null || lastMempoolTxNonce !== null) {
        possibleNextNonce = Math.max(lastExecutedTxNonce ?? 0, lastMempoolTxNonce ?? 0) + 1;
      }
      const detectedMissingNonces: number[] = [];
      let detectedMempoolNonces: number[] = [];
      if (lastExecutedTxNonce !== null && lastMempoolTxNonce !== null) {
        // There's a greater than one difference in the last mempool tx nonce and last executed tx nonce.
        // Check if there are any expected intermediate nonces missing from from the mempool.
        if (lastMempoolTxNonce - lastExecutedTxNonce > 1) {
          const expectedNonces: number[] = [];
          for (let i = lastMempoolTxNonce - 1; i > lastExecutedTxNonce; i--) {
            expectedNonces.push(i);
          }
          const mempoolNonces = await sql<{ nonce: number }[]>`
            SELECT nonce
            FROM mempool_txs
            WHERE sender_address = ${args.stxAddress}
              AND nonce IN ${sql(expectedNonces)}
            AND pruned = false
            UNION
            SELECT sponsor_nonce as nonce
            FROM mempool_txs
            WHERE sponsor_address = ${args.stxAddress}
              AND sponsored = true
              AND sponsor_nonce IN ${sql(expectedNonces)}
            AND pruned = false
          `;
          detectedMempoolNonces = mempoolNonces.map(r => r.nonce);
          expectedNonces.forEach(nonce => {
            if (!detectedMempoolNonces.includes(nonce)) {
              detectedMissingNonces.push(nonce);
            }
          });
        }
      }
      return {
        lastExecutedTxNonce: lastExecutedTxNonce,
        lastMempoolTxNonce: lastMempoolTxNonce,
        possibleNextNonce: possibleNextNonce,
        detectedMissingNonces: detectedMissingNonces,
        detectedMempoolNonces: detectedMempoolNonces,
      };
    });
  }

  async getNameCanonical(txId: string, indexBlockHash: string): Promise<FoundOrNot<boolean>> {
    const queryResult = await this.sql<{ canonical: boolean }[]>`
      SELECT canonical FROM names
      WHERE tx_id = ${txId} AND index_block_hash = ${indexBlockHash}
    `;
    if (queryResult.length > 0) {
      return {
        found: true,
        result: queryResult[0].canonical,
      };
    }
    return { found: false } as const;
  }

  async getBurnchainRewardSlotHolders({
    burnchainAddress,
    limit,
    offset,
  }: {
    burnchainAddress?: string;
    limit: number;
    offset: number;
  }): Promise<{ total: number; slotHolders: DbRewardSlotHolder[] }> {
    const queryResults = await this.sql<
      {
        burn_block_hash: string;
        burn_block_height: number;
        address: string;
        slot_index: number;
        count: number;
      }[]
    >`
      SELECT
        burn_block_hash, burn_block_height, address, slot_index, (COUNT(*) OVER())::INTEGER AS count
      FROM reward_slot_holders
      WHERE canonical = true
        ${burnchainAddress ? this.sql`AND address = ${burnchainAddress}` : this.sql``}
      ORDER BY burn_block_height DESC, slot_index DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;
    const count = queryResults[0]?.count ?? 0;
    const slotHolders = queryResults.map(r => {
      const parsed: DbRewardSlotHolder = {
        canonical: true,
        burn_block_hash: r.burn_block_hash,
        burn_block_height: r.burn_block_height,
        address: r.address,
        slot_index: r.slot_index,
      };
      return parsed;
    });
    return {
      total: count,
      slotHolders,
    };
  }

  async getTxsFromBlock(
    blockIdentifer: BlockIdentifier,
    limit: number,
    offset: number
  ): Promise<FoundOrNot<{ results: DbTx[]; total: number }>> {
    return await this.sqlTransaction(async sql => {
      const blockQuery = await this.getBlockInternal(sql, blockIdentifer);
      if (!blockQuery.found) {
        return { found: false };
      }
      const totalQuery = await sql<{ count: number }[]>`
        SELECT COUNT(*)::integer
        FROM txs
        WHERE canonical = true AND microblock_canonical = true
          AND index_block_hash = ${blockQuery.result.index_block_hash}
      `;
      const result = await sql<ContractTxQueryResult[]>`
        SELECT ${unsafeCols(sql, [...TX_COLUMNS, abiColumn()])}
        FROM txs
        WHERE canonical = true AND microblock_canonical = true
          AND index_block_hash = ${blockQuery.result.index_block_hash}
        ORDER BY microblock_sequence DESC, tx_index DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `;
      const total = totalQuery.length > 0 ? totalQuery[0].count : 0;
      const parsed = result.map(r => parseTxQueryResult(r));
      return { found: true, result: { results: parsed, total } };
    });
  }

  async getBurnchainRewards({
    burnchainRecipient,
    limit,
    offset,
  }: {
    burnchainRecipient?: string;
    limit: number;
    offset: number;
  }): Promise<DbBurnchainReward[]> {
    const queryResults = await this.sql<
      {
        burn_block_hash: string;
        burn_block_height: number;
        burn_amount: string;
        reward_recipient: string;
        reward_amount: string;
        reward_index: number;
      }[]
    >`
      SELECT burn_block_hash, burn_block_height, burn_amount, reward_recipient, reward_amount, reward_index
      FROM burnchain_rewards
      WHERE canonical = true
        ${burnchainRecipient ? this.sql`AND reward_recipient = ${burnchainRecipient}` : this.sql``}
      ORDER BY burn_block_height DESC, reward_index DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;
    return queryResults.map(r => {
      const parsed: DbBurnchainReward = {
        canonical: true,
        burn_block_hash: r.burn_block_hash,
        burn_block_height: r.burn_block_height,
        burn_amount: BigInt(r.burn_amount),
        reward_recipient: r.reward_recipient,
        reward_amount: BigInt(r.reward_amount),
        reward_index: r.reward_index,
      };
      return parsed;
    });
  }

  async getMinersRewardsAtHeight({
    blockHeight,
  }: {
    blockHeight: number;
  }): Promise<DbMinerReward[]> {
    const queryResults = await this.sql<
      {
        block_hash: string;
        from_index_block_hash: string;
        index_block_hash: string;
        mature_block_height: number;
        recipient: string;
        miner_address: string | null;
        coinbase_amount: number;
        tx_fees_anchored: number;
        tx_fees_streamed_confirmed: number;
        tx_fees_streamed_produced: number;
      }[]
    >`
      SELECT id, mature_block_height, recipient, miner_address, block_hash, index_block_hash, from_index_block_hash,
        canonical, coinbase_amount, tx_fees_anchored, tx_fees_streamed_confirmed, tx_fees_streamed_produced
      FROM miner_rewards
      WHERE canonical = true AND mature_block_height = ${blockHeight}
      ORDER BY id DESC
    `;
    return queryResults.map(r => {
      const parsed: DbMinerReward = {
        block_hash: r.block_hash,
        from_index_block_hash: r.from_index_block_hash,
        index_block_hash: r.index_block_hash,
        canonical: true,
        mature_block_height: r.mature_block_height,
        recipient: r.recipient,
        // If `miner_address` is null then it means pre-Stacks2.1 data, and the `recipient` can be accurately used
        miner_address: r.miner_address ?? r.recipient,
        coinbase_amount: BigInt(r.coinbase_amount),
        tx_fees_anchored: BigInt(r.tx_fees_anchored),
        tx_fees_streamed_confirmed: BigInt(r.tx_fees_streamed_confirmed),
        tx_fees_streamed_produced: BigInt(r.tx_fees_streamed_produced),
      };
      return parsed;
    });
  }

  async getBurnchainRewardsTotal(
    burnchainRecipient: string
  ): Promise<{ reward_recipient: string; reward_amount: bigint }> {
    const queryResults = await this.sql<{ amount: string }[]>`
      SELECT sum(reward_amount) amount
      FROM burnchain_rewards
      WHERE canonical = true AND reward_recipient = ${burnchainRecipient}
    `;
    const resultAmount = BigInt(queryResults[0]?.amount ?? 0);
    return { reward_recipient: burnchainRecipient, reward_amount: resultAmount };
  }

  private async parseMempoolTransactions(
    result: MempoolTxQueryResult[],
    sql: PgSqlClient,
    includeUnanchored: boolean
  ) {
    if (result.length === 0) {
      return [];
    }
    const pruned = result.filter(memTx => memTx.pruned && !includeUnanchored);
    if (pruned.length !== 0) {
      const unanchoredBlockHeight = await this.getMaxBlockHeight(sql, {
        includeUnanchored: true,
      });
      const notPrunedTxIds = pruned.map(tx => tx.tx_id);
      const query = await sql<{ tx_id: string }[]>`
        SELECT tx_id
        FROM txs
        WHERE canonical = true AND microblock_canonical = true
        AND tx_id IN ${sql(notPrunedTxIds)}
        AND block_height = ${unanchoredBlockHeight}
      `;
      // The tx is marked as pruned because it's in an unanchored microblock
      query.forEach(tran => {
        const transaction = result.find(tx => tx.tx_id === tran.tx_id);
        if (transaction) {
          transaction.pruned = false;
          transaction.status = DbTxStatus.Pending;
        }
      });
    }
    return result.map(transaction => parseMempoolTxQueryResult(transaction));
  }

  async getMempoolTxs(args: {
    txIds: string[];
    includeUnanchored: boolean;
    includePruned?: boolean;
  }): Promise<DbMempoolTx[]> {
    if (args.txIds.length === 0) {
      return [];
    }
    return await this.sqlTransaction(async sql => {
      const result = await sql<MempoolTxQueryResult[]>`
        SELECT ${unsafeCols(sql, [...MEMPOOL_TX_COLUMNS, abiColumn('mempool_txs')])}
        FROM mempool_txs
        WHERE tx_id IN ${sql(args.txIds)}
      `;
      return await this.parseMempoolTransactions(result, sql, args.includeUnanchored);
    });
  }

  async getMempoolTx({
    txId,
    includePruned,
    includeUnanchored,
  }: {
    txId: string;
    includeUnanchored: boolean;
    includePruned?: boolean;
  }): Promise<FoundOrNot<DbMempoolTx>> {
    return await this.sqlTransaction(async sql => {
      const result = await sql<MempoolTxQueryResult[]>`
        SELECT ${unsafeCols(sql, [...MEMPOOL_TX_COLUMNS, abiColumn('mempool_txs')])}
        FROM mempool_txs
        WHERE tx_id = ${txId}
      `;
      // Treat the tx as "not pruned" if it's in an unconfirmed microblock and the caller is has not opted-in to unanchored data.
      if (result[0]?.pruned && !includeUnanchored) {
        const unanchoredBlockHeight = await this.getMaxBlockHeight(sql, {
          includeUnanchored: true,
        });
        const query = await sql<{ tx_id: string }[]>`
          SELECT tx_id
          FROM txs
          WHERE canonical = true AND microblock_canonical = true
          AND block_height = ${unanchoredBlockHeight}
          AND tx_id = ${txId}
          LIMIT 1
        `;
        // The tx is marked as pruned because it's in an unanchored microblock
        if (query.length > 0) {
          result[0].pruned = false;
          result[0].status = DbTxStatus.Pending;
        }
      }
      if (result.length === 0 || (!includePruned && result[0].pruned)) {
        return { found: false } as const;
      }
      if (result.length > 1) {
        throw new Error(`Multiple transactions found in mempool table for txid: ${txId}`);
      }
      const rows = await this.parseMempoolTransactions(result, sql, includeUnanchored);
      const tx = rows[0];
      return { found: true, result: tx };
    });
  }

  async getDroppedTxs({
    limit,
    offset,
  }: {
    limit: number;
    offset: number;
  }): Promise<{ results: DbMempoolTx[]; total: number }> {
    return await this.sqlTransaction(async sql => {
      const droppedStatuses = [
        DbTxStatus.DroppedReplaceByFee,
        DbTxStatus.DroppedReplaceAcrossFork,
        DbTxStatus.DroppedTooExpensive,
        DbTxStatus.DroppedStaleGarbageCollect,
        DbTxStatus.DroppedApiGarbageCollect,
        DbTxStatus.DroppedProblematic,
      ];
      const resultQuery = await sql<(MempoolTxQueryResult & { count: number })[]>`
        SELECT ${unsafeCols(sql, [
          ...prefixedCols(MEMPOOL_TX_COLUMNS, 'mempool'),
          abiColumn('mempool'),
          '(COUNT(*) OVER())::INTEGER AS count',
        ])}
        FROM (
          SELECT *
          FROM mempool_txs
          WHERE pruned = true AND status IN ${sql(droppedStatuses)}
        ) mempool
        LEFT JOIN (
          SELECT tx_id
          FROM txs
          WHERE canonical = true AND microblock_canonical = true
        ) mined
        ON mempool.tx_id = mined.tx_id
        WHERE mined.tx_id IS NULL
        ORDER BY receipt_time DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `;
      const count = resultQuery.length > 0 ? resultQuery[0].count : 0;
      const mempoolTxs = resultQuery.map(r => parseMempoolTxQueryResult(r));
      return { results: mempoolTxs, total: count };
    });
  }

  async getMempoolStats({ lastBlockCount }: { lastBlockCount?: number }): Promise<DbMempoolStats> {
    return await this.sqlTransaction(async sql => {
      return await this.getMempoolStatsInternal({ sql, lastBlockCount });
    });
  }

  async getMempoolStatsInternal({
    sql,
    lastBlockCount,
  }: {
    sql: PgSqlClient;
    lastBlockCount?: number;
  }): Promise<DbMempoolStats> {
    let blockHeightCondition = sql``;
    const chainTipHeight = await this.getMaxBlockHeight(sql, { includeUnanchored: true });
    if (lastBlockCount) {
      const maxBlockHeight = chainTipHeight - lastBlockCount;
      blockHeightCondition = sql` AND receipt_block_height >= ${maxBlockHeight} `;
    }

    // Treat `versioned-smart-contract` txs (type 6) as regular `smart-contract` txs (type 1)
    const combineSmartContractVersions = sql`CASE type_id WHEN 6 THEN 1 ELSE type_id END AS type_id`;

    const txTypes = [
      DbTxTypeId.TokenTransfer,
      DbTxTypeId.SmartContract,
      DbTxTypeId.ContractCall,
      DbTxTypeId.PoisonMicroblock,
    ];

    const txTypeCountsQuery = await sql<{ type_id: DbTxTypeId; count: number }[]>`
      WITH txs_grouped AS (
        SELECT ${combineSmartContractVersions}
        FROM mempool_txs
        WHERE pruned = false
        ${blockHeightCondition}
      )
      SELECT
        type_id,
        count(*)::integer count
      FROM txs_grouped
      GROUP BY type_id
    `;
    const txTypeCounts: Record<string, number> = {};
    for (const typeId of txTypes) {
      const count = txTypeCountsQuery.find(r => r.type_id === typeId)?.count ?? 0;
      txTypeCounts[getTxTypeString(typeId)] = count;
    }

    const txFeesQuery = await sql<
      { type_id: DbTxTypeId; p25: number; p50: number; p75: number; p95: number }[]
    >`
      WITH txs_grouped AS (
        SELECT
          ${combineSmartContractVersions},
          fee_rate
        FROM mempool_txs
        WHERE pruned = false
        ${blockHeightCondition}
      )
      SELECT
        type_id,
        percentile_cont(0.25) within group (order by fee_rate asc) as p25,
        percentile_cont(0.50) within group (order by fee_rate asc) as p50,
        percentile_cont(0.75) within group (order by fee_rate asc) as p75,
        percentile_cont(0.95) within group (order by fee_rate asc) as p95
      FROM txs_grouped
      GROUP BY type_id
    `;
    const txFees: Record<
      string,
      { p25: number | null; p50: number | null; p75: number | null; p95: number | null }
    > = {};
    for (const typeId of txTypes) {
      const percentiles = txFeesQuery.find(r => r.type_id === typeId);
      txFees[getTxTypeString(typeId)] = {
        p25: percentiles?.p25 ?? null,
        p50: percentiles?.p50 ?? null,
        p75: percentiles?.p75 ?? null,
        p95: percentiles?.p95 ?? null,
      };
    }

    const txAgesQuery = await sql<
      {
        type_id: DbTxTypeId;
        p25: number;
        p50: number;
        p75: number;
        p95: number;
      }[]
    >`
      WITH mempool_unpruned AS (
        SELECT
          ${combineSmartContractVersions},
          receipt_block_height
        FROM mempool_txs
        WHERE pruned = false
        ${blockHeightCondition}
      ),
      mempool_ages AS (
        SELECT
          type_id,
          ${chainTipHeight} - receipt_block_height as age
        FROM mempool_unpruned
      )
      SELECT
        type_id,
        percentile_cont(0.25) within group (order by age asc) as p25,
        percentile_cont(0.50) within group (order by age asc) as p50,
        percentile_cont(0.75) within group (order by age asc) as p75,
        percentile_cont(0.95) within group (order by age asc) as p95
      FROM mempool_ages
      GROUP BY type_id
    `;
    const txAges: Record<
      string,
      { p25: number | null; p50: number | null; p75: number | null; p95: number | null }
    > = {};
    for (const typeId of txTypes) {
      const percentiles = txAgesQuery.find(r => r.type_id === typeId);
      txAges[getTxTypeString(typeId)] = {
        p25: percentiles?.p25 ?? null,
        p50: percentiles?.p50 ?? null,
        p75: percentiles?.p75 ?? null,
        p95: percentiles?.p95 ?? null,
      };
    }

    const txSizesQuery = await sql<
      {
        type_id: DbTxTypeId;
        p25: number;
        p50: number;
        p75: number;
        p95: number;
      }[]
    >`
      WITH mempool_unpruned AS (
        SELECT
          ${combineSmartContractVersions},
          tx_size
        FROM mempool_txs
        WHERE pruned = false
        ${blockHeightCondition}
      )
      SELECT
        type_id,
        percentile_cont(0.25) within group (order by tx_size asc) as p25,
        percentile_cont(0.50) within group (order by tx_size asc) as p50,
        percentile_cont(0.75) within group (order by tx_size asc) as p75,
        percentile_cont(0.95) within group (order by tx_size asc) as p95
      FROM mempool_unpruned
      GROUP BY type_id
    `;
    const txSizes: Record<
      string,
      { p25: number | null; p50: number | null; p75: number | null; p95: number | null }
    > = {};
    for (const typeId of txTypes) {
      const percentiles = txSizesQuery.find(r => r.type_id === typeId);
      txSizes[getTxTypeString(typeId)] = {
        p25: percentiles?.p25 ?? null,
        p50: percentiles?.p50 ?? null,
        p75: percentiles?.p75 ?? null,
        p95: percentiles?.p95 ?? null,
      };
    }

    return {
      tx_type_counts: txTypeCounts,
      tx_simple_fee_averages: txFees,
      tx_ages: txAges,
      tx_byte_sizes: txSizes,
    };
  }

  async getMempoolFeePriority(): Promise<DbMempoolFeePriority[]> {
    const txFeesQuery = await this.sql<DbMempoolFeePriority[]>`
      WITH fees AS (
        (
          SELECT
          NULL AS type_id,
          ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY fee_rate ASC)) AS high_priority,
          ROUND(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY fee_rate ASC)) AS medium_priority,
          ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY fee_rate ASC)) AS low_priority,
          ROUND(PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY fee_rate ASC)) AS no_priority
          FROM mempool_txs
          WHERE pruned = FALSE
        )
        UNION
        (
          WITH txs_grouped AS (
            SELECT
              (CASE type_id WHEN 6 THEN 1 ELSE type_id END) AS type_id,
              fee_rate
            FROM mempool_txs
            WHERE pruned = FALSE
            AND type_id NOT IN (4, 5)
          )
          SELECT
            type_id,
            ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY fee_rate ASC)) AS high_priority,
            ROUND(PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY fee_rate ASC)) AS medium_priority,
            ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY fee_rate ASC)) AS low_priority,
            ROUND(PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY fee_rate ASC)) AS no_priority
          FROM txs_grouped
          GROUP BY type_id
        )
      )
      SELECT * FROM fees ORDER BY type_id ASC NULLS FIRST
    `;
    return txFeesQuery;
  }

  async getMempoolTxList({
    limit,
    offset,
    includeUnanchored,
    orderBy,
    order,
    senderAddress,
    recipientAddress,
    address,
  }: {
    limit: number;
    offset: number;
    includeUnanchored: boolean;
    orderBy?: MempoolOrderByParam;
    order?: OrderParam;
    senderAddress?: string;
    recipientAddress?: string;
    address?: string;
  }): Promise<{ results: DbMempoolTx[]; total: number }> {
    const queryResult = await this.sqlTransaction(async sql => {
      // If caller did not opt-in to unanchored tx data, then treat unanchored txs as pending mempool txs.
      const unanchoredTxs: string[] = !includeUnanchored
        ? (await this.getUnanchoredTxsInternal(sql)).txs.map(tx => tx.tx_id)
        : [];
      // If caller is not filtering by any param, get the tx count from the `chain_tip` table.
      const count =
        senderAddress || recipientAddress || address
          ? sql`(COUNT(*) OVER())::int AS count`
          : sql`(SELECT mempool_tx_count FROM chain_tip) AS count`;
      const orderBySql =
        orderBy == 'fee' ? sql`fee_rate` : orderBy == 'size' ? sql`tx_size` : sql`receipt_time`;
      const orderSql = order == 'asc' ? sql`ASC` : sql`DESC`;
      const resultQuery = await sql<(MempoolTxQueryResult & { count: number })[]>`
        SELECT ${unsafeCols(sql, [...MEMPOOL_TX_COLUMNS, abiColumn('mempool_txs')])}, ${count}
        FROM mempool_txs
        WHERE ${
          address
            ? sql`(sender_address = ${address}
                OR token_transfer_recipient_address = ${address}
                OR smart_contract_contract_id = ${address}
                OR contract_call_contract_id = ${address})`
            : senderAddress && recipientAddress
            ? sql`(sender_address = ${senderAddress}
                AND token_transfer_recipient_address = ${recipientAddress})`
            : senderAddress
            ? sql`sender_address = ${senderAddress}`
            : recipientAddress
            ? sql`token_transfer_recipient_address = ${recipientAddress}`
            : sql`TRUE`
        }
          AND (pruned = false ${
            !includeUnanchored && unanchoredTxs.length
              ? sql`OR tx_id IN ${sql(unanchoredTxs)}`
              : sql``
          })
        ORDER BY ${orderBySql} ${orderSql}
        LIMIT ${limit}
        OFFSET ${offset}
      `;
      return { total: resultQuery[0]?.count ?? 0, rows: resultQuery };
    });

    const parsed = queryResult.rows.map(r => {
      // Ensure pruned and status are reset since the result can contain txs that were pruned from unanchored microblocks
      r.pruned = false;
      r.status = DbTxStatus.Pending;
      return parseMempoolTxQueryResult(r);
    });
    return { results: parsed, total: queryResult.total };
  }

  /**
   * Returns a string that represents a digest of all the current pending transactions
   * in the mempool. This digest can be used to calculate an `ETag` for mempool endpoint cache handlers.
   * @returns `FoundOrNot` object with a possible `digest` string.
   */
  async getMempoolTxDigest(): Promise<FoundOrNot<{ digest: string }>> {
    const result = await this.sql<{ digest: string }[]>`
      SELECT date_part('epoch', mempool_updated_at)::text AS digest FROM chain_tip
    `;
    if (result.length === 0) {
      return { found: false } as const;
    }
    return { found: true, result: { digest: result[0].digest } };
  }

  async getTx({
    txId,
    includeUnanchored,
  }: {
    txId: string;
    includeUnanchored: boolean;
  }): Promise<FoundOrNot<DbTx>> {
    return await this.sqlTransaction(async sql => {
      const maxBlockHeight = await this.getMaxBlockHeight(sql, { includeUnanchored });
      const result = await sql<ContractTxQueryResult[]>`
        SELECT ${unsafeCols(sql, [...TX_COLUMNS, abiColumn()])}
        FROM txs
        WHERE tx_id = ${txId} AND block_height <= ${maxBlockHeight}
        ORDER BY canonical DESC, microblock_canonical DESC, block_height DESC
        LIMIT 1
      `;
      if (result.length === 0) {
        return { found: false } as const;
      }
      const row = result[0];
      const tx = parseTxQueryResult(row);
      return { found: true, result: tx };
    });
  }

  async getMaxBlockHeight(
    sql: PgSqlClient,
    { includeUnanchored }: { includeUnanchored: boolean }
  ): Promise<number> {
    const chainTip = await this.getChainTip();
    if (includeUnanchored) {
      return chainTip.block_height + 1;
    } else {
      return chainTip.block_height;
    }
  }

  async getTxList({
    limit,
    offset,
    txTypeFilter,
    includeUnanchored,
  }: {
    limit: number;
    offset: number;
    txTypeFilter: TransactionType[];
    includeUnanchored: boolean;
  }): Promise<{ results: DbTx[]; total: number }> {
    let totalQuery: { count: number }[];
    let resultQuery: ContractTxQueryResult[];
    return await this.sqlTransaction(async sql => {
      const maxHeight = await this.getMaxBlockHeight(sql, { includeUnanchored });
      if (txTypeFilter.length === 0) {
        totalQuery = await sql<{ count: number }[]>`
          SELECT ${includeUnanchored ? sql('tx_count_unanchored') : sql('tx_count')} AS count
          FROM chain_tip
        `;
        resultQuery = await sql<ContractTxQueryResult[]>`
          SELECT ${unsafeCols(sql, [...TX_COLUMNS, abiColumn()])}
          FROM txs
          WHERE canonical = true AND microblock_canonical = true AND block_height <= ${maxHeight}
          ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC
          LIMIT ${limit}
          OFFSET ${offset}
        `;
      } else {
        const txTypeIds = txTypeFilter.flatMap<number>(t => getTxTypeId(t));
        totalQuery = await sql<{ count: number }[]>`
          SELECT COUNT(*)::integer
          FROM txs
          WHERE canonical = true AND microblock_canonical = true
            AND type_id IN ${sql(txTypeIds)} AND block_height <= ${maxHeight}
        `;
        resultQuery = await sql<ContractTxQueryResult[]>`
          SELECT ${unsafeCols(sql, [...TX_COLUMNS, abiColumn()])}
          FROM txs
          WHERE canonical = true AND microblock_canonical = true
            AND type_id IN ${sql(txTypeIds)} AND block_height <= ${maxHeight}
          ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC
          LIMIT ${limit}
          OFFSET ${offset}
        `;
      }
      const parsed = resultQuery.map(r => parseTxQueryResult(r));
      return { results: parsed, total: totalQuery[0].count };
    });
  }

  async getTxListEvents(args: {
    txs: {
      txId: string;
      indexBlockHash: string;
    }[];
    limit: number;
    offset: number;
  }): Promise<{ results: DbEvent[] }> {
    return await this.sqlTransaction(async sql => {
      if (args.txs.length === 0) return { results: [] };
      // TODO: This hack has to be done because postgres.js can't figure out how to interpolate
      // these `bytea` VALUES comparisons yet.
      const transactionValues = args.txs
        .map(tx => `('\\x${tx.txId.slice(2)}'::bytea, '\\x${tx.indexBlockHash.slice(2)}'::bytea)`)
        .join(', ');
      const eventIndexStart = args.offset;
      const eventIndexEnd = args.offset + args.limit - 1;
      const stxLockResults = await sql<
        {
          event_index: number;
          tx_id: string;
          tx_index: number;
          block_height: number;
          canonical: boolean;
          locked_amount: string;
          unlock_height: string;
          locked_address: string;
          contract_name: string;
        }[]
      >`
        SELECT
          event_index, tx_id, tx_index, block_height, canonical, locked_amount, unlock_height, locked_address, contract_name
        FROM stx_lock_events
        WHERE (tx_id, index_block_hash) IN (VALUES ${sql.unsafe(transactionValues)})
          AND microblock_canonical = true AND event_index BETWEEN ${eventIndexStart} AND ${eventIndexEnd}
      `;
      const stxResults = await sql<
        {
          event_index: number;
          tx_id: string;
          tx_index: number;
          block_height: number;
          canonical: boolean;
          asset_event_type_id: number;
          sender?: string;
          recipient?: string;
          amount: string;
          memo?: string;
        }[]
      >`
        SELECT
          event_index, tx_id, tx_index, block_height, canonical, asset_event_type_id, sender, recipient, amount, memo
        FROM stx_events
        WHERE (tx_id, index_block_hash) IN (VALUES ${sql.unsafe(transactionValues)})
          AND microblock_canonical = true AND event_index BETWEEN ${eventIndexStart} AND ${eventIndexEnd}
      `;
      const ftResults = await sql<
        {
          event_index: number;
          tx_id: string;
          tx_index: number;
          block_height: number;
          canonical: boolean;
          asset_event_type_id: number;
          sender?: string;
          recipient?: string;
          asset_identifier: string;
          amount: string;
        }[]
      >`
        SELECT
          event_index, tx_id, tx_index, block_height, canonical, asset_event_type_id, sender, recipient, asset_identifier, amount
        FROM ft_events
        WHERE (tx_id, index_block_hash) IN (VALUES ${sql.unsafe(transactionValues)})
          AND microblock_canonical = true AND event_index BETWEEN ${eventIndexStart} AND ${eventIndexEnd}
      `;
      const nftResults = await sql<
        {
          event_index: number;
          tx_id: string;
          tx_index: number;
          block_height: number;
          canonical: boolean;
          asset_event_type_id: number;
          sender?: string;
          recipient?: string;
          asset_identifier: string;
          value: string;
        }[]
      >`
        SELECT
          event_index, tx_id, tx_index, block_height, canonical, asset_event_type_id, sender, recipient, asset_identifier, value
        FROM nft_events
        WHERE (tx_id, index_block_hash) = ANY(VALUES ${sql.unsafe(transactionValues)})
          AND microblock_canonical = true AND event_index BETWEEN ${eventIndexStart} AND ${eventIndexEnd}
      `;
      const logResults = await sql<
        {
          event_index: number;
          tx_id: string;
          tx_index: number;
          block_height: number;
          canonical: boolean;
          contract_identifier: string;
          topic: string;
          value: string;
        }[]
      >`
        SELECT
          event_index, tx_id, tx_index, block_height, canonical, contract_identifier, topic, value
        FROM contract_logs
        WHERE (tx_id, index_block_hash) IN (VALUES ${sql.unsafe(transactionValues)})
          AND microblock_canonical = true AND event_index BETWEEN ${eventIndexStart} AND ${eventIndexEnd}
      `;
      return {
        results: parseDbEvents(stxLockResults, stxResults, ftResults, nftResults, logResults),
      };
    });
  }

  /**
   * TODO investigate if this method needs be deprecated in favor of {@link getTransactionEvents}
   */
  async getTxEvents(args: {
    txId: string;
    indexBlockHash: string;
    limit: number;
    offset: number;
  }): Promise<{ results: DbEvent[] }> {
    // Note: when this is used to fetch events for an unanchored microblock tx, the `indexBlockHash` is empty
    // which will cause the sql queries to also match micro-orphaned tx data (resulting in duplicate event results).
    // To prevent that, all micro-orphaned events are excluded using `microblock_orphaned=false`.
    // That means, unlike regular orphaned txs, if a micro-orphaned tx is never re-mined, the micro-orphaned event data
    // will never be returned.
    return await this.sqlTransaction(async sql => {
      const eventIndexStart = args.offset;
      const eventIndexEnd = args.offset + args.limit - 1;
      const stxLockResults = await sql<
        {
          event_index: number;
          tx_id: string;
          tx_index: number;
          block_height: number;
          canonical: boolean;
          locked_amount: string;
          unlock_height: string;
          locked_address: string;
          contract_name: string;
        }[]
      >`
        SELECT
          event_index, tx_id, tx_index, block_height, canonical, locked_amount, unlock_height, locked_address, contract_name
        FROM stx_lock_events
        WHERE tx_id = ${args.txId} AND index_block_hash = ${args.indexBlockHash}
          AND microblock_canonical = true AND event_index BETWEEN ${eventIndexStart} AND ${eventIndexEnd}
      `;
      const stxResults = await sql<
        {
          event_index: number;
          tx_id: string;
          tx_index: number;
          block_height: number;
          canonical: boolean;
          asset_event_type_id: number;
          sender?: string;
          recipient?: string;
          amount: string;
          memo?: string;
        }[]
      >`
        SELECT
          event_index, tx_id, tx_index, block_height, canonical, asset_event_type_id, sender, recipient, amount, memo
        FROM stx_events
        WHERE tx_id = ${args.txId} AND index_block_hash = ${args.indexBlockHash}
          AND microblock_canonical = true AND event_index BETWEEN ${eventIndexStart} AND ${eventIndexEnd}
        `;
      const ftResults = await sql<
        {
          event_index: number;
          tx_id: string;
          tx_index: number;
          block_height: number;
          canonical: boolean;
          asset_event_type_id: number;
          sender?: string;
          recipient?: string;
          asset_identifier: string;
          amount: string;
        }[]
      >`
        SELECT
          event_index, tx_id, tx_index, block_height, canonical, asset_event_type_id, sender, recipient, asset_identifier, amount
        FROM ft_events
        WHERE tx_id = ${args.txId} AND index_block_hash = ${args.indexBlockHash}
          AND microblock_canonical = true AND event_index BETWEEN ${eventIndexStart} AND ${eventIndexEnd}
      `;
      const nftResults = await sql<
        {
          event_index: number;
          tx_id: string;
          tx_index: number;
          block_height: number;
          canonical: boolean;
          asset_event_type_id: number;
          sender?: string;
          recipient?: string;
          asset_identifier: string;
          value: string;
        }[]
      >`
        SELECT
          event_index, tx_id, tx_index, block_height, canonical, asset_event_type_id, sender, recipient, asset_identifier, value
        FROM nft_events
        WHERE tx_id = ${args.txId} AND index_block_hash = ${args.indexBlockHash}
          AND microblock_canonical = true AND event_index BETWEEN ${eventIndexStart} AND ${eventIndexEnd}
      `;
      const logResults = await sql<
        {
          event_index: number;
          tx_id: string;
          tx_index: number;
          block_height: number;
          canonical: boolean;
          contract_identifier: string;
          topic: string;
          value: string;
        }[]
      >`
        SELECT
          event_index, tx_id, tx_index, block_height, canonical, contract_identifier, topic, value
        FROM contract_logs
        WHERE tx_id = ${args.txId} AND index_block_hash = ${args.indexBlockHash}
          AND microblock_canonical = true AND event_index BETWEEN ${eventIndexStart} AND ${eventIndexEnd}
      `;
      return {
        results: parseDbEvents(stxLockResults, stxResults, ftResults, nftResults, logResults),
      };
    });
  }

  /**
   * It retrieves filtered events from the db based on transaction, principal or event type. Note: It does not accept both principal and txId at the same time
   * @param args - addressOrTxId: filter for either transaction id or address
   * @param args - eventTypeFilter: filter based on event types ids
   * @param args - limit: returned that many rows
   * @param args - offset: skip that any rows
   * @returns returns array of events
   */
  async getTransactionEvents(args: {
    addressOrTxId: { address: string; txId: undefined } | { address: undefined; txId: string };
    eventTypeFilter: DbEventTypeId[];
    limit: number;
    offset: number;
  }): Promise<{ results: DbEvent[] }> {
    return await this.sqlTransaction(async sql => {
      const refValue = args.addressOrTxId.address ?? args.addressOrTxId.txId;
      const isAddress = args.addressOrTxId.address !== undefined;
      const emptyEvents = sql`SELECT NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL`;
      const eventsResult = await sql<
        {
          tx_id: string;
          event_index: number;
          tx_index: number;
          block_height: number;
          sender: string;
          recipient: string;
          amount: number;
          memo: string;
          unlock_height: number;
          asset_identifier: string;
          contract_identifier: string;
          topic: string;
          value: string;
          event_type_id: number;
          asset_event_type_id: number;
          contract_name: string;
        }[]
      >`
        WITH events AS (
          ${
            args.eventTypeFilter.includes(DbEventTypeId.StxLock)
              ? sql`
                SELECT
                  tx_id, event_index, tx_index, block_height, locked_address as sender, NULL as recipient,
                  locked_amount as amount, unlock_height, NULL as asset_identifier, NULL as contract_identifier,
                  '0'::bytea as value, NULL as topic, null::bytea as memo, contract_name,
                  ${DbEventTypeId.StxLock}::integer as event_type_id, 0 as asset_event_type_id
                FROM stx_lock_events
                WHERE ${isAddress ? sql`locked_address = ${refValue}` : sql`tx_id = ${refValue}`}
                AND canonical = true AND microblock_canonical = true
                `
              : emptyEvents
          }
          UNION
          ${
            args.eventTypeFilter.includes(DbEventTypeId.StxAsset)
              ? sql`
                SELECT
                  tx_id, event_index, tx_index, block_height, sender, recipient,
                  amount, 0 as unlock_height, NULL as asset_identifier, NULL as contract_identifier,
                  '0'::bytea as value, NULL as topic, memo, NULL as contract_name,
                  ${DbEventTypeId.StxAsset}::integer as event_type_id, asset_event_type_id
                FROM stx_events
                WHERE ${
                  isAddress
                    ? sql`(sender = ${refValue} OR recipient = ${refValue})`
                    : sql`tx_id = ${refValue}`
                }
                AND canonical = true AND microblock_canonical = true
                `
              : emptyEvents
          }
          UNION
          ${
            args.eventTypeFilter.includes(DbEventTypeId.FungibleTokenAsset)
              ? sql`
                SELECT
                  tx_id, event_index, tx_index, block_height, sender, recipient,
                  amount, 0 as unlock_height, asset_identifier, NULL as contract_identifier,
                  '0'::bytea as value, NULL as topic, null::bytea as memo, NULL as contract_name,
                  ${DbEventTypeId.FungibleTokenAsset}::integer as event_type_id, asset_event_type_id
                FROM ft_events
                WHERE ${
                  isAddress
                    ? sql`(sender = ${refValue} OR recipient = ${refValue})`
                    : sql`tx_id = ${refValue}`
                }
                AND canonical = true AND microblock_canonical = true
                `
              : emptyEvents
          }
          UNION
          ${
            args.eventTypeFilter.includes(DbEventTypeId.NonFungibleTokenAsset)
              ? sql`
                SELECT
                  tx_id, event_index, tx_index, block_height, sender, recipient,
                  0 as amount, 0 as unlock_height, asset_identifier, NULL as contract_identifier,
                  value, NULL as topic, null::bytea as memo, NULL as contract_name,
                  ${DbEventTypeId.NonFungibleTokenAsset}::integer as event_type_id,
                  asset_event_type_id
                FROM nft_events
                WHERE ${
                  isAddress
                    ? sql`(sender = ${refValue} OR recipient = ${refValue})`
                    : sql`tx_id = ${refValue}`
                }
                AND canonical = true AND microblock_canonical = true
                `
              : emptyEvents
          }
          UNION
          ${
            args.eventTypeFilter.includes(DbEventTypeId.SmartContractLog)
              ? sql`
                SELECT
                  tx_id, event_index, tx_index, block_height, NULL as sender, NULL as recipient,
                  0 as amount, 0 as unlock_height, NULL as asset_identifier, contract_identifier,
                  value, topic, null::bytea as memo, NULL as contract_name,
                  ${DbEventTypeId.SmartContractLog}::integer as event_type_id,
                  0 as asset_event_type_id
                FROM contract_logs
                WHERE ${
                  isAddress ? sql`contract_identifier = ${refValue}` : sql`tx_id = ${refValue}`
                }
                AND canonical = true AND microblock_canonical = true
                `
              : emptyEvents
          }
        )
        SELECT *
        FROM events JOIN txs USING(tx_id)
        WHERE txs.canonical = true AND txs.microblock_canonical = true
        ORDER BY events.block_height DESC, microblock_sequence DESC, events.tx_index DESC, event_index DESC
        LIMIT ${args.limit}
        OFFSET ${args.offset}
      `;
      let events: DbEvent[] = [];
      if (eventsResult.length > 0) {
        events = eventsResult.map(r => {
          const event: DbEvent = {
            tx_id: r.tx_id,
            event_index: r.event_index,
            event_type: r.event_type_id,
            tx_index: r.tx_index,
            block_height: r.block_height,
            sender: r.sender,
            recipient: r.recipient,
            amount: BigInt(r.amount),
            locked_amount: BigInt(r.amount),
            unlock_height: Number(r.unlock_height),
            locked_address: r.sender,
            asset_identifier: r.asset_identifier,
            contract_identifier: r.contract_identifier,
            topic: r.topic,
            value: r.value,
            canonical: true,
            asset_event_type_id: r.asset_event_type_id,
            contract_name: r.contract_name,
          };
          if (event.event_type === DbEventTypeId.StxAsset && r.memo) {
            event.memo = r.memo;
          }
          return event;
        });
      }
      return {
        results: events,
      };
    });
  }

  async getSmartContract(contractId: string) {
    const result = await this.sql<
      {
        tx_id: string;
        canonical: boolean;
        contract_id: string;
        block_height: number;
        clarity_version: number | null;
        source_code: string;
        abi: unknown | null;
      }[]
    >`
      SELECT tx_id, canonical, contract_id, block_height, clarity_version, source_code, abi
      FROM smart_contracts
      WHERE contract_id = ${contractId}
      ORDER BY abi != 'null' DESC, canonical DESC, microblock_canonical DESC, block_height DESC
      LIMIT 1
    `;
    if (result.length === 0) {
      return { found: false } as const;
    }
    const row = result[0];
    return parseQueryResultToSmartContract(row);
  }

  async getPoxSyntheticEvents({
    limit,
    offset,
    poxTable,
  }: {
    limit: number;
    offset: number;
    poxTable: PoxSyntheticEventTable;
  }): Promise<DbPoxSyntheticEvent[]> {
    return await this.sqlTransaction(async sql => {
      const queryResults = await sql<PoxSyntheticEventQueryResult[]>`
        SELECT ${sql(POX_SYNTHETIC_EVENT_COLUMNS)}
        FROM ${sql(poxTable)}
        WHERE canonical = true AND microblock_canonical = true
        ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `;
      const result = queryResults.map(result => parseDbPoxSyntheticEvent(result));
      return result;
    });
  }

  async getPoxSyntheticEventsForTx({
    txId,
    poxTable,
  }: {
    txId: string;
    poxTable: PoxSyntheticEventTable;
  }): Promise<FoundOrNot<DbPoxSyntheticEvent[]>> {
    return await this.sqlTransaction(async sql => {
      const dbTx = await this.getTx({ txId, includeUnanchored: true });
      if (!dbTx.found) {
        return { found: false };
      }
      const queryResults = await sql<PoxSyntheticEventQueryResult[]>`
        SELECT ${sql(POX_SYNTHETIC_EVENT_COLUMNS)}
        FROM ${sql(poxTable)}
        WHERE canonical = true AND microblock_canonical = true AND tx_id = ${txId}
        ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
      `;
      const result = queryResults.map(result => parseDbPoxSyntheticEvent(result));
      return { found: true, result: result };
    });
  }

  async getPoxSyntheticEventsForStacker({
    principal,
    poxTable,
  }: {
    principal: string;
    poxTable: PoxSyntheticEventTable;
  }): Promise<FoundOrNot<DbPoxSyntheticEvent[]>> {
    return await this.sqlTransaction(async sql => {
      const queryResults = await sql<PoxSyntheticEventQueryResult[]>`
        SELECT ${sql(POX_SYNTHETIC_EVENT_COLUMNS)}
        FROM ${sql(poxTable)}
        WHERE canonical = true AND microblock_canonical = true AND stacker = ${principal}
        ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
      `;
      const result = queryResults.map(result => parseDbPoxSyntheticEvent(result));
      return { found: true, result: result };
    });
  }

  async getPoxPoolDelegations(args: {
    delegator: string;
    blockHeight: number;
    burnBlockHeight: number;
    afterBlockHeight: number;
    limit: number;
    offset: number;
    poxTable: PoxSyntheticEventTable;
  }): Promise<FoundOrNot<{ stackers: DbPoxStacker[]; total: number }>> {
    return await this.sqlTransaction(async sql => {
      const queryResults = await sql<
        {
          stacker: string;
          pox_addr: string | null;
          amount_ustx: string;
          unlock_burn_height: number | null;
          tx_id: string;
          block_height: number;
          total_rows: number;
        }[]
      >`
        WITH ordered_pox_events AS (
          SELECT
            stacker, pox_addr, amount_ustx, unlock_burn_height::integer, tx_id,
            block_height, microblock_sequence, tx_index, event_index
          FROM ${sql(args.poxTable)}
          WHERE
            canonical = true AND microblock_canonical = true AND
            name = ${SyntheticPoxEventName.DelegateStx} AND delegate_to = ${args.delegator} AND
            block_height <= ${args.blockHeight} AND block_height > ${args.afterBlockHeight} AND
            (unlock_burn_height > ${args.burnBlockHeight} OR unlock_burn_height IS NULL)
          ORDER BY stacker, block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
        ),
        distinct_rows AS (
          SELECT DISTINCT ON (stacker)
            stacker, pox_addr, amount_ustx, unlock_burn_height, tx_id,
            block_height, microblock_sequence, tx_index, event_index
          FROM ordered_pox_events
          ORDER BY stacker, block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
        )
        SELECT
          stacker, pox_addr, amount_ustx, unlock_burn_height, block_height::integer, tx_id,
          COUNT(*) OVER()::integer AS total_rows
        FROM distinct_rows
        ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
        LIMIT ${args.limit}
        OFFSET ${args.offset}
      `;
      const total = queryResults[0]?.total_rows ?? 0;
      const stackers: DbPoxStacker[] = queryResults.map(result => ({
        stacker: result.stacker,
        pox_addr: result.pox_addr || undefined,
        amount_ustx: result.amount_ustx,
        burn_block_unlock_height: result.unlock_burn_height || undefined,
        block_height: result.block_height,
        tx_id: result.tx_id,
      }));
      return { found: true, result: { stackers, total } };
    });
  }

  async getSmartContractEvents({
    contractId,
    limit,
    offset,
  }: {
    contractId: string;
    limit: number;
    offset: number;
  }): Promise<FoundOrNot<DbSmartContractEvent[]>> {
    const logResults = await this.sql<
      {
        event_index: number;
        tx_id: string;
        tx_index: number;
        block_height: number;
        contract_identifier: string;
        topic: string;
        value: string;
      }[]
    >`
      SELECT
        event_index, tx_id, tx_index, block_height, contract_identifier, topic, value
      FROM contract_logs
      WHERE canonical = true AND microblock_canonical = true AND contract_identifier = ${contractId}
      ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;
    const result = logResults.map(result => {
      const event: DbSmartContractEvent = {
        event_index: result.event_index,
        tx_id: result.tx_id,
        tx_index: result.tx_index,
        block_height: result.block_height,
        canonical: true,
        event_type: DbEventTypeId.SmartContractLog,
        contract_identifier: result.contract_identifier,
        topic: result.topic,
        value: result.value,
      };
      return event;
    });
    return { found: true, result };
  }

  async getSmartContractByTrait(args: {
    trait: ClarityAbi;
    limit: number;
    offset: number;
  }): Promise<FoundOrNot<DbSmartContract[]>> {
    const traitFunctionList = args.trait.functions.map(traitFunction => {
      return {
        name: traitFunction.name,
        access: traitFunction.access,
        args: traitFunction.args.map(arg => {
          return {
            type: arg.type,
          };
        }),
        outputs: traitFunction.outputs,
      };
    });

    const result = await this.sql<
      {
        tx_id: string;
        canonical: boolean;
        contract_id: string;
        block_height: number;
        clarity_version: number | null;
        source_code: string;
        abi: unknown | null;
      }[]
    >`
      SELECT tx_id, canonical, contract_id, block_height, clarity_version, source_code, abi
      FROM smart_contracts
      WHERE abi->'functions' @> ${traitFunctionList as any}::jsonb
        AND canonical = true AND microblock_canonical = true
      ORDER BY block_height DESC
      LIMIT ${args.limit} OFFSET ${args.offset}
    `;
    if (result.length === 0) {
      return { found: false } as const;
    }
    const smartContracts = result.map(row => {
      return parseQueryResultToSmartContract(row).result;
    });
    return { found: true, result: smartContracts };
  }

  async getStxBalance({
    stxAddress,
    includeUnanchored,
  }: {
    stxAddress: string;
    includeUnanchored: boolean;
  }): Promise<DbStxBalance> {
    return await this.sqlTransaction(async sql => {
      const blockQuery = await this.getCurrentBlockInternal(sql);
      if (!blockQuery.found) {
        throw new Error(`Could not find current block`);
      }
      let blockHeight = blockQuery.result.block_height;
      if (includeUnanchored) {
        blockHeight++;
      }
      const result = await this.internalGetStxBalanceAtBlock(
        sql,
        stxAddress,
        blockHeight,
        blockQuery.result.burn_block_height
      );
      return result;
    });
  }

  async getStxBalanceAtBlock(stxAddress: string, blockHeight: number): Promise<DbStxBalance> {
    return await this.sqlTransaction(async sql => {
      const chainTip = await this.getChainTip();
      const blockHeightToQuery =
        blockHeight > chainTip.block_height ? chainTip.block_height : blockHeight;
      const blockQuery = await this.getBlockByHeightInternal(sql, blockHeightToQuery);
      if (!blockQuery.found) {
        throw new Error(`Could not find block at height: ${blockHeight}`);
      }
      const result = await this.internalGetStxBalanceAtBlock(
        sql,
        stxAddress,
        blockHeight,
        blockQuery.result.burn_block_height
      );
      return result;
    });
  }

  async internalGetStxBalanceAtBlock(
    sql: PgSqlClient,
    stxAddress: string,
    blockHeight: number,
    burnBlockHeight: number
  ): Promise<DbStxBalance> {
    const result = await sql<
      {
        credit_total: string | null;
        debit_total: string | null;
      }[]
    >`
      WITH credit AS (
        SELECT sum(amount) as credit_total
        FROM stx_events
        WHERE canonical = true AND microblock_canonical = true AND recipient = ${stxAddress} AND block_height <= ${blockHeight}
      ),
      debit AS (
        SELECT sum(amount) as debit_total
        FROM stx_events
        WHERE canonical = true AND microblock_canonical = true AND sender = ${stxAddress} AND block_height <= ${blockHeight}
      )
      SELECT credit_total, debit_total
      FROM credit CROSS JOIN debit
    `;
    const feeQuery = await sql<{ fee_sum: string }[]>`
      SELECT sum(fee_rate) as fee_sum
      FROM txs
      WHERE canonical = true AND microblock_canonical = true
        AND ((sender_address = ${stxAddress} AND sponsored = false) OR (sponsor_address = ${stxAddress} AND sponsored = true))
        AND block_height <= ${blockHeight}
    `;

    let lockTxId: string = '';
    let locked: bigint = 0n;
    let lockHeight = 0;
    let burnchainLockHeight = 0;
    let burnchainUnlockHeight = 0;

    let includePox1State = true;
    let includePox2State = true;
    let includePox3State = true;
    const poxForceUnlockHeights = await this.getPoxForcedUnlockHeightsInternal(sql);
    if (poxForceUnlockHeights.found) {
      if (
        poxForceUnlockHeights.result.pox1UnlockHeight &&
        burnBlockHeight > poxForceUnlockHeights.result.pox1UnlockHeight
      ) {
        includePox1State = false;
      }
      if (
        poxForceUnlockHeights.result.pox2UnlockHeight &&
        burnBlockHeight > poxForceUnlockHeights.result.pox2UnlockHeight
      ) {
        includePox2State = false;
      }
      if (
        poxForceUnlockHeights.result.pox3UnlockHeight &&
        burnBlockHeight > poxForceUnlockHeights.result.pox3UnlockHeight
      ) {
        includePox3State = false;
      }
    }

    // Once the pox_v1_unlock_height is reached, stop using `stx_lock_events` to determinel locked state,
    // because it includes pox-v1 entries. We only care about pox-v2, so only need to query `pox2_events`.
    if (includePox1State) {
      const lockQuery = await sql<
        {
          locked_amount: string;
          unlock_height: string;
          block_height: string;
          tx_id: string;
        }[]
      >`
        SELECT locked_amount, unlock_height, block_height, tx_id
        FROM stx_lock_events
        WHERE canonical = true AND microblock_canonical = true AND locked_address = ${stxAddress}
        AND block_height <= ${blockHeight} AND unlock_height >= ${burnBlockHeight}
        ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
        LIMIT 1
      `;
      if (lockQuery.length > 1) {
        throw new Error(
          `stx_lock_events event query for ${stxAddress} should return zero or one rows but returned ${lockQuery.length}`
        );
      } else if (lockQuery.length === 1) {
        lockTxId = lockQuery[0].tx_id;
        locked = BigInt(lockQuery[0].locked_amount);
        burnchainUnlockHeight = parseInt(lockQuery[0].unlock_height);
        lockHeight = parseInt(lockQuery[0].block_height);
        const blockQuery = await this.getBlockByHeightInternal(sql, lockHeight);
        burnchainLockHeight = blockQuery.found ? blockQuery.result.burn_block_height : 0;
      }
    }

    // Once the pox_v2_unlock_height is reached, stop using `pox2_events` to determinel locked state.
    if (includePox2State) {
      // Query for the latest lock event that still applies to the current burn block height.
      // Special case for `handle-unlock` which should be returned if it is the last received event.
      const pox2EventQuery = await sql<PoxSyntheticEventQueryResult[]>`
        SELECT ${sql(POX_SYNTHETIC_EVENT_COLUMNS)}
        FROM pox2_events
        WHERE canonical = true AND microblock_canonical = true AND stacker = ${stxAddress}
        AND block_height <= ${blockHeight}
        AND (
          (name != ${
            SyntheticPoxEventName.HandleUnlock
          } AND burnchain_unlock_height >= ${burnBlockHeight})
          OR
          (name = ${
            SyntheticPoxEventName.HandleUnlock
          } AND burnchain_unlock_height < ${burnBlockHeight})
        )
        ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
        LIMIT 1
      `;
      if (pox2EventQuery.length > 0) {
        const pox2Event = parseDbPoxSyntheticEvent(pox2EventQuery[0]);
        if (pox2Event.name === SyntheticPoxEventName.HandleUnlock) {
          // on a handle-unlock, set all of the locked stx related property to empty/default
          lockTxId = '';
          locked = 0n;
          burnchainUnlockHeight = 0;
          lockHeight = 0;
          burnchainLockHeight = 0;
        } else {
          lockTxId = pox2Event.tx_id;
          locked = pox2Event.locked;
          burnchainUnlockHeight = Number(pox2Event.burnchain_unlock_height);
          lockHeight = pox2Event.block_height;
          const blockQuery = await this.getBlockByHeightInternal(sql, lockHeight);
          burnchainLockHeight = blockQuery.found ? blockQuery.result.burn_block_height : 0;
        }
      }
    }

    // Once the pox_v3_unlock_height is reached, stop using `pox3_events` to determine locked state.
    if (includePox3State) {
      // Query for the latest lock event that still applies to the current burn block height.
      // Special case for `handle-unlock` which should be returned if it is the last received event.
      const pox3EventQuery = await sql<PoxSyntheticEventQueryResult[]>`
        SELECT ${sql(POX_SYNTHETIC_EVENT_COLUMNS)}
        FROM pox3_events
        WHERE canonical = true AND microblock_canonical = true AND stacker = ${stxAddress}
        AND block_height <= ${blockHeight}
        AND (
          (name != ${
            SyntheticPoxEventName.HandleUnlock
          } AND burnchain_unlock_height >= ${burnBlockHeight})
          OR
          (name = ${
            SyntheticPoxEventName.HandleUnlock
          } AND burnchain_unlock_height < ${burnBlockHeight})
        )
        ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
        LIMIT 1
      `;
      if (pox3EventQuery.length > 0) {
        const pox3Event = parseDbPoxSyntheticEvent(pox3EventQuery[0]);
        if (pox3Event.name === SyntheticPoxEventName.HandleUnlock) {
          // on a handle-unlock, set all of the locked stx related property to empty/default
          lockTxId = '';
          locked = 0n;
          burnchainUnlockHeight = 0;
          lockHeight = 0;
          burnchainLockHeight = 0;
        } else {
          lockTxId = pox3Event.tx_id;
          locked = pox3Event.locked;
          burnchainUnlockHeight = Number(pox3Event.burnchain_unlock_height);
          lockHeight = pox3Event.block_height;
          const blockQuery = await this.getBlockByHeightInternal(sql, lockHeight);
          burnchainLockHeight = blockQuery.found ? blockQuery.result.burn_block_height : 0;
        }
      }
    }

    // == PoX-4 ================================================================
    // Assuming includePox3State = true; since there is no unlock height for pox4 (yet)

    // Query for the latest lock event that still applies to the current burn block height.
    // Special case for `handle-unlock` which should be returned if it is the last received event.

    const pox4EventQuery = await sql<PoxSyntheticEventQueryResult[]>`
        SELECT ${sql(POX_SYNTHETIC_EVENT_COLUMNS)}
        FROM pox4_events
        WHERE canonical = true AND microblock_canonical = true AND stacker = ${stxAddress}
        AND block_height <= ${blockHeight}
        AND (
          (name != ${
            SyntheticPoxEventName.HandleUnlock
          } AND burnchain_unlock_height >= ${burnBlockHeight})
          OR
          (name = ${
            SyntheticPoxEventName.HandleUnlock
          } AND burnchain_unlock_height < ${burnBlockHeight})
        )
        ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
        LIMIT 1
      `;
    if (pox4EventQuery.length > 0) {
      const pox4Event = parseDbPoxSyntheticEvent(pox4EventQuery[0]);
      if (pox4Event.name === SyntheticPoxEventName.HandleUnlock) {
        // on a handle-unlock, set all of the locked stx related property to empty/default
        lockTxId = '';
        locked = 0n;
        burnchainUnlockHeight = 0;
        lockHeight = 0;
        burnchainLockHeight = 0;
      } else {
        lockTxId = pox4Event.tx_id;
        locked = pox4Event.locked;
        burnchainUnlockHeight = Number(pox4Event.burnchain_unlock_height);
        lockHeight = pox4Event.block_height;
        const blockQuery = await this.getBlockByHeightInternal(sql, lockHeight);
        burnchainLockHeight = blockQuery.found ? blockQuery.result.burn_block_height : 0;
      }
    }
    // =========================================================================

    const minerRewardQuery = await sql<{ amount: string }[]>`
      SELECT sum(
        coinbase_amount + tx_fees_anchored + tx_fees_streamed_confirmed + tx_fees_streamed_produced
      ) amount
      FROM miner_rewards
      WHERE canonical = true AND recipient = ${stxAddress} AND mature_block_height <= ${blockHeight}
    `;
    const totalRewards = BigInt(minerRewardQuery[0]?.amount ?? 0);
    const totalFees = BigInt(feeQuery[0]?.fee_sum ?? 0);
    const totalSent = BigInt(result[0]?.debit_total ?? 0);
    const totalReceived = BigInt(result[0]?.credit_total ?? 0);
    const balance = totalReceived - totalSent - totalFees + totalRewards;
    return {
      balance,
      totalSent,
      totalReceived,
      totalFeesSent: totalFees,
      totalMinerRewardsReceived: totalRewards,
      lockTxId,
      locked,
      lockHeight,
      burnchainLockHeight,
      burnchainUnlockHeight,
    };
  }

  async getUnlockedStxSupply(
    args:
      | {
          blockHeight: number;
        }
      | { includeUnanchored: boolean }
  ): Promise<{ stx: bigint; blockHeight: number }> {
    return await this.sqlTransaction(async sql => {
      let atBlockHeight: number;
      let atMatureBlockHeight: number;
      if ('blockHeight' in args) {
        atBlockHeight = args.blockHeight;
        atMatureBlockHeight = args.blockHeight;
      } else {
        atBlockHeight = await this.getMaxBlockHeight(sql, {
          includeUnanchored: args.includeUnanchored,
        });
        atMatureBlockHeight = args.includeUnanchored ? atBlockHeight - 1 : atBlockHeight;
      }
      const result = await sql<{ amount: string }[]>`
        SELECT SUM(amount) amount
        FROM (
            SELECT SUM(amount) amount
            FROM stx_events
            WHERE canonical = true AND microblock_canonical = true
            AND asset_event_type_id = 2
            AND block_height <= ${atBlockHeight}
          UNION ALL
            SELECT (SUM(amount) * -1) amount
            FROM stx_events
            WHERE canonical = true AND microblock_canonical = true
            AND asset_event_type_id = 3
            AND block_height <= ${atBlockHeight}
          UNION ALL
            SELECT SUM(coinbase_amount) amount
            FROM miner_rewards
            WHERE canonical = true
            AND mature_block_height <= ${atMatureBlockHeight}
        ) totals
      `;
      if (result.length < 1) {
        throw new Error(`No rows returned from total supply query`);
      }
      return { stx: BigInt(result[0]?.amount ?? 0), blockHeight: atBlockHeight };
    });
  }

  async getAddressAssetEvents({
    stxAddress,
    limit,
    offset,
    blockHeight,
  }: {
    stxAddress: string;
    limit: number;
    offset: number;
    blockHeight: number;
  }): Promise<{ results: DbEvent[]; total: number }> {
    const results = await this.sql<
      ({
        asset_type: 'stx_lock' | 'stx' | 'ft' | 'nft';
        event_index: number;
        tx_id: string;
        tx_index: number;
        block_height: number;
        canonical: boolean;
        asset_event_type_id: number;
        sender?: string;
        recipient?: string;
        asset_identifier: string;
        amount?: string;
        memo?: string;
        unlock_height?: string;
        value?: string;
        contract_name?: string;
      } & { count: number })[]
    >`
      SELECT *, (COUNT(*) OVER())::INTEGER AS count
      FROM(
        SELECT
          'stx_lock' as asset_type, event_index, tx_id, microblock_sequence, tx_index, block_height, canonical, 0 as asset_event_type_id, contract_name,
          locked_address as sender, '' as recipient, '<stx>' as asset_identifier, locked_amount as amount, unlock_height, null::bytea as value, null::bytea as memo
        FROM stx_lock_events
        WHERE canonical = true AND microblock_canonical = true AND locked_address = ${stxAddress} AND block_height <= ${blockHeight}
        UNION ALL
        SELECT
          'stx' as asset_type, event_index, tx_id, microblock_sequence, tx_index, block_height, canonical, asset_event_type_id, '' as contract_name,
          sender, recipient, '<stx>' as asset_identifier, amount::numeric, null::numeric as unlock_height, null::bytea as value, memo
        FROM stx_events
        WHERE canonical = true AND microblock_canonical = true AND (sender = ${stxAddress} OR recipient = ${stxAddress}) AND block_height <= ${blockHeight}
        UNION ALL
        SELECT
          'ft' as asset_type, event_index, tx_id, microblock_sequence, tx_index, block_height, canonical, asset_event_type_id, '' as contract_name,
          sender, recipient, asset_identifier, amount, null::numeric as unlock_height, null::bytea as value, null::bytea as memo
        FROM ft_events
        WHERE canonical = true AND microblock_canonical = true AND (sender = ${stxAddress} OR recipient = ${stxAddress}) AND block_height <= ${blockHeight}
        UNION ALL
        SELECT
          'nft' as asset_type, event_index, tx_id, microblock_sequence, tx_index, block_height, canonical, asset_event_type_id, '' as contract_name,
          sender, recipient, asset_identifier, null::numeric as amount, null::numeric as unlock_height, value, null::bytea as memo
        FROM nft_events
        WHERE canonical = true AND microblock_canonical = true AND (sender = ${stxAddress} OR recipient = ${stxAddress}) AND block_height <= ${blockHeight}
      ) asset_events
      ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    const events: DbEvent[] = results.map(row => {
      if (row.asset_type === 'stx_lock') {
        const event: DbStxLockEvent = {
          event_index: row.event_index,
          tx_id: row.tx_id,
          tx_index: row.tx_index,
          block_height: row.block_height,
          canonical: row.canonical,
          locked_address: unwrapOptional(row.sender),
          locked_amount: BigInt(assertNotNullish(row.amount)),
          unlock_height: Number(assertNotNullish(row.unlock_height)),
          event_type: DbEventTypeId.StxLock,
          contract_name: unwrapOptional(row.contract_name),
        };
        return event;
      } else if (row.asset_type === 'stx') {
        const event: DbStxEvent = {
          event_index: row.event_index,
          tx_id: row.tx_id,
          tx_index: row.tx_index,
          block_height: row.block_height,
          canonical: row.canonical,
          asset_event_type_id: row.asset_event_type_id,
          sender: row.sender,
          recipient: row.recipient,
          event_type: DbEventTypeId.StxAsset,
          amount: BigInt(row.amount ?? 0),
        };
        if (row.memo) {
          event.memo = row.memo;
        }
        return event;
      } else if (row.asset_type === 'ft') {
        const event: DbFtEvent = {
          event_index: row.event_index,
          tx_id: row.tx_id,
          tx_index: row.tx_index,
          block_height: row.block_height,
          canonical: row.canonical,
          asset_event_type_id: row.asset_event_type_id,
          sender: row.sender,
          recipient: row.recipient,
          asset_identifier: row.asset_identifier,
          event_type: DbEventTypeId.FungibleTokenAsset,
          amount: BigInt(row.amount ?? 0),
        };
        return event;
      } else if (row.asset_type === 'nft') {
        const event: DbNftEvent = {
          event_index: row.event_index,
          tx_id: row.tx_id,
          tx_index: row.tx_index,
          block_height: row.block_height,
          canonical: row.canonical,
          asset_event_type_id: row.asset_event_type_id,
          sender: row.sender,
          recipient: row.recipient,
          asset_identifier: row.asset_identifier,
          event_type: DbEventTypeId.NonFungibleTokenAsset,
          value: row.value ?? '',
        };
        return event;
      } else {
        throw new Error(`Unexpected asset_type "${row.asset_type}"`);
      }
    });
    const count = results.length > 0 ? results[0].count : 0;
    return {
      results: events,
      total: count,
    };
  }

  async getFungibleTokenBalances(args: {
    stxAddress: string;
    untilBlock: number;
  }): Promise<Map<string, DbFtBalance>> {
    const result = await this.sql<
      {
        asset_identifier: string;
        credit_total: string | null;
        debit_total: string | null;
      }[]
    >`
      WITH transfers AS (
        SELECT amount, sender, recipient, asset_identifier
        FROM ft_events
        WHERE canonical = true AND microblock_canonical = true
        AND (sender = ${args.stxAddress} OR recipient = ${args.stxAddress})
        AND block_height <= ${args.untilBlock}
      ), credit AS (
        SELECT asset_identifier, sum(amount) as credit_total
        FROM transfers
        WHERE recipient = ${args.stxAddress}
        GROUP BY asset_identifier
      ), debit AS (
        SELECT asset_identifier, sum(amount) as debit_total
        FROM transfers
        WHERE sender = ${args.stxAddress}
        GROUP BY asset_identifier
      )
      SELECT coalesce(credit.asset_identifier, debit.asset_identifier) as asset_identifier, credit_total, debit_total
      FROM credit FULL JOIN debit USING (asset_identifier)
    `;
    // sort by asset name (case-insensitive)
    const rows = result.sort((r1, r2) => r1.asset_identifier.localeCompare(r2.asset_identifier));
    const assetBalances = new Map<string, DbFtBalance>(
      rows.map(r => {
        const totalSent = BigInt(r.debit_total ?? 0);
        const totalReceived = BigInt(r.credit_total ?? 0);
        const balance = totalReceived - totalSent;
        return [r.asset_identifier, { balance, totalSent, totalReceived }];
      })
    );
    return assetBalances;
  }

  async getNonFungibleTokenCounts(args: {
    stxAddress: string;
    untilBlock: number;
  }): Promise<Map<string, { count: bigint; totalSent: bigint; totalReceived: bigint }>> {
    const result = await this.sql<
      {
        asset_identifier: string;
        received_total: string | null;
        sent_total: string | null;
      }[]
    >`
      WITH transfers AS (
        SELECT sender, recipient, asset_identifier
        FROM nft_events
        WHERE canonical = true AND microblock_canonical = true
        AND (sender = ${args.stxAddress} OR recipient = ${args.stxAddress})
        AND block_height <= ${args.untilBlock}
      ), credit AS (
        SELECT asset_identifier, COUNT(*) as received_total
        FROM transfers
        WHERE recipient = ${args.stxAddress}
        GROUP BY asset_identifier
      ), debit AS (
        SELECT asset_identifier, COUNT(*) as sent_total
        FROM transfers
        WHERE sender = ${args.stxAddress}
        GROUP BY asset_identifier
      )
      SELECT coalesce(credit.asset_identifier, debit.asset_identifier) as asset_identifier, received_total, sent_total
      FROM credit FULL JOIN debit USING (asset_identifier)
    `;
    // sort by asset name (case-insensitive)
    const rows = result.sort((r1, r2) => r1.asset_identifier.localeCompare(r2.asset_identifier));
    const assetBalances = new Map(
      rows.map(r => {
        const totalSent = BigInt(r.sent_total ?? 0);
        const totalReceived = BigInt(r.received_total ?? 0);
        const count = totalReceived - totalSent;
        return [r.asset_identifier, { count, totalSent, totalReceived }];
      })
    );
    return assetBalances;
  }

  async getTxStatus(txId: string): Promise<FoundOrNot<DbTxGlobalStatus>> {
    return await this.sqlTransaction(async sql => {
      const chainResult = await sql<DbTxGlobalStatus[]>`
        SELECT status, index_block_hash, microblock_hash
        FROM txs
        WHERE tx_id = ${txId} AND canonical = TRUE AND microblock_canonical = TRUE
        LIMIT 1
      `;
      if (chainResult.count > 0) {
        return {
          found: true,
          result: {
            status: chainResult[0].status,
            index_block_hash: chainResult[0].index_block_hash,
            microblock_hash: chainResult[0].microblock_hash,
          },
        };
      }
      const mempoolResult = await sql<{ status: number }[]>`
        SELECT status
        FROM mempool_txs
        WHERE tx_id = ${txId}
        LIMIT 1
      `;
      if (mempoolResult.count > 0) {
        return {
          found: true,
          result: {
            status: mempoolResult[0].status,
          },
        };
      }
      return { found: false } as const;
    });
  }

  async getAddressTxs(args: {
    stxAddress: string;
    blockHeight: number;
    atSingleBlock: boolean;
    limit: number;
    offset: number;
  }): Promise<{ results: DbTx[]; total: number }> {
    // Query the `principal_stx_txs` table first to get the results page we want and then
    // join against `txs` to get the full transaction objects only for that page.
    const resultQuery = await this.sql<(ContractTxQueryResult & { count: number })[]>`
      WITH stx_txs AS (
        SELECT tx_id, index_block_hash, microblock_hash, (COUNT(*) OVER())::INTEGER AS count
        FROM principal_stx_txs
        WHERE principal = ${args.stxAddress}
          AND ${
            args.atSingleBlock
              ? this.sql`block_height = ${args.blockHeight}`
              : this.sql`block_height <= ${args.blockHeight}`
          }
          AND canonical = TRUE
          AND microblock_canonical = TRUE
        ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC
        LIMIT ${args.limit}
        OFFSET ${args.offset}
      )
      SELECT ${unsafeCols(this.sql, [...TX_COLUMNS, abiColumn(), 'count'])}
      FROM stx_txs
      INNER JOIN txs USING (tx_id, index_block_hash, microblock_hash)
    `;
    const count = resultQuery.length > 0 ? resultQuery[0].count : 0;
    const parsed = resultQuery.map(r => parseTxQueryResult(r));
    return { results: parsed, total: count };
  }

  async getInformationTxsWithStxTransfers({
    stxAddress,
    tx_id,
  }: {
    stxAddress: string;
    tx_id: string;
  }): Promise<DbTxWithAssetTransfers> {
    const resultQuery = await this.sql<
      (ContractTxQueryResult & {
        count: number;
        event_index?: number;
        event_type?: number;
        event_amount?: string;
        event_sender?: string;
        event_recipient?: string;
        event_memo?: string;
      })[]
    >`
      WITH transactions AS (
        WITH principal_txs AS (
          WITH event_txs AS (
            SELECT tx_id FROM stx_events
            WHERE stx_events.sender = ${stxAddress} OR stx_events.recipient = ${stxAddress}
          )
          SELECT *
          FROM txs
          WHERE canonical = true AND microblock_canonical = true
            AND txs.tx_id = ${tx_id}
            AND (
              sender_address = ${stxAddress} OR
              token_transfer_recipient_address = ${stxAddress} OR
              contract_call_contract_id = ${stxAddress} OR
              smart_contract_contract_id = ${stxAddress}
            )
          UNION
          SELECT txs.* FROM txs
          INNER JOIN event_txs ON txs.tx_id = event_txs.tx_id
          WHERE txs.canonical = true AND txs.microblock_canonical = true
            AND txs.tx_id = ${tx_id}
        )
        SELECT ${this.sql(TX_COLUMNS)}, (COUNT(*) OVER())::INTEGER AS count
        FROM principal_txs
        ORDER BY block_height DESC, tx_index DESC
      ), events AS (
        SELECT *, ${DbEventTypeId.StxAsset}::integer as event_type_id
        FROM stx_events
        WHERE canonical = true AND microblock_canonical = true
          AND (sender = ${stxAddress} OR recipient = ${stxAddress})
      )
      SELECT
        transactions.*,
        events.event_index as event_index,
        events.event_type_id as event_type,
        events.amount as event_amount,
        events.sender as event_sender,
        events.recipient as event_recipient,
        events.memo as event_memo,
        ${this.sql.unsafe(abiColumn('transactions'))}
      FROM transactions
      LEFT JOIN events ON transactions.tx_id = events.tx_id
      AND transactions.tx_id = ${tx_id}
      ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
    `;
    const txs = parseTxsWithAssetTransfers(resultQuery, stxAddress);
    const txTransfers = [...txs.values()];
    return txTransfers[0];
  }

  async getAddressTxsWithAssetTransfers(args: {
    stxAddress: string;
    blockHeight: number;
    atSingleBlock: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ results: DbTxWithAssetTransfers[]; total: number }> {
    const resultQuery = await this.sql<
      (ContractTxQueryResult & {
        count: number;
        event_index?: number;
        event_type?: number;
        event_amount?: string;
        event_sender?: string;
        event_recipient?: string;
        event_asset_identifier?: string;
        event_value?: string;
      })[]
    >`
      WITH transactions AS (
        WITH principal_txs AS (
          WITH event_txs AS (
            SELECT tx_id FROM stx_events
            WHERE stx_events.sender = ${args.stxAddress}
              OR stx_events.recipient = ${args.stxAddress}
            UNION
            SELECT tx_id FROM ft_events
            WHERE ft_events.sender = ${args.stxAddress}
              OR ft_events.recipient = ${args.stxAddress}
            UNION
            SELECT tx_id FROM nft_events
            WHERE nft_events.sender = ${args.stxAddress}
              OR nft_events.recipient = ${args.stxAddress}
          )
          SELECT * FROM txs
          WHERE canonical = true AND microblock_canonical = true AND (
            sender_address = ${args.stxAddress} OR
            token_transfer_recipient_address = ${args.stxAddress} OR
            contract_call_contract_id = ${args.stxAddress} OR
            smart_contract_contract_id = ${args.stxAddress}
          )
          UNION
          SELECT txs.* FROM txs
          INNER JOIN event_txs ON txs.tx_id = event_txs.tx_id
          WHERE canonical = true AND microblock_canonical = true
        )
        SELECT ${this.sql(TX_COLUMNS)}, (COUNT(*) OVER())::INTEGER AS count
        FROM principal_txs
        ${
          args.atSingleBlock
            ? this.sql`WHERE block_height = ${args.blockHeight}`
            : this.sql`WHERE block_height <= ${args.blockHeight}`
        }
        ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC
        ${
          !args.atSingleBlock
            ? this.sql`LIMIT ${args.limit ?? 20} OFFSET ${args.offset ?? 0}`
            : this.sql``
        }
      ), events AS (
        SELECT
          tx_id, sender, recipient, event_index, amount,
          ${DbEventTypeId.StxAsset}::integer as event_type_id,
          NULL as asset_identifier, '0'::bytea as value
        FROM stx_events
        WHERE canonical = true AND microblock_canonical = true
          AND (sender = ${args.stxAddress} OR recipient = ${args.stxAddress})
        UNION
        SELECT
          tx_id, sender, recipient, event_index, amount,
          ${DbEventTypeId.FungibleTokenAsset}::integer as event_type_id,
          asset_identifier, '0'::bytea as value
        FROM ft_events
        WHERE canonical = true AND microblock_canonical = true
          AND (sender = ${args.stxAddress} OR recipient = ${args.stxAddress})
        UNION
        SELECT
          tx_id, sender, recipient, event_index, 0 as amount,
          ${DbEventTypeId.NonFungibleTokenAsset}::integer as event_type_id,
          asset_identifier, value
        FROM nft_events
        WHERE canonical = true AND microblock_canonical = true
          AND (sender = ${args.stxAddress} OR recipient = ${args.stxAddress})
      )
      SELECT
        transactions.*,
        ${this.sql.unsafe(abiColumn('transactions'))},
        events.event_index as event_index,
        events.event_type_id as event_type,
        events.amount as event_amount,
        events.sender as event_sender,
        events.recipient as event_recipient,
        events.asset_identifier as event_asset_identifier,
        events.value as event_value
      FROM transactions
      LEFT JOIN events ON transactions.tx_id = events.tx_id
      ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
    `;

    // TODO: should mining rewards be added?

    const txs = parseTxsWithAssetTransfers(resultQuery, args.stxAddress);
    const txTransfers = [...txs.values()];
    txTransfers.sort((a, b) => {
      return b.tx.block_height - a.tx.block_height || b.tx.tx_index - a.tx.tx_index;
    });
    const count = resultQuery.length > 0 ? resultQuery[0].count : 0;
    return { results: txTransfers, total: count };
  }

  async getInboundTransfers(args: {
    stxAddress: string;
    blockHeight: number;
    atSingleBlock: boolean;
    limit: number;
    offset: number;
    sendManyContractId: string;
  }): Promise<{ results: DbInboundStxTransfer[]; total: number }> {
    const resultQuery = await this.sql<(TransferQueryResult & { count: number })[]>`
      SELECT
        *, (COUNT(*) OVER())::INTEGER AS count
      FROM
        (
          SELECT
            stx_events.amount AS amount,
            contract_logs.value AS memo,
            stx_events.sender AS sender,
            stx_events.block_height AS block_height,
            stx_events.tx_id,
            stx_events.microblock_sequence,
            stx_events.tx_index,
            'bulk-send' as transfer_type
          FROM
            contract_logs,
            stx_events
          WHERE
            contract_logs.contract_identifier = ${args.sendManyContractId}
            AND contract_logs.tx_id = stx_events.tx_id
            AND stx_events.recipient = ${args.stxAddress}
            AND contract_logs.event_index = (stx_events.event_index + 1)
            AND stx_events.canonical = true AND stx_events.microblock_canonical = true
            AND contract_logs.canonical = true AND contract_logs.microblock_canonical = true
          UNION ALL

          SELECT
            stx_events.amount AS amount,
            stx_events.memo AS memo,
            stx_events.sender AS sender,
            stx_events.block_height AS block_height,
            stx_events.tx_id,
            stx_events.microblock_sequence,
            stx_events.tx_index,
            'stx-transfer-memo' as transfer_type
          FROM stx_events
          WHERE
            stx_events.memo IS NOT NULL
            AND canonical = true
            AND microblock_canonical = true
            AND recipient = ${args.stxAddress}
          UNION ALL

          SELECT
            token_transfer_amount AS amount,
            token_transfer_memo AS memo,
            sender_address AS sender,
            block_height,
            tx_id,
            microblock_sequence,
            tx_index,
            'stx-transfer' as transfer_type
          FROM
            txs
          WHERE
            canonical = true AND microblock_canonical = true
            AND type_id = 0
            AND token_transfer_recipient_address = ${args.stxAddress}
        ) transfers
      ${
        args.atSingleBlock
          ? this.sql`WHERE block_height = ${args.blockHeight}`
          : this.sql`WHERE block_height <= ${args.blockHeight}`
      }
      ORDER BY
        block_height DESC,
        microblock_sequence DESC,
        tx_index DESC
      LIMIT ${args.limit}
      OFFSET ${args.offset}
    `;
    const count = resultQuery.length > 0 ? resultQuery[0].count : 0;
    const parsed: DbInboundStxTransfer[] = resultQuery.map(r => {
      return {
        sender: r.sender,
        memo: r.memo,
        amount: BigInt(r.amount),
        tx_id: r.tx_id,
        tx_index: r.tx_index,
        block_height: r.block_height,
        transfer_type: r.transfer_type,
      };
    });
    return {
      results: parsed,
      total: count,
    };
  }

  async searchHash({ hash }: { hash: string }): Promise<FoundOrNot<DbSearchResult>> {
    // TODO(mb): add support for searching for microblock by hash
    return await this.sqlTransaction(async sql => {
      const txQuery = await sql<ContractTxQueryResult[]>`
        SELECT ${unsafeCols(sql, [...TX_COLUMNS, abiColumn()])}
        FROM txs WHERE tx_id = ${hash} LIMIT 1
      `;
      if (txQuery.length > 0) {
        const txResult = parseTxQueryResult(txQuery[0]);
        return {
          found: true,
          result: {
            entity_type: 'tx_id',
            entity_id: txQuery[0].tx_id,
            entity_data: txResult,
          },
        };
      }
      const txMempoolQuery = await sql<MempoolTxQueryResult[]>`
        SELECT ${unsafeCols(sql, [...MEMPOOL_TX_COLUMNS, abiColumn('mempool_txs')])}
        FROM mempool_txs WHERE pruned = false AND tx_id = ${hash} LIMIT 1
      `;
      if (txMempoolQuery.length > 0) {
        const txResult = parseMempoolTxQueryResult(txMempoolQuery[0]);
        return {
          found: true,
          result: {
            entity_type: 'mempool_tx_id',
            entity_id: txMempoolQuery[0].tx_id,
            entity_data: txResult,
          },
        };
      }
      const blockQueryResult = await sql<BlockQueryResult[]>`
        SELECT ${sql(BLOCK_COLUMNS)} FROM blocks WHERE block_hash = ${hash} LIMIT 1
      `;
      if (blockQueryResult.length > 0) {
        const blockResult = parseBlockQueryResult(blockQueryResult[0]);
        return {
          found: true,
          result: {
            entity_type: 'block_hash',
            entity_id: blockQueryResult[0].block_hash,
            entity_data: blockResult,
          },
        };
      }
      return { found: false };
    });
  }

  async searchPrincipal({ principal }: { principal: string }): Promise<FoundOrNot<DbSearchResult>> {
    const isContract = principal.includes('.');
    const entityType = isContract ? 'contract_address' : 'standard_address';
    const successResponse = {
      found: true,
      result: {
        entity_type: entityType,
        entity_id: principal,
      },
    } as const;
    return await this.sqlTransaction(async sql => {
      if (isContract) {
        const contractMempoolTxResult = await sql<MempoolTxQueryResult[]>`
          SELECT ${unsafeCols(sql, [...MEMPOOL_TX_COLUMNS, abiColumn('mempool_txs')])}
          FROM mempool_txs WHERE pruned = false AND smart_contract_contract_id = ${principal} LIMIT 1
        `;
        if (contractMempoolTxResult.length > 0) {
          const txResult = parseMempoolTxQueryResult(contractMempoolTxResult[0]);
          return {
            found: true,
            result: {
              entity_type: 'contract_address',
              entity_id: principal,
              entity_data: txResult,
            },
          };
        }
        const contractTxResult = await sql<ContractTxQueryResult[]>`
          SELECT ${unsafeCols(sql, [...TX_COLUMNS, abiColumn()])}
          FROM txs
          WHERE smart_contract_contract_id = ${principal}
          ORDER BY canonical DESC, microblock_canonical DESC, block_height DESC
          LIMIT 1
        `;
        if (contractTxResult.length > 0) {
          const txResult = parseTxQueryResult(contractTxResult[0]);
          return {
            found: true,
            result: {
              entity_type: 'tx_id',
              entity_id: principal,
              entity_data: txResult,
            },
          };
        }
        return { found: false } as const;
      }
      const addressQueryResult = await sql`
        SELECT sender_address, token_transfer_recipient_address
        FROM txs
        WHERE sender_address = ${principal} OR token_transfer_recipient_address = ${principal}
        LIMIT 1
      `;
      if (addressQueryResult.length > 0) {
        return successResponse;
      }
      const stxQueryResult = await sql`
        SELECT sender, recipient
        FROM stx_events
        WHERE sender = ${principal} OR recipient = ${principal}
        LIMIT 1
      `;
      if (stxQueryResult.length > 0) {
        return successResponse;
      }
      const ftQueryResult = await sql`
        SELECT sender, recipient
        FROM ft_events
        WHERE sender = ${principal} OR recipient = ${principal}
        LIMIT 1
      `;
      if (ftQueryResult.length > 0) {
        return successResponse;
      }
      const nftQueryResult = await sql`
        SELECT sender, recipient
        FROM nft_events
        WHERE sender = ${principal} OR recipient = ${principal}
        LIMIT 1
      `;
      if (nftQueryResult.length > 0) {
        return successResponse;
      }
      return { found: false };
    });
  }

  async getBTCFaucetRequests(address: string) {
    const queryResult = await this.sql<FaucetRequestQueryResult[]>`
      SELECT ip, address, currency, occurred_at
      FROM faucet_requests
      WHERE address = ${address} AND currency = 'btc'
      ORDER BY occurred_at DESC
      LIMIT 5
    `;
    const results = queryResult.map(r => parseFaucetRequestQueryResult(r));
    return { results };
  }

  async getSTXFaucetRequests(address: string) {
    const queryResult = await this.sql<FaucetRequestQueryResult[]>`
      SELECT ip, address, currency, occurred_at
      FROM faucet_requests
      WHERE address = ${address} AND currency = 'stx'
      ORDER BY occurred_at DESC
      LIMIT 5
    `;
    const results = queryResult.map(r => parseFaucetRequestQueryResult(r));
    return { results };
  }

  async getRawTx(txId: string) {
    // Note the extra "limit 1" statements are only query hints
    const result = await this.sql<RawTxQueryResult[]>`
      (
        SELECT raw_tx FROM txs WHERE tx_id = ${txId}
        LIMIT 1
      )
      UNION ALL
      (
        SELECT raw_tx FROM mempool_txs WHERE tx_id = ${txId}
        LIMIT 1
      )
      LIMIT 1
    `;
    if (result.length === 0) {
      return { found: false } as const;
    }
    const queryResult: RawTxQueryResult = {
      raw_tx: result[0].raw_tx,
    };
    return { found: true, result: queryResult };
  }

  /**
   * Returns a list of NFTs owned by the given principal filtered by optional `asset_identifiers`,
   * including optional transaction metadata.
   * @param args - Query arguments
   */
  async getNftHoldings(args: {
    principal: string;
    assetIdentifiers?: string[];
    limit: number;
    offset: number;
    includeUnanchored: boolean;
    includeTxMetadata: boolean;
  }): Promise<{ results: NftHoldingInfoWithTxMetadata[]; total: number }> {
    const queryArgs: (string | string[] | number)[] = [args.principal, args.limit, args.offset];
    if (args.assetIdentifiers) {
      queryArgs.push(args.assetIdentifiers);
    }
    const nftCustody = args.includeUnanchored
      ? this.sql(`nft_custody_unanchored`)
      : this.sql(`nft_custody`);
    const assetIdFilter =
      args.assetIdentifiers && args.assetIdentifiers.length > 0
        ? this.sql`AND nft.asset_identifier IN ${this.sql(args.assetIdentifiers)}`
        : this.sql``;
    const nftTxResults = await this.sql<
      (NftHoldingInfo & ContractTxQueryResult & { count: number })[]
    >`
      WITH nft AS (
        SELECT *, (COUNT(*) OVER())::INTEGER AS count
        FROM ${nftCustody} AS nft
        WHERE nft.recipient = ${args.principal}
        ${assetIdFilter}
        ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
        LIMIT ${args.limit}
        OFFSET ${args.offset}
      )
      ${
        args.includeTxMetadata
          ? this.sql`
            SELECT ${unsafeCols(this.sql, [
              'nft.asset_identifier',
              'nft.value',
              ...prefixedCols(TX_COLUMNS, 'txs'),
              abiColumn(),
              'nft.count',
            ])}
            FROM nft
            INNER JOIN txs USING (tx_id)
            WHERE txs.canonical = TRUE AND txs.microblock_canonical = TRUE
            `
          : this.sql`SELECT * FROM nft`
      }
    `;
    return {
      results: nftTxResults.map(row => ({
        nft_holding_info: {
          asset_identifier: row.asset_identifier,
          value: row.value,
          recipient: row.recipient,
          tx_id: row.tx_id,
          block_height: row.block_height,
        },
        tx: args.includeTxMetadata ? parseTxQueryResult(row) : undefined,
      })),
      total: nftTxResults.length > 0 ? nftTxResults[0].count : 0,
    };
  }

  /**
   * Returns the event history of a particular NFT.
   * @param args - Query arguments
   */
  async getNftHistory(args: {
    assetIdentifier: string;
    value: string;
    limit: number;
    offset: number;
    blockHeight: number;
    includeTxMetadata: boolean;
  }): Promise<{ results: NftEventWithTxMetadata[]; total: number }> {
    const columns = args.includeTxMetadata
      ? unsafeCols(this.sql, [
          'asset_identifier',
          'value',
          'event_index',
          'asset_event_type_id',
          'sender',
          'recipient',
          ...prefixedCols(TX_COLUMNS, 'txs'),
          abiColumn(),
        ])
      : this.sql`nft.*`;
    const nftTxResults = await this.sql<(DbNftEvent & ContractTxQueryResult & { count: number })[]>`
      SELECT ${columns}, (COUNT(*) OVER())::INTEGER AS count
      FROM nft_events AS nft
      INNER JOIN txs USING (tx_id)
      WHERE asset_identifier = ${args.assetIdentifier}
        AND nft.value = ${args.value}
        AND txs.canonical = TRUE AND txs.microblock_canonical = TRUE
        AND nft.canonical = TRUE AND nft.microblock_canonical = TRUE
        AND nft.block_height <= ${args.blockHeight}
      ORDER BY
        nft.block_height DESC,
        txs.microblock_sequence DESC,
        txs.tx_index DESC,
        nft.event_index DESC
      LIMIT ${args.limit}
      OFFSET ${args.offset}
    `;
    return {
      results: nftTxResults.map(row => ({
        nft_event: {
          event_type: DbEventTypeId.NonFungibleTokenAsset,
          value: row.value,
          asset_identifier: row.asset_identifier,
          asset_event_type_id: row.asset_event_type_id,
          sender: row.sender,
          recipient: row.recipient,
          event_index: row.event_index,
          tx_id: row.tx_id,
          tx_index: row.tx_index,
          block_height: row.block_height,
          canonical: row.canonical,
        },
        tx: args.includeTxMetadata ? parseTxQueryResult(row) : undefined,
      })),
      total: nftTxResults.length > 0 ? nftTxResults[0].count : 0,
    };
  }

  /**
   * Returns all NFT mint events for a particular asset identifier.
   * @param args - Query arguments
   */
  async getNftMints(args: {
    assetIdentifier: string;
    limit: number;
    offset: number;
    blockHeight: number;
    includeTxMetadata: boolean;
  }): Promise<{ results: NftEventWithTxMetadata[]; total: number }> {
    const columns = args.includeTxMetadata
      ? unsafeCols(this.sql, [
          'asset_identifier',
          'value',
          'event_index',
          'asset_event_type_id',
          'sender',
          'recipient',
          ...prefixedCols(TX_COLUMNS, 'txs'),
          abiColumn(),
        ])
      : this.sql`nft.*`;
    const nftTxResults = await this.sql<(DbNftEvent & ContractTxQueryResult & { count: number })[]>`
      SELECT ${columns}, (COUNT(*) OVER())::INTEGER AS count
      FROM nft_events AS nft
      INNER JOIN txs USING (tx_id)
      WHERE nft.asset_identifier = ${args.assetIdentifier}
        AND nft.asset_event_type_id = ${DbAssetEventTypeId.Mint}
        AND nft.canonical = TRUE AND nft.microblock_canonical = TRUE
        AND txs.canonical = TRUE AND txs.microblock_canonical = TRUE
        AND nft.block_height <= ${args.blockHeight}
      ORDER BY
        nft.block_height DESC,
        txs.microblock_sequence DESC,
        txs.tx_index DESC,
        nft.event_index DESC
      LIMIT ${args.limit}
      OFFSET ${args.offset}
    `;
    return {
      results: nftTxResults.map(row => ({
        nft_event: {
          event_type: DbEventTypeId.NonFungibleTokenAsset,
          value: row.value,
          asset_identifier: row.asset_identifier,
          asset_event_type_id: row.asset_event_type_id,
          sender: row.sender,
          recipient: row.recipient,
          event_index: row.event_index,
          tx_id: row.tx_id,
          tx_index: row.tx_index,
          block_height: row.block_height,
          canonical: row.canonical,
        },
        tx: args.includeTxMetadata ? parseTxQueryResult(row) : undefined,
      })),
      total: nftTxResults.length > 0 ? nftTxResults[0].count : 0,
    };
  }

  async getNftEvent(args: { txId: string; eventIndex: number }): Promise<FoundOrNot<DbNftEvent>> {
    const result = await this.sql<DbNftEvent[]>`
      SELECT
        event_index, tx_id, tx_index, block_height, index_block_hash, parent_index_block_hash,
        microblock_hash, microblock_sequence, microblock_canonical, canonical, asset_event_type_id,
        asset_identifier, value, sender, recipient
      FROM nft_events
      WHERE canonical = TRUE
        AND microblock_canonical = TRUE
        AND tx_id = ${args.txId}
        AND event_index = ${args.eventIndex}
    `;
    if (result.length === 0) {
      return { found: false } as const;
    }
    return { found: true, result: result[0] } as const;
  }

  async getTxListDetails({
    txIds,
    includeUnanchored,
  }: {
    txIds: string[];
    includeUnanchored: boolean;
  }): Promise<DbTx[]> {
    if (txIds.length === 0) {
      return [];
    }
    return await this.sqlTransaction(async sql => {
      const maxBlockHeight = await this.getMaxBlockHeight(sql, { includeUnanchored });
      const result = await sql<ContractTxQueryResult[]>`
        SELECT ${unsafeCols(sql, [...TX_COLUMNS, abiColumn()])}
        FROM txs
        WHERE tx_id IN ${sql(txIds)}
          AND block_height <= ${maxBlockHeight}
          AND canonical = true
          AND microblock_canonical = true
      `;
      if (result.length === 0) {
        return [];
      }
      return result.map(row => {
        return parseTxQueryResult(row);
      });
    });
  }

  async getNamespaceList({ includeUnanchored }: { includeUnanchored: boolean }) {
    const queryResult = await this.sqlTransaction(async sql => {
      const maxBlockHeight = await this.getMaxBlockHeight(sql, { includeUnanchored });
      return await sql<{ namespace_id: string }[]>`
        SELECT DISTINCT ON (namespace_id) namespace_id
        FROM namespaces
        WHERE canonical = true AND microblock_canonical = true
        AND ready_block <= ${maxBlockHeight}
        ORDER BY namespace_id, ready_block DESC, microblock_sequence DESC, tx_index DESC
      `;
    });
    const results = queryResult.map(r => r.namespace_id);
    return { results };
  }

  async getNamespaceNamesList({
    namespace,
    page,
    includeUnanchored,
  }: {
    namespace: string;
    page: number;
    includeUnanchored: boolean;
  }): Promise<{
    results: string[];
  }> {
    const offset = page * 100;
    const queryResult = await this.sqlTransaction(async sql => {
      const maxBlockHeight = await this.getMaxBlockHeight(sql, { includeUnanchored });
      return await sql<{ name: string }[]>`
        SELECT name FROM (
          SELECT DISTINCT ON (name) name, status
          FROM names
          WHERE namespace_id = ${namespace}
          AND registered_at <= ${maxBlockHeight}
          AND canonical = true AND microblock_canonical = true
          ORDER BY name, registered_at DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
          LIMIT 100
          OFFSET ${offset}
        ) AS name_status
        WHERE status <> 'name-revoke'
      `;
    });
    const results = queryResult.map(r => r.name);
    return { results };
  }

  async getNamespace({
    namespace,
    includeUnanchored,
  }: {
    namespace: string;
    includeUnanchored: boolean;
  }): Promise<FoundOrNot<DbBnsNamespace & { index_block_hash: string }>> {
    const queryResult = await this.sqlTransaction(async sql => {
      const maxBlockHeight = await this.getMaxBlockHeight(sql, { includeUnanchored });
      return await sql<(DbBnsNamespace & { tx_id: string; index_block_hash: string })[]>`
        SELECT DISTINCT ON (namespace_id) namespace_id, *
        FROM namespaces
        WHERE namespace_id = ${namespace}
        AND ready_block <= ${maxBlockHeight}
        AND canonical = true AND microblock_canonical = true
        ORDER BY namespace_id, ready_block DESC, microblock_sequence DESC, tx_index DESC
        LIMIT 1
      `;
    });
    if (queryResult.length > 0) {
      return {
        found: true,
        result: {
          ...queryResult[0],
          tx_id: queryResult[0].tx_id,
          index_block_hash: queryResult[0].index_block_hash,
        },
      };
    }
    return { found: false } as const;
  }

  async getName({
    name,
    includeUnanchored,
  }: {
    name: string;
    includeUnanchored: boolean;
  }): Promise<FoundOrNot<DbBnsName>> {
    return await this.sqlTransaction(async sql => {
      const blockHeight = await this.getMaxBlockHeight(sql, { includeUnanchored });
      const result = await this.getNamesAtBlockHeight({ names: [name], blockHeight });
      return result.length ? { found: true, result: result[0] } : { found: false };
    });
  }

  async getNamesAtBlockHeight(args: {
    names: string[];
    blockHeight: number;
  }): Promise<DbBnsName[]> {
    return await this.sql<DbBnsName[]>`
      WITH name_results AS (
        SELECT DISTINCT ON (n.name) n.*, z.zonefile
        FROM names AS n
        LEFT JOIN zonefiles AS z USING (name, tx_id, index_block_hash)
        WHERE n.name IN ${this.sql(args.names)}
          AND n.registered_at <= ${args.blockHeight}
          AND n.canonical = true
          AND n.microblock_canonical = true
        ORDER BY n.name,
          n.registered_at DESC,
          n.microblock_sequence DESC,
          n.tx_index DESC,
          n.event_index DESC
      )
      SELECT * FROM name_results WHERE status IS NULL OR status <> 'name-revoke'
    `;
  }

  async getHistoricalZoneFile(args: {
    name: string;
    zoneFileHash: string;
    includeUnanchored: boolean;
    chainId: ChainID;
  }): Promise<FoundOrNot<DbBnsZoneFile>> {
    const queryResult = await this.sqlTransaction(async sql => {
      const maxBlockHeight = await this.getMaxBlockHeight(sql, {
        includeUnanchored: args.includeUnanchored,
      });
      const parentName = await this.getNamesAtBlockHeight({
        names: [bnsNameFromSubdomain(args.name)],
        blockHeight: maxBlockHeight,
      });
      if (parentName.length === 0) {
        return [] as { zonefile: string }[];
      }
      const validZonefileHash = validateZonefileHash(args.zoneFileHash);
      // Depending on the kind of name we got, use the correct table to pivot on canonical chain
      // state to get the zonefile. We can't pivot on the `txs` table because some names/subdomains
      // were imported from Stacks v1 and they don't have an associated tx.
      const isSubdomain = args.name.split('.').length > 2;
      if (isSubdomain) {
        return sql<{ zonefile: string }[]>`
          SELECT zonefile
          FROM zonefiles AS z
          INNER JOIN subdomains AS s ON
            s.fully_qualified_subdomain = z.name
            AND s.tx_id = z.tx_id
            AND s.index_block_hash = z.index_block_hash
          WHERE z.name = ${args.name}
            AND z.zonefile_hash = ${validZonefileHash}
            AND s.canonical = TRUE
            AND s.microblock_canonical = TRUE
            AND s.block_height <= ${maxBlockHeight}
          ORDER BY s.block_height DESC, s.microblock_sequence DESC, s.tx_index DESC
          LIMIT 1
        `;
      } else {
        return sql<{ zonefile: string }[]>`
          SELECT zonefile
          FROM zonefiles AS z
          INNER JOIN names AS n USING (name, tx_id, index_block_hash)
          WHERE z.name = ${args.name}
            AND z.zonefile_hash = ${validZonefileHash}
            AND n.canonical = TRUE
            AND n.microblock_canonical = TRUE
            AND n.registered_at <= ${maxBlockHeight}
          ORDER BY n.registered_at DESC, n.microblock_sequence DESC, n.tx_index DESC
          LIMIT 1
        `;
      }
    });
    if (queryResult.length > 0) {
      return {
        found: true,
        result: queryResult[0],
      };
    }
    return { found: false } as const;
  }

  async getLatestZoneFile({
    name,
    includeUnanchored,
  }: {
    name: string;
    includeUnanchored: boolean;
  }): Promise<FoundOrNot<DbBnsZoneFile>> {
    const queryResult = await this.sqlTransaction(async sql => {
      const maxBlockHeight = await this.getMaxBlockHeight(sql, { includeUnanchored });
      const parentName = await this.getNamesAtBlockHeight({
        names: [bnsNameFromSubdomain(name)],
        blockHeight: maxBlockHeight,
      });
      if (parentName.length === 0) {
        return [] as { zonefile: string }[];
      }
      // Depending on the kind of name we got, use the correct table to pivot on canonical chain
      // state to get the zonefile. We can't pivot on the `txs` table because some names/subdomains
      // were imported from Stacks v1 and they don't have an associated tx.
      const isSubdomain = name.split('.').length > 2;
      if (isSubdomain) {
        return sql<{ zonefile: string }[]>`
          SELECT zonefile
          FROM zonefiles AS z
          INNER JOIN subdomains AS s ON
            s.fully_qualified_subdomain = z.name
            AND s.tx_id = z.tx_id
            AND s.index_block_hash = z.index_block_hash
          WHERE z.name = ${name}
            AND s.canonical = TRUE
            AND s.microblock_canonical = TRUE
            AND s.block_height <= ${maxBlockHeight}
          ORDER BY s.block_height DESC, s.microblock_sequence DESC, s.tx_index DESC
          LIMIT 1
        `;
      } else {
        return sql<{ zonefile: string }[]>`
          SELECT zonefile
          FROM zonefiles AS z
          INNER JOIN names AS n USING (name, tx_id, index_block_hash)
          WHERE z.name = ${name}
            AND n.canonical = TRUE
            AND n.microblock_canonical = TRUE
            AND n.registered_at <= ${maxBlockHeight}
          ORDER BY n.registered_at DESC, n.microblock_sequence DESC, n.tx_index DESC
          LIMIT 1
        `;
      }
    });
    if (queryResult.length > 0) {
      return {
        found: true,
        result: queryResult[0],
      };
    }
    return { found: false } as const;
  }

  async getNamesByAddressList({
    address,
    includeUnanchored,
    chainId,
  }: {
    address: string;
    includeUnanchored: boolean;
    chainId: ChainID;
  }): Promise<FoundOrNot<string[]>> {
    const queryResult = await this.sqlTransaction(async sql => {
      const maxBlockHeight = await this.getMaxBlockHeight(sql, { includeUnanchored });
      // 1. Get subdomains owned by this address. These don't produce NFT events so we have to look
      //    directly at the `subdomains` table.
      const subdomainsQuery = await sql<{ name: string; fully_qualified_subdomain: string }[]>`
        WITH addr_subdomains AS (
          SELECT DISTINCT ON (fully_qualified_subdomain)
            fully_qualified_subdomain
          FROM
            subdomains
          WHERE
            owner = ${address}
            AND block_height <= ${maxBlockHeight}
            AND canonical = TRUE
            AND microblock_canonical = TRUE
        )
        SELECT DISTINCT ON (fully_qualified_subdomain)
          fully_qualified_subdomain, name
        FROM
          subdomains
          INNER JOIN addr_subdomains USING (fully_qualified_subdomain)
        WHERE
          canonical = TRUE
          AND microblock_canonical = TRUE
        ORDER BY
          fully_qualified_subdomain
      `;
      const subdomainMap = new Map<string, string[]>(); // name -> subdomain array
      for (const item of subdomainsQuery) {
        const val = subdomainMap.get(item.name);
        subdomainMap.set(
          item.name,
          val ? [...val, item.fully_qualified_subdomain] : [item.fully_qualified_subdomain]
        );
      }
      // 2. Get names owned by this address which were imported from Blockstack v1. These also don't
      //    have an associated NFT event so we have to look directly at the `names` table, however,
      //    we'll also check if any of these names are still owned by the same user.
      const importedNamesQuery = await sql<{ name: string }[]>`
        SELECT
          name
        FROM
          names
        WHERE
          address = ${address}
          AND registered_at = 1
          AND canonical = TRUE
          AND microblock_canonical = TRUE
      `;
      let oldImportedNames: string[] = [];
      if (importedNamesQuery.length > 0) {
        const nameCVs = importedNamesQuery.map(i => bnsNameCV(i.name));
        const oldImportedNamesQuery = await sql<{ value: string }[]>`
          SELECT value
          FROM ${includeUnanchored ? sql`nft_custody_unanchored` : sql`nft_custody`}
          WHERE recipient <> ${address} AND value IN ${sql(nameCVs)}
        `;
        oldImportedNames = oldImportedNamesQuery.map(i => bnsHexValueToName(i.value));
      }
      const namesToValidate = importedNamesQuery
        .map(i => i.name)
        .filter(i => !oldImportedNames.includes(i));
      // 3. Get newer NFT names owned by this address.
      const nftNamesQuery = await sql<{ value: string }[]>`
        SELECT value
        FROM ${includeUnanchored ? sql`nft_custody_unanchored` : sql`nft_custody`}
        WHERE recipient = ${address} AND asset_identifier = ${getBnsSmartContractId(chainId)}
      `;
      namesToValidate.push(...nftNamesQuery.map(i => bnsHexValueToName(i.value)));
      // 4. Now that we've acquired all names/subdomains owned by this address, filter out the ones
      //    that are revoked. For subdomains, verify the parent name is not revoked.
      const validatedNames = (
        await this.getNamesAtBlockHeight({
          names: Array.from(new Set([...subdomainMap.keys(), ...namesToValidate])),
          blockHeight: maxBlockHeight,
        })
      ).map(i => i.name);
      // 5. Gather results. Keep all valid names + all subdomains whose parent names are valid.
      const namesResult: string[] = [];
      for (const name of validatedNames) {
        const subdomains = subdomainMap.get(name);
        if (subdomains) {
          namesResult.push(...subdomains);
        }
        if (namesToValidate.includes(name)) {
          namesResult.push(name);
        }
      }
      return namesResult.sort();
    });
    if (queryResult.length > 0) {
      return {
        found: true,
        result: queryResult,
      };
    }
    return { found: false } as const;
  }

  /**
   * This function returns the subdomains for a specific name
   * @param name - The name for which subdomains are required
   */
  async getSubdomainsListInName({
    name,
    includeUnanchored,
    chainId,
  }: {
    name: string;
    includeUnanchored: boolean;
    chainId: ChainID;
  }): Promise<{ results: string[] }> {
    const queryResult = await this.sqlTransaction(async sql => {
      const maxBlockHeight = await this.getMaxBlockHeight(sql, { includeUnanchored });
      const status = await this.getNamesAtBlockHeight({
        names: [name],
        blockHeight: maxBlockHeight,
      });
      if (status.length === 0) {
        return [] as { fully_qualified_subdomain: string }[];
      }
      return await sql<{ fully_qualified_subdomain: string }[]>`
        SELECT DISTINCT ON (fully_qualified_subdomain) fully_qualified_subdomain
        FROM subdomains
        WHERE name = ${name}
          AND block_height <= ${maxBlockHeight}
          AND canonical = true
          AND microblock_canonical = true
        ORDER BY fully_qualified_subdomain, block_height DESC, microblock_sequence DESC, tx_index DESC
      `;
    });
    const results = queryResult.map(r => r.fully_qualified_subdomain);
    return { results };
  }

  /**
   * @deprecated This function is only used for testing.
   */
  async getSubdomainsList({
    page,
    includeUnanchored,
  }: {
    page: number;
    includeUnanchored: boolean;
  }) {
    const offset = page * 100;
    const queryResult = await this.sqlTransaction(async sql => {
      const maxBlockHeight = await this.getMaxBlockHeight(sql, { includeUnanchored });
      return await sql<{ fully_qualified_subdomain: string }[]>`
        SELECT DISTINCT ON (fully_qualified_subdomain) fully_qualified_subdomain
        FROM subdomains
        WHERE block_height <= ${maxBlockHeight}
        AND canonical = true AND microblock_canonical = true
        ORDER BY fully_qualified_subdomain, block_height DESC, microblock_sequence DESC, tx_index DESC
        LIMIT 100
        OFFSET ${offset}
      `;
    });
    const results = queryResult.map(r => r.fully_qualified_subdomain);
    return { results };
  }

  async getNamesList({ page, includeUnanchored }: { page: number; includeUnanchored: boolean }) {
    const offset = page * 100;
    const queryResult = await this.sqlTransaction(async sql => {
      const maxBlockHeight = await this.getMaxBlockHeight(sql, { includeUnanchored });
      return await sql<{ name: string }[]>`
        WITH name_results AS (
          SELECT DISTINCT ON (name) name, status
          FROM names
          WHERE canonical = true AND microblock_canonical = true
          AND registered_at <= ${maxBlockHeight}
          ORDER BY name, registered_at DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
        )
        SELECT name FROM name_results
        WHERE status <> 'name-revoke'
        LIMIT 100
        OFFSET ${offset}
      `;
    });
    const results = queryResult.map(r => r.name);
    return { results };
  }

  async getSubdomain({
    subdomain,
    includeUnanchored,
    chainId,
  }: {
    subdomain: string;
    includeUnanchored: boolean;
    chainId: ChainID;
  }): Promise<FoundOrNot<DbBnsSubdomain & { index_block_hash: string }>> {
    const queryResult = await this.sqlTransaction(async sql => {
      const maxBlockHeight = await this.getMaxBlockHeight(sql, { includeUnanchored });
      const status = await this.getNamesAtBlockHeight({
        names: [bnsNameFromSubdomain(subdomain)],
        blockHeight: maxBlockHeight,
      });
      if (status.length === 0) {
        return [] as (DbBnsSubdomain & { tx_id: string; index_block_hash: string })[];
      }
      return await sql<(DbBnsSubdomain & { tx_id: string; index_block_hash: string })[]>`
        SELECT s.*, z.zonefile
        FROM subdomains AS s
        LEFT JOIN zonefiles AS z
          ON z.name = s.fully_qualified_subdomain
          AND z.tx_id = s.tx_id
          AND z.index_block_hash = s.index_block_hash
        WHERE s.canonical = true
          AND s.microblock_canonical = true
          AND s.block_height <= ${maxBlockHeight}
          AND s.fully_qualified_subdomain = ${subdomain}
        ORDER BY s.block_height DESC, s.microblock_sequence DESC, s.tx_index DESC
        LIMIT 1
      `;
    });
    if (queryResult.length > 0 && queryResult[0].zonefile_hash) {
      return {
        found: true,
        result: {
          ...queryResult[0],
          tx_id: queryResult[0].tx_id,
          index_block_hash: queryResult[0].index_block_hash,
        },
      };
    }
    return { found: false } as const;
  }

  async getSubdomainResolver(args: { name: string }): Promise<FoundOrNot<string>> {
    const queryResult = await this.sql<{ resolver: string }[]>`
      SELECT DISTINCT ON (name) name, resolver
      FROM subdomains
      WHERE canonical = true AND microblock_canonical = true
      AND name = ${args.name}
      ORDER BY name, block_height DESC, microblock_sequence DESC, tx_index DESC
      LIMIT 1
    `;
    if (queryResult.length > 0) {
      return {
        found: true,
        result: queryResult[0].resolver,
      };
    }
    return { found: false } as const;
  }

  async getTokenOfferingLocked(address: string, blockHeight: number) {
    const queryResult = await this.sql<DbTokenOfferingLocked[]>`
      SELECT block, value
      FROM token_offering_locked
      WHERE address = ${address}
      ORDER BY block ASC
    `;
    if (queryResult.length > 0) {
      let totalLocked = 0n;
      let totalUnlocked = 0n;
      const unlockSchedules: AddressUnlockSchedule[] = [];
      queryResult.forEach(lockedInfo => {
        const unlockSchedule: AddressUnlockSchedule = {
          amount: lockedInfo.value.toString(),
          block_height: lockedInfo.block,
        };
        unlockSchedules.push(unlockSchedule);
        if (lockedInfo.block > blockHeight) {
          totalLocked += BigInt(lockedInfo.value);
        } else {
          totalUnlocked += BigInt(lockedInfo.value);
        }
      });

      const tokenOfferingLocked: AddressTokenOfferingLocked = {
        total_locked: totalLocked.toString(),
        total_unlocked: totalUnlocked.toString(),
        unlock_schedule: unlockSchedules,
      };
      return {
        found: true,
        result: tokenOfferingLocked,
      };
    } else {
      return { found: false } as const;
    }
  }

  async getBlockByBurnBlockHeight(burnBlockHeight: number): Promise<FoundOrNot<DbBlock>> {
    return await this.sqlTransaction(async client => {
      const result = await client<BlockQueryResult[]>`
        SELECT ${client(BLOCK_COLUMNS)}
        FROM blocks
        WHERE canonical = true AND burn_block_height >= ${burnBlockHeight}
        ORDER BY block_height ASC
        LIMIT 1
      `;
      if (result.length === 0) {
        return { found: false } as const;
      }
      const row = result[0];
      const block = parseBlockQueryResult(row);
      return { found: true, result: block } as const;
    });
  }

  async getUnlockedAddressesAtBlock(block: DbBlock): Promise<StxUnlockEvent[]> {
    return await this.sqlTransaction(async client => {
      return await this.internalGetUnlockedAccountsAtHeight(client, block);
    });
  }

  async internalGetUnlockedAccountsAtHeight(
    sql: PgSqlClient,
    block: DbBlock
  ): Promise<StxUnlockEvent[]> {
    const current_burn_height = block.burn_block_height;
    let previous_burn_height = current_burn_height;
    if (block.block_height > 1) {
      const previous_block = await this.getBlockByHeightInternal(sql, block.block_height - 1);
      if (previous_block.found) {
        previous_burn_height = previous_block.result.burn_block_height;
      }
    }
    let v1UnlockHeight: number | null = null;
    let v2UnlockHeight: number | null = null;
    let v3UnlockHeight: number | null = null;
    const poxUnlockHeights = await this.getPoxForcedUnlockHeightsInternal(sql);
    if (poxUnlockHeights.found) {
      v1UnlockHeight = poxUnlockHeights.result.pox1UnlockHeight;
      v2UnlockHeight = poxUnlockHeights.result.pox2UnlockHeight;
      v3UnlockHeight = poxUnlockHeights.result.pox3UnlockHeight;
    }

    type StxLockEventResult = {
      locked_amount: string;
      unlock_height: number;
      locked_address: string;
      block_height: number;
      tx_index: number;
      event_index: number;
    };

    // Once the pox_v1_unlock_height is reached, stop using `stx_lock_events` to determinel locked state,
    // because it includes pox-v1 entries. We only care about pox-v2, so only need to query `pox2_events`.
    let poxV1Unlocks: StxLockEventResult[] = [];
    const includePox1State = v1UnlockHeight === null || v1UnlockHeight > current_burn_height;
    if (includePox1State) {
      poxV1Unlocks = await sql<StxLockEventResult[]>`
        SELECT DISTINCT ON (locked_address) locked_address, locked_amount, unlock_height, block_height, tx_index, event_index
        FROM stx_lock_events
        WHERE microblock_canonical = true AND canonical = true
        AND contract_name = 'pox'
        AND unlock_height <= ${current_burn_height} AND unlock_height > ${previous_burn_height}
        ORDER BY locked_address, block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
      `;
    }

    // Check if given height equals pox_v1_unlock_height and generate events for all
    // accounts locked in pox-v1
    let poxV1ForceUnlocks: StxLockEventResult[] = [];
    const generatePoxV1ForceUnlocks =
      v1UnlockHeight !== null &&
      current_burn_height > v1UnlockHeight &&
      previous_burn_height <= v1UnlockHeight;
    if (generatePoxV1ForceUnlocks) {
      const poxV1UnlocksQuery = await sql<StxLockEventResult[]>`
        SELECT DISTINCT ON (locked_address) locked_address, locked_amount, unlock_height, block_height, tx_index, event_index
        FROM stx_lock_events
        WHERE microblock_canonical = true AND canonical = true
        AND contract_name = 'pox'
        AND unlock_height > ${previous_burn_height}
        ORDER BY locked_address, block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
      `;
      poxV1ForceUnlocks = poxV1UnlocksQuery.map(row => {
        const unlockEvent: StxLockEventResult = {
          locked_amount: row.locked_amount,
          unlock_height: current_burn_height,
          locked_address: row.locked_address,
          block_height: row.block_height,
          tx_index: row.tx_index,
          event_index: row.event_index,
        };
        return unlockEvent;
      });
    }

    let poxV2Unlocks: StxLockEventResult[] = [];
    const checkPox2Unlocks = v2UnlockHeight === null || current_burn_height < v2UnlockHeight;
    if (checkPox2Unlocks) {
      const pox2EventQuery = await sql<PoxSyntheticEventQueryResult[]>`
        SELECT DISTINCT ON (stacker) stacker, ${sql(POX_SYNTHETIC_EVENT_COLUMNS)}
        FROM pox2_events
        WHERE canonical = true AND microblock_canonical = true
        AND block_height <= ${block.block_height}
        AND (
          (
            burnchain_unlock_height <= ${current_burn_height}
            AND burnchain_unlock_height > ${previous_burn_height}
            AND name IN ${sql([
              SyntheticPoxEventName.StackStx,
              SyntheticPoxEventName.StackIncrease,
              SyntheticPoxEventName.StackExtend,
              SyntheticPoxEventName.DelegateStackStx,
              SyntheticPoxEventName.DelegateStackIncrease,
              SyntheticPoxEventName.DelegateStackExtend,
            ])}
          ) OR (
            name = ${SyntheticPoxEventName.HandleUnlock}
            AND burnchain_unlock_height < ${current_burn_height}
            AND burnchain_unlock_height >= ${previous_burn_height}
          )
        )
        ORDER BY stacker, block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
      `;
      poxV2Unlocks = pox2EventQuery.map(row => {
        const pox2Event = parseDbPoxSyntheticEvent(row);
        const unlockEvent: StxLockEventResult = {
          locked_amount: pox2Event.locked.toString(),
          unlock_height: Number(pox2Event.burnchain_unlock_height),
          locked_address: pox2Event.stacker,
          block_height: pox2Event.block_height,
          tx_index: pox2Event.tx_index,
          event_index: pox2Event.event_index,
        };
        return unlockEvent;
      });
    }

    const poxV2ForceUnlocks: StxLockEventResult[] = [];
    const generatePoxV2ForceUnlocks =
      v2UnlockHeight !== null &&
      current_burn_height > v2UnlockHeight &&
      previous_burn_height <= v2UnlockHeight;
    if (generatePoxV2ForceUnlocks) {
      const pox2EventQuery = await sql<PoxSyntheticEventQueryResult[]>`
        SELECT DISTINCT ON (stacker) stacker, ${sql(POX_SYNTHETIC_EVENT_COLUMNS)}
        FROM pox2_events
        WHERE canonical = true AND microblock_canonical = true
        AND block_height <= ${block.block_height}
        AND (
          ( name != ${SyntheticPoxEventName.HandleUnlock} AND
            burnchain_unlock_height >= ${current_burn_height})
          OR
          ( name = ${SyntheticPoxEventName.HandleUnlock} AND
            burnchain_unlock_height < ${current_burn_height})
        )
        ORDER BY stacker, block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
      `;
      for (const row of pox2EventQuery) {
        const pox2Event = parseDbPoxSyntheticEvent(row);
        if (pox2Event.name !== SyntheticPoxEventName.HandleUnlock) {
          const unlockEvent: StxLockEventResult = {
            locked_amount: pox2Event.locked.toString(),
            unlock_height: Number(pox2Event.burnchain_unlock_height),
            locked_address: pox2Event.stacker,
            block_height: pox2Event.block_height,
            tx_index: pox2Event.tx_index,
            event_index: pox2Event.event_index,
          };
          poxV2ForceUnlocks.push(unlockEvent);
        }
      }
    }

    let poxV3Unlocks: StxLockEventResult[] = [];
    const checkPox3Unlocks = v3UnlockHeight === null || current_burn_height < v3UnlockHeight;
    if (checkPox3Unlocks) {
      const pox3EventQuery = await sql<PoxSyntheticEventQueryResult[]>`
        SELECT DISTINCT ON (stacker) stacker, ${sql(POX_SYNTHETIC_EVENT_COLUMNS)}
        FROM pox3_events
        WHERE canonical = true AND microblock_canonical = true
        AND block_height <= ${block.block_height}
        AND (
          (
            burnchain_unlock_height <= ${current_burn_height}
            AND burnchain_unlock_height > ${previous_burn_height}
            AND name IN ${sql([
              SyntheticPoxEventName.StackStx,
              SyntheticPoxEventName.StackIncrease,
              SyntheticPoxEventName.StackExtend,
              SyntheticPoxEventName.DelegateStackStx,
              SyntheticPoxEventName.DelegateStackIncrease,
              SyntheticPoxEventName.DelegateStackExtend,
            ])}
          ) OR (
            name = ${SyntheticPoxEventName.HandleUnlock}
            AND burnchain_unlock_height < ${current_burn_height}
            AND burnchain_unlock_height >= ${previous_burn_height}
          )
        )
        ORDER BY stacker, block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
      `;
      poxV3Unlocks = pox3EventQuery.map(row => {
        const pox3Event = parseDbPoxSyntheticEvent(row);
        const unlockEvent: StxLockEventResult = {
          locked_amount: pox3Event.locked.toString(),
          unlock_height: Number(pox3Event.burnchain_unlock_height),
          locked_address: pox3Event.stacker,
          block_height: pox3Event.block_height,
          tx_index: pox3Event.tx_index,
          event_index: pox3Event.event_index,
        };
        return unlockEvent;
      });
    }

    // modified copy of pox2 and pox3 unlocks query
    const poxV3ForceUnlocks: StxLockEventResult[] = [];
    const generatePoxV3ForceUnlocks =
      v3UnlockHeight !== null &&
      current_burn_height > v3UnlockHeight &&
      previous_burn_height <= v3UnlockHeight;
    if (generatePoxV3ForceUnlocks) {
      const pox3EventQuery = await sql<PoxSyntheticEventQueryResult[]>`
        SELECT DISTINCT ON (stacker) stacker, ${sql(POX_SYNTHETIC_EVENT_COLUMNS)}
        FROM pox3_events
        WHERE canonical = true AND microblock_canonical = true
        AND block_height <= ${block.block_height}
        AND (
          ( name != ${SyntheticPoxEventName.HandleUnlock} AND
            burnchain_unlock_height >= ${current_burn_height})
          OR
          ( name = ${SyntheticPoxEventName.HandleUnlock} AND
            burnchain_unlock_height < ${current_burn_height})
        )
        ORDER BY stacker, block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
      `;
      for (const row of pox3EventQuery) {
        const pox3Event = parseDbPoxSyntheticEvent(row);
        if (pox3Event.name !== SyntheticPoxEventName.HandleUnlock) {
          const unlockEvent: StxLockEventResult = {
            locked_amount: pox3Event.locked.toString(),
            unlock_height: Number(pox3Event.burnchain_unlock_height),
            locked_address: pox3Event.stacker,
            block_height: pox3Event.block_height,
            tx_index: pox3Event.tx_index,
            event_index: pox3Event.event_index,
          };
          poxV3ForceUnlocks.push(unlockEvent);
        }
      }
    }

    let poxV4Unlocks: StxLockEventResult[] = [];
    const pox4EventQuery = await sql<PoxSyntheticEventQueryResult[]>`
        SELECT DISTINCT ON (stacker) stacker, ${sql(POX_SYNTHETIC_EVENT_COLUMNS)}
        FROM pox4_events
        WHERE canonical = true AND microblock_canonical = true
        AND block_height <= ${block.block_height}
        AND (
          (
            burnchain_unlock_height <= ${current_burn_height}
            AND burnchain_unlock_height > ${previous_burn_height}
            AND name IN ${sql([
              SyntheticPoxEventName.StackStx,
              SyntheticPoxEventName.StackIncrease,
              SyntheticPoxEventName.StackExtend,
              SyntheticPoxEventName.DelegateStackStx,
              SyntheticPoxEventName.DelegateStackIncrease,
              SyntheticPoxEventName.DelegateStackExtend,
            ])}
          ) OR (
            name = ${SyntheticPoxEventName.HandleUnlock}
            AND burnchain_unlock_height < ${current_burn_height}
            AND burnchain_unlock_height >= ${previous_burn_height}
          )
        )
        ORDER BY stacker, block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
      `;
    poxV4Unlocks = pox4EventQuery.map(row => {
      const pox4Event = parseDbPoxSyntheticEvent(row);
      const unlockEvent: StxLockEventResult = {
        locked_amount: pox4Event.locked.toString(),
        unlock_height: Number(pox4Event.burnchain_unlock_height),
        locked_address: pox4Event.stacker,
        block_height: pox4Event.block_height,
        tx_index: pox4Event.tx_index,
        event_index: pox4Event.event_index,
      };
      return unlockEvent;
    });

    const txIdQuery = await sql<{ tx_id: string }[]>`
      SELECT tx_id
      FROM txs
      WHERE microblock_canonical = true AND canonical = true
      AND block_height = ${block.block_height} AND (type_id = ${DbTxTypeId.Coinbase} OR type_id = ${DbTxTypeId.CoinbaseToAltRecipient})
      LIMIT 1
    `;

    const result: StxUnlockEvent[] = [];
    for (const unlocks of [
      poxV1Unlocks,
      poxV1ForceUnlocks,
      poxV2Unlocks,
      poxV2ForceUnlocks,
      poxV3Unlocks,
      poxV3ForceUnlocks,
      poxV4Unlocks,
    ]) {
      unlocks.forEach(row => {
        const unlockEvent: StxUnlockEvent = {
          unlocked_amount: row.locked_amount,
          stacker_address: row.locked_address,
          tx_id: txIdQuery[0].tx_id,
        };
        result.push(unlockEvent);
      });
    }
    return result;
  }
}
