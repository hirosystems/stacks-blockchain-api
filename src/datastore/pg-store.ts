import {
  AddressTokenOfferingLocked,
  AddressUnlockSchedule,
  TransactionType,
} from '@stacks/stacks-blockchain-api-types';
import { ChainID, ClarityAbi } from '@stacks/transactions';
import { getTxTypeId, getTxTypeString } from '../api/controllers/db-controller';
import {
  assertNotNullish,
  FoundOrNot,
  unwrapOptional,
  bnsHexValueToName,
  bnsNameCV,
  getBnsSmartContractId,
} from '../helpers';
import { PgStoreEventEmitter } from './pg-store-event-emitter';
import {
  AddressNftEventIdentifier,
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
  DbFungibleTokenMetadata,
  DbGetBlockWithMetadataOpts,
  DbGetBlockWithMetadataResponse,
  DbInboundStxTransfer,
  DbMempoolStats,
  DbMempoolTx,
  DbMicroblock,
  DbMinerReward,
  DbNftEvent,
  DbNonFungibleTokenMetadata,
  DbRewardSlotHolder,
  DbSearchResult,
  DbSmartContract,
  DbSmartContractEvent,
  DbStxBalance,
  DbStxEvent,
  DbStxLockEvent,
  DbTokenMetadataQueueEntry,
  DbTokenMetadataQueueEntryQuery,
  DbTokenOfferingLocked,
  DbTx,
  DbTxGlobalStatus,
  DbTxStatus,
  DbTxTypeId,
  DbTxWithAssetTransfers,
  FaucetRequestQueryResult,
  FungibleTokenMetadataQueryResult,
  MempoolTxQueryResult,
  MicroblockQueryResult,
  NftEventWithTxMetadata,
  NftHoldingInfo,
  NftHoldingInfoWithTxMetadata,
  NonFungibleTokenMetadataQueryResult,
  RawTxQueryResult,
  StxUnlockEvent,
  TransferQueryResult,
} from './common';
import { connectPostgres, getPgConnectionEnvValue, PgServer, PgSqlClient } from './connection';
import {
  abiColumn,
  BLOCK_COLUMNS,
  MEMPOOL_TX_COLUMNS,
  MICROBLOCK_COLUMNS,
  parseBlockQueryResult,
  parseDbEvents,
  parseFaucetRequestQueryResult,
  parseMempoolTxQueryResult,
  parseMicroblockQueryResult,
  parseQueryResultToSmartContract,
  parseTxQueryResult,
  parseTxsWithAssetTransfers,
  prefixedCols,
  TX_COLUMNS,
  unsafeCols,
  validateZonefileHash,
} from './helpers';
import { PgNotifier } from './pg-notifier';
import { AsyncLocalStorage } from 'async_hooks';

export type UnwrapPromiseArray<T> = T extends any[]
  ? {
      [k in keyof T]: T[k] extends Promise<infer R> ? R : T[k];
    }
  : T;

type SqlTransactionContext = {
  usageName: string;
  sql: PgSqlClient;
};
/**
 * AsyncLocalStorage which determines if the current async context is running inside a SQL
 * transaction.
 */
export const sqlTransactionContext = new AsyncLocalStorage<SqlTransactionContext>();

/**
 * This is the main interface between the API and the Postgres database. It contains all methods that
 * query the DB in search for blockchain data to be returned via endpoints or WebSockets/Socket.IO.
 * It also provides an `EventEmitter` to notify the rest of the API whenever an important DB write has
 * happened in the `PgServer.primary` server (see `.env`).
 */
export class PgStore {
  readonly eventEmitter: PgStoreEventEmitter;
  readonly notifier?: PgNotifier;
  protected get closeTimeout(): number {
    return parseInt(getPgConnectionEnvValue('CLOSE_TIMEOUT', PgServer.default) ?? '5');
  }

  private readonly _sql: PgSqlClient;
  /**
   * Getter for a SQL client. If used inside `sqlTransaction`, the scoped client within the current
   * async context will be returned to guarantee transaction consistency.
   */
  get sql(): PgSqlClient {
    const sqlContext = sqlTransactionContext.getStore();
    return sqlContext ? sqlContext.sql : this._sql;
  }

  constructor(sql: PgSqlClient, notifier: PgNotifier | undefined = undefined) {
    this._sql = sql;
    this.notifier = notifier;
    this.eventEmitter = new PgStoreEventEmitter();
  }

  static async connect({
    usageName,
    withNotifier = true,
  }: {
    usageName: string;
    withNotifier?: boolean;
  }): Promise<PgStore> {
    const sql = await connectPostgres({ usageName: usageName, pgServer: PgServer.default });
    const notifier = withNotifier ? await PgNotifier.create(usageName) : undefined;
    const store = new PgStore(sql, notifier);
    await store.connectPgNotifier();
    return store;
  }

  async close(): Promise<void> {
    await this.notifier?.close();
    await this.sql.end({ timeout: this.closeTimeout });
  }

  /**
   * Start a SQL transaction. If any SQL client used within the callback was already scoped inside a
   * `BEGIN` transaction, no new transaction will be opened. This flexibility allows us to avoid
   * repeating code while making sure we don't arrive at SQL errors such as
   * `WARNING: there is already a transaction in progress` which may cause result inconsistencies.
   * @param callback - Callback with a scoped SQL client
   * @param readOnly - If a `BEGIN` transaction should be marked as `READ ONLY`
   * @returns Transaction results
   */
  async sqlTransaction<T>(
    callback: (sql: PgSqlClient) => T | Promise<T>,
    readOnly = true
  ): Promise<UnwrapPromiseArray<T>> {
    // Do we have a scoped client already? Use it directly.
    const sqlContext = sqlTransactionContext.getStore();
    if (sqlContext) {
      return callback(sqlContext.sql) as UnwrapPromiseArray<T>;
    }
    // Otherwise, start a transaction and store the scoped connection in the current async context.
    const usageName = this._sql.options.connection.application_name ?? '';
    return this._sql.begin(readOnly ? 'read only' : 'read write', sql => {
      return sqlTransactionContext.run({ usageName, sql }, () => callback(sql));
    });
  }

  /**
   * Get `application_name` for current connection (each connection has a unique PID)
   */
  async getConnectionApplicationName(): Promise<string> {
    const result = await this.sql<{ application_name: string }[]>`
      SELECT application_name FROM pg_stat_activity WHERE pid = pg_backend_pid()
    `;
    return result[0].application_name;
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
      }
    });
  }

  async getChainTip(
    sql: PgSqlClient
  ): Promise<{ blockHeight: number; blockHash: string; indexBlockHash: string }> {
    const currentTipBlock = await sql<
      {
        block_height: number;
        block_hash: string;
        index_block_hash: string;
      }[]
    >`SELECT block_height, block_hash, index_block_hash FROM chain_tip`;
    const height = currentTipBlock[0]?.block_height ?? 0;
    return {
      blockHeight: height,
      blockHash: currentTipBlock[0]?.block_hash ?? '',
      indexBlockHash: currentTipBlock[0]?.index_block_hash ?? '',
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
          ORDER BY microblock_sequence DESC
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

  async getUnanchoredChainTip(): Promise<FoundOrNot<DbChainTip>> {
    const result = await this.sql<
      {
        block_height: number;
        index_block_hash: string;
        block_hash: string;
        microblock_hash: string | null;
        microblock_sequence: number | null;
      }[]
    >`SELECT block_height, index_block_hash, block_hash, microblock_hash, microblock_sequence
      FROM chain_tip`;
    if (result.length === 0) {
      return { found: false } as const;
    }
    const row = result[0];
    const chainTipResult: DbChainTip = {
      blockHeight: row.block_height,
      indexBlockHash: row.index_block_hash,
      blockHash: row.block_hash,
      microblockHash: row.microblock_hash === null ? undefined : row.microblock_hash,
      microblockSequence: row.microblock_sequence === null ? undefined : row.microblock_sequence,
    };
    return { found: true, result: chainTipResult };
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
      SELECT ${sql(BLOCK_COLUMNS)}
      FROM blocks b
      INNER JOIN chain_tip t USING (index_block_hash, block_hash, block_height)
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
    const { blockHeight } = await this.getChainTip(sql);
    const unanchoredBlockHeight = blockHeight + 1;
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

  async getAddressNonces(args: {
    stxAddress: string;
  }): Promise<{
    lastExecutedTxNonce: number | null;
    lastMempoolTxNonce: number | null;
    possibleNextNonce: number;
    detectedMissingNonces: number[];
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
          const mempoolNonceArr = mempoolNonces.map(r => r.nonce);
          expectedNonces.forEach(nonce => {
            if (!mempoolNonceArr.includes(nonce)) {
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
        coinbase_amount: number;
        tx_fees_anchored: number;
        tx_fees_streamed_confirmed: number;
        tx_fees_streamed_produced: number;
      }[]
    >`
      SELECT id, mature_block_height, recipient, block_hash, index_block_hash, from_index_block_hash,
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

    const txTypes = [
      DbTxTypeId.TokenTransfer,
      DbTxTypeId.SmartContract,
      DbTxTypeId.ContractCall,
      DbTxTypeId.PoisonMicroblock,
    ];

    const txTypeCountsQuery = await sql<{ type_id: DbTxTypeId; count: number }[]>`
      SELECT
        type_id,
        count(*)::integer count
      FROM mempool_txs
      WHERE pruned = false
      ${blockHeightCondition}
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
      SELECT
        type_id,
        percentile_cont(0.25) within group (order by fee_rate asc) as p25,
        percentile_cont(0.50) within group (order by fee_rate asc) as p50,
        percentile_cont(0.75) within group (order by fee_rate asc) as p75,
        percentile_cont(0.95) within group (order by fee_rate asc) as p95
      FROM mempool_txs
      WHERE pruned = false
      ${blockHeightCondition}
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
          type_id,
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
          type_id, tx_size
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

  async getMempoolTxList({
    limit,
    offset,
    includeUnanchored,
    senderAddress,
    recipientAddress,
    address,
  }: {
    limit: number;
    offset: number;
    includeUnanchored: boolean;
    senderAddress?: string;
    recipientAddress?: string;
    address?: string;
  }): Promise<{ results: DbMempoolTx[]; total: number }> {
    const queryResult = await this.sqlTransaction(async sql => {
      // If caller did not opt-in to unanchored tx data, then treat unanchored txs as pending mempool txs.
      const unanchoredTxs: string[] = !includeUnanchored
        ? (await this.getUnanchoredTxsInternal(sql)).txs.map(tx => tx.tx_id)
        : [];
      const resultQuery = await sql<(MempoolTxQueryResult & { count: number })[]>`
        SELECT ${unsafeCols(sql, [
          ...MEMPOOL_TX_COLUMNS,
          abiColumn('mempool_txs'),
          '(COUNT(*) OVER())::INTEGER AS count',
        ])}
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
        ORDER BY receipt_time DESC
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
    const result = await this.sql<{ digest: string }[]>`SELECT digest FROM mempool_digest`;
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
    const chainTip = await this.getChainTip(sql);
    if (includeUnanchored) {
      return chainTip.blockHeight + 1;
    } else {
      return chainTip.blockHeight;
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
        const txTypeIds = txTypeFilter.map<number>(t => getTxTypeId(t));
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
        }[]
      >`
        SELECT
          event_index, tx_id, tx_index, block_height, canonical, locked_amount, unlock_height, locked_address
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
        }[]
      >`
        SELECT
          event_index, tx_id, tx_index, block_height, canonical, asset_event_type_id, sender, recipient, amount
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
        }[]
      >`
        SELECT
          event_index, tx_id, tx_index, block_height, canonical, locked_amount, unlock_height, locked_address
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
        }[]
      >`
        SELECT
          event_index, tx_id, tx_index, block_height, canonical, asset_event_type_id, sender, recipient, amount
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
      const emptyEvents = sql`SELECT NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL`;
      const eventsResult = await sql<
        {
          tx_id: string;
          event_index: number;
          tx_index: number;
          block_height: number;
          sender: string;
          recipient: string;
          amount: number;
          unlock_height: number;
          asset_identifier: string;
          contract_identifier: string;
          topic: string;
          value: string;
          event_type_id: number;
          asset_event_type_id: number;
        }[]
      >`
        WITH events AS (
          ${
            args.eventTypeFilter.includes(DbEventTypeId.StxLock)
              ? sql`
                SELECT
                  tx_id, event_index, tx_index, block_height, locked_address as sender, NULL as recipient,
                  locked_amount as amount, unlock_height, NULL as asset_identifier, NULL as contract_identifier,
                  '0'::bytea as value, NULL as topic,
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
                  '0'::bytea as value, NULL as topic,
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
                  '0'::bytea as value, NULL as topic,
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
                  value, NULL as topic,
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
                  value, topic,
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
          };
          return event;
        });
      }
      return {
        results: events,
      };
    });
  }

  /**
   * Returns a single entry from the `token_metadata_queue` table.
   * @param queueId - queue entry id
   */
  async getTokenMetadataQueueEntry(
    queueId: number
  ): Promise<FoundOrNot<DbTokenMetadataQueueEntry>> {
    const result = await this.sql<DbTokenMetadataQueueEntryQuery[]>`
      SELECT * FROM token_metadata_queue WHERE queue_id = ${queueId}
    `;
    if (result.length === 0) {
      return { found: false };
    }
    const row = result[0];
    const entry: DbTokenMetadataQueueEntry = {
      queueId: row.queue_id,
      txId: row.tx_id,
      contractId: row.contract_id,
      contractAbi: JSON.parse(row.contract_abi),
      blockHeight: row.block_height,
      processed: row.processed,
      retry_count: row.retry_count,
    };
    return { found: true, result: entry };
  }

  async getTokenMetadataQueue(
    limit: number,
    excludingEntries: number[]
  ): Promise<DbTokenMetadataQueueEntry[]> {
    const result = await this.sql<DbTokenMetadataQueueEntryQuery[]>`
      SELECT *
      FROM token_metadata_queue
      WHERE ${
        excludingEntries.length
          ? this.sql`NOT (queue_id IN ${this.sql(excludingEntries)})`
          : this.sql`TRUE`
      }
      AND processed = false
      ORDER BY block_height ASC, queue_id ASC
      LIMIT ${limit}
    `;
    const entries = result.map(row => {
      const entry: DbTokenMetadataQueueEntry = {
        queueId: row.queue_id,
        txId: row.tx_id,
        contractId: row.contract_id,
        contractAbi: JSON.parse(row.contract_abi),
        blockHeight: row.block_height,
        processed: row.processed,
        retry_count: row.retry_count,
      };
      return entry;
    });
    return entries;
  }

  async getSmartContract(contractId: string) {
    const result = await this.sql<
      {
        tx_id: string;
        canonical: boolean;
        contract_id: string;
        block_height: number;
        source_code: string;
        abi: unknown | null;
      }[]
    >`
      SELECT tx_id, canonical, contract_id, block_height, source_code, abi
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
        source_code: string;
        abi: unknown | null;
      }[]
    >`
      SELECT tx_id, canonical, contract_id, block_height, source_code, abi
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
      const chainTip = await this.getChainTip(sql);
      const blockHeightToQuery =
        blockHeight > chainTip.blockHeight ? chainTip.blockHeight : blockHeight;
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
      AND block_height <= ${blockHeight} AND unlock_height > ${burnBlockHeight}
    `;
    let lockTxId: string = '';
    let locked: bigint = 0n;
    let lockHeight = 0;
    let burnchainLockHeight = 0;
    let burnchainUnlockHeight = 0;
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
      lockTxId: lockTxId,
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
      return { stx: BigInt(result[0].amount), blockHeight: atBlockHeight };
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
        unlock_height?: string;
        value?: string;
      } & { count: number })[]
    >`
      SELECT *, (COUNT(*) OVER())::INTEGER AS count
      FROM(
        SELECT
          'stx_lock' as asset_type, event_index, tx_id, microblock_sequence, tx_index, block_height, canonical, 0 as asset_event_type_id,
          locked_address as sender, '' as recipient, '<stx>' as asset_identifier, locked_amount as amount, unlock_height, null::bytea as value
        FROM stx_lock_events
        WHERE canonical = true AND microblock_canonical = true AND locked_address = ${stxAddress} AND block_height <= ${blockHeight}
        UNION ALL
        SELECT
          'stx' as asset_type, event_index, tx_id, microblock_sequence, tx_index, block_height, canonical, asset_event_type_id,
          sender, recipient, '<stx>' as asset_identifier, amount::numeric, null::numeric as unlock_height, null::bytea as value
        FROM stx_events
        WHERE canonical = true AND microblock_canonical = true AND (sender = ${stxAddress} OR recipient = ${stxAddress}) AND block_height <= ${blockHeight}
        UNION ALL
        SELECT
          'ft' as asset_type, event_index, tx_id, microblock_sequence, tx_index, block_height, canonical, asset_event_type_id,
          sender, recipient, asset_identifier, amount, null::numeric as unlock_height, null::bytea as value
        FROM ft_events
        WHERE canonical = true AND microblock_canonical = true AND (sender = ${stxAddress} OR recipient = ${stxAddress}) AND block_height <= ${blockHeight}
        UNION ALL
        SELECT
          'nft' as asset_type, event_index, tx_id, microblock_sequence, tx_index, block_height, canonical, asset_event_type_id,
          sender, recipient, asset_identifier, null::numeric as amount, null::numeric as unlock_height, value
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

  /**
   * @deprecated Use `getNftHoldings` instead.
   */
  async getAddressNFTEvent(args: {
    stxAddress: string;
    limit: number;
    offset: number;
    blockHeight: number;
    includeUnanchored: boolean;
  }): Promise<{ results: AddressNftEventIdentifier[]; total: number }> {
    // Join against `nft_custody` materialized view only if we're looking for canonical results.
    const result = await this.sql<(AddressNftEventIdentifier & { count: number })[]>`
      WITH address_transfers AS (
        SELECT asset_identifier, value, sender, recipient, block_height, microblock_sequence, tx_index, event_index, tx_id, asset_event_type_id
        FROM nft_events
        WHERE canonical = true AND microblock_canonical = true
        AND recipient = ${args.stxAddress} AND block_height <= ${args.blockHeight}
      ),
      last_nft_transfers AS (
        SELECT DISTINCT ON(asset_identifier, value) asset_identifier, value, recipient
        FROM nft_events
        WHERE canonical = true AND microblock_canonical = true
        AND block_height <= ${args.blockHeight}
        ORDER BY asset_identifier, value, block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
      )
      SELECT sender, recipient, asset_identifier, value, event_index, asset_event_type_id, address_transfers.block_height, address_transfers.tx_id, (COUNT(*) OVER())::INTEGER AS count
      FROM address_transfers
      INNER JOIN ${args.includeUnanchored ? this.sql`last_nft_transfers` : this.sql`nft_custody`}
        USING (asset_identifier, value, recipient)
      ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
      LIMIT ${args.limit} OFFSET ${args.offset}
    `;

    const count = result.length > 0 ? result[0].count : 0;

    const nftEvents = result.map(row => ({
      sender: row.sender,
      recipient: row.recipient,
      asset_identifier: row.asset_identifier,
      value: row.value,
      block_height: row.block_height,
      tx_id: row.tx_id,
      event_index: row.event_index,
      asset_event_type_id: row.asset_event_type_id,
      tx_index: row.tx_index,
    }));

    return { results: nftEvents, total: count };
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
        SELECT DISTINCT ON (name) name
        FROM names
        WHERE namespace_id = ${namespace}
        AND registered_at <= ${maxBlockHeight}
        AND canonical = true AND microblock_canonical = true
        ORDER BY name, registered_at DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
        LIMIT 100
        OFFSET ${offset}
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
    chainId,
  }: {
    name: string;
    includeUnanchored: boolean;
    chainId: ChainID;
  }): Promise<FoundOrNot<DbBnsName & { index_block_hash: string }>> {
    const queryResult = await this.sqlTransaction(async sql => {
      const maxBlockHeight = await this.getMaxBlockHeight(sql, { includeUnanchored });
      const nameZonefile = await sql<(DbBnsName & { tx_id: string; index_block_hash: string })[]>`
        SELECT n.*, z.zonefile
        FROM names AS n
        LEFT JOIN zonefiles AS z USING (name, tx_id, index_block_hash)
        WHERE n.name = ${name}
          AND n.registered_at <= ${maxBlockHeight}
          AND n.canonical = true
          AND n.microblock_canonical = true
        ORDER BY n.registered_at DESC,
          n.microblock_sequence DESC,
          n.tx_index DESC,
          n.event_index DESC
        LIMIT 1
      `;
      if (nameZonefile.length === 0) {
        return;
      }
      return nameZonefile[0];
    });
    if (queryResult) {
      return {
        found: true,
        result: {
          ...queryResult,
          tx_id: queryResult.tx_id,
          index_block_hash: queryResult.index_block_hash,
        },
      };
    }
    return { found: false } as const;
  }

  async getHistoricalZoneFile(args: {
    name: string;
    zoneFileHash: string;
    includeUnanchored: boolean;
  }): Promise<FoundOrNot<DbBnsZoneFile>> {
    const queryResult = await this.sqlTransaction(async sql => {
      const maxBlockHeight = await this.getMaxBlockHeight(sql, {
        includeUnanchored: args.includeUnanchored,
      });
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
      // 1. Get subdomains owned by this address.
      // These don't produce NFT events so we have to look directly at the `subdomains` table.
      const subdomainsQuery = await sql<{ fully_qualified_subdomain: string }[]>`
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
          fully_qualified_subdomain
        FROM
          subdomains
          INNER JOIN addr_subdomains USING (fully_qualified_subdomain)
        WHERE
          canonical = TRUE
          AND microblock_canonical = TRUE
        ORDER BY
          fully_qualified_subdomain
      `;
      // 2. Get names owned by this address which were imported from Blockstack v1.
      // These also don't have an associated NFT event so we have to look directly at the `names` table,
      // however, we'll also check if any of these names are still owned by the same user.
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
      // 3. Get newer NFT names owned by this address.
      const nftNamesQuery = await sql<{ value: string }[]>`
        SELECT value
        FROM ${includeUnanchored ? sql`nft_custody_unanchored` : sql`nft_custody`}
        WHERE recipient = ${address} AND asset_identifier = ${getBnsSmartContractId(chainId)}
      `;
      const results: Set<string> = new Set([
        ...subdomainsQuery.map(i => i.fully_qualified_subdomain),
        ...importedNamesQuery.map(i => i.name).filter(i => !oldImportedNames.includes(i)),
        ...nftNamesQuery.map(i => bnsHexValueToName(i.value)),
      ]);
      return Array.from(results.values()).sort();
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
  }: {
    name: string;
    includeUnanchored: boolean;
  }): Promise<{ results: string[] }> {
    const queryResult = await this.sqlTransaction(async sql => {
      const maxBlockHeight = await this.getMaxBlockHeight(sql, { includeUnanchored });
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
        SELECT DISTINCT ON (name) name
        FROM names
        WHERE canonical = true AND microblock_canonical = true
        AND registered_at <= ${maxBlockHeight}
        ORDER BY name, registered_at DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
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
  }: {
    subdomain: string;
    includeUnanchored: boolean;
  }): Promise<FoundOrNot<DbBnsSubdomain & { index_block_hash: string }>> {
    const queryResult = await this.sqlTransaction(async sql => {
      const maxBlockHeight = await this.getMaxBlockHeight(sql, { includeUnanchored });
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

    const lockQuery = await sql<
      {
        locked_amount: string;
        unlock_height: string;
        locked_address: string;
        tx_id: string;
      }[]
    >`
      SELECT locked_amount, unlock_height, locked_address
      FROM stx_lock_events
      WHERE microblock_canonical = true AND canonical = true
      AND unlock_height <= ${current_burn_height} AND unlock_height > ${previous_burn_height}
    `;

    const txIdQuery = await sql<{ tx_id: string }[]>`
      SELECT tx_id
      FROM txs
      WHERE microblock_canonical = true AND canonical = true
      AND block_height = ${block.block_height} AND type_id = ${DbTxTypeId.Coinbase}
      LIMIT 1
    `;

    const result: StxUnlockEvent[] = [];
    lockQuery.forEach(row => {
      const unlockEvent: StxUnlockEvent = {
        unlock_height: row.unlock_height,
        unlocked_amount: row.locked_amount,
        stacker_address: row.locked_address,
        tx_id: txIdQuery[0].tx_id,
      };
      result.push(unlockEvent);
    });

    return result;
  }

  async getStxUnlockHeightAtTransaction(txId: string): Promise<FoundOrNot<number>> {
    const lockQuery = await this.sql<{ unlock_height: number }[]>`
      SELECT unlock_height
      FROM stx_lock_events
      WHERE canonical = true AND tx_id = ${txId}
    `;
    if (lockQuery.length > 0) {
      return { found: true, result: lockQuery[0].unlock_height };
    }
    return { found: false };
  }

  async getFtMetadata(contractId: string): Promise<FoundOrNot<DbFungibleTokenMetadata>> {
    const queryResult = await this.sql<FungibleTokenMetadataQueryResult[]>`
      SELECT token_uri, name, description, image_uri, image_canonical_uri, symbol, decimals, contract_id, tx_id, sender_address
      FROM ft_metadata
      WHERE contract_id = ${contractId}
      LIMIT 1
    `;
    if (queryResult.length > 0) {
      const metadata: DbFungibleTokenMetadata = {
        token_uri: queryResult[0].token_uri,
        name: queryResult[0].name,
        description: queryResult[0].description,
        image_uri: queryResult[0].image_uri,
        image_canonical_uri: queryResult[0].image_canonical_uri,
        symbol: queryResult[0].symbol,
        decimals: queryResult[0].decimals,
        contract_id: queryResult[0].contract_id,
        tx_id: queryResult[0].tx_id,
        sender_address: queryResult[0].sender_address,
      };
      return {
        found: true,
        result: metadata,
      };
    } else {
      return { found: false } as const;
    }
  }

  async getNftMetadata(contractId: string): Promise<FoundOrNot<DbNonFungibleTokenMetadata>> {
    const queryResult = await this.sql<NonFungibleTokenMetadataQueryResult[]>`
      SELECT token_uri, name, description, image_uri, image_canonical_uri, contract_id, tx_id, sender_address
      FROM nft_metadata
      WHERE contract_id = ${contractId}
      LIMIT 1
    `;
    if (queryResult.length > 0) {
      const metadata: DbNonFungibleTokenMetadata = {
        token_uri: queryResult[0].token_uri,
        name: queryResult[0].name,
        description: queryResult[0].description,
        image_uri: queryResult[0].image_uri,
        image_canonical_uri: queryResult[0].image_canonical_uri,
        contract_id: queryResult[0].contract_id,
        tx_id: queryResult[0].tx_id,
        sender_address: queryResult[0].sender_address,
      };
      return {
        found: true,
        result: metadata,
      };
    } else {
      return { found: false } as const;
    }
  }

  async getFtMetadataList({
    limit,
    offset,
  }: {
    limit: number;
    offset: number;
  }): Promise<{ results: DbFungibleTokenMetadata[]; total: number }> {
    return await this.sqlTransaction(async sql => {
      const totalQuery = await sql<{ count: number }[]>`
        SELECT COUNT(*)::integer
        FROM ft_metadata
      `;
      const resultQuery = await sql<FungibleTokenMetadataQueryResult[]>`
        SELECT *
        FROM ft_metadata
        LIMIT ${limit}
        OFFSET ${offset}
      `;
      const parsed = resultQuery.map(r => {
        const metadata: DbFungibleTokenMetadata = {
          name: r.name,
          description: r.description,
          token_uri: r.token_uri,
          image_uri: r.image_uri,
          image_canonical_uri: r.image_canonical_uri,
          decimals: r.decimals,
          symbol: r.symbol,
          contract_id: r.contract_id,
          tx_id: r.tx_id,
          sender_address: r.sender_address,
        };
        return metadata;
      });
      return { results: parsed, total: totalQuery[0].count };
    });
  }

  async getNftMetadataList({
    limit,
    offset,
  }: {
    limit: number;
    offset: number;
  }): Promise<{ results: DbNonFungibleTokenMetadata[]; total: number }> {
    return await this.sqlTransaction(async sql => {
      const totalQuery = await sql<{ count: number }[]>`
        SELECT COUNT(*)::integer
        FROM nft_metadata
      `;
      const resultQuery = await sql<FungibleTokenMetadataQueryResult[]>`
        SELECT *
        FROM nft_metadata
        LIMIT ${limit}
        OFFSET ${offset}
      `;
      const parsed = resultQuery.map(r => {
        const metadata: DbNonFungibleTokenMetadata = {
          name: r.name,
          description: r.description,
          token_uri: r.token_uri,
          image_uri: r.image_uri,
          image_canonical_uri: r.image_canonical_uri,
          contract_id: r.contract_id,
          tx_id: r.tx_id,
          sender_address: r.sender_address,
        };
        return metadata;
      });
      return { results: parsed, total: totalQuery[0].count };
    });
  }
}
