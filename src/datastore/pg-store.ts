import {
  AddressTokenOfferingLocked,
  AddressUnlockSchedule,
  TransactionType,
} from '@stacks/stacks-blockchain-api-types';
import { ClarityAbi } from '@stacks/transactions';
import { ClientBase, Pool, QueryResult } from 'pg';
import { getTxTypeId } from '../api/controllers/db-controller';
import {
  assertNotNullish,
  bufferToHexPrefixString,
  FoundOrNot,
  hexToBuffer,
  logError,
  logger,
  unwrapOptional,
} from '../helpers';
import { ChainEventEmitter } from './chain-event-emitter';
import {
  AddressNftEventIdentifier,
  BlockIdentifier,
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
  DbFaucetRequest,
  DbFtBalance,
  DbFtEvent,
  DbFungibleTokenMetadata,
  DbGetBlockWithMetadataOpts,
  DbGetBlockWithMetadataResponse,
  DbInboundStxTransfer,
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
  DbTokenOfferingLocked,
  DbTx,
  DbTxStatus,
  DbTxTypeId,
  DbTxWithAssetTransfers,
  NftEventWithTxMetadata,
  NftHoldingInfo,
  NftHoldingInfoWithTxMetadata,
  StxUnlockEvent,
} from './common';
import { connectPgPool, connectWithRetry, PgServer } from './connection';
import {
  abiColumn,
  BlockQueryResult,
  BLOCK_COLUMNS,
  ContractTxQueryResult,
  countOverColumn,
  DbTokenMetadataQueueEntryQuery,
  FaucetRequestQueryResult,
  FungibleTokenMetadataQueryResult,
  getSqlQueryString,
  MempoolTxQueryResult,
  MEMPOOL_TX_COLUMNS,
  MicroblockQueryResult,
  MICROBLOCK_COLUMNS,
  NonFungibleTokenMetadataQueryResult,
  parseBlockQueryResult,
  parseDbEvents,
  parseFaucetRequestQueryResult,
  parseMempoolTxQueryResult,
  parseMicroblockQueryResult,
  parseQueryResultToSmartContract,
  parseTxQueryResult,
  RawTxQueryResult,
  SQL_QUERY_LEAK_DETECTION,
  TransferQueryResult,
  txColumns,
  TxQueryResult,
  TX_COLUMNS,
  validateZonefileHash,
} from './helpers';

export class PgStore {
  readonly eventReplay: boolean;
  readonly pool: Pool;
  readonly eventEmitter: ChainEventEmitter;

  constructor(pool: Pool, eventReplay: boolean = false) {
    this.pool = pool;
    this.eventReplay = eventReplay;
    this.eventEmitter = new ChainEventEmitter();
  }

  static async connect({
    usageName,
    eventReplay = false,
  }: {
    usageName: string;
    eventReplay?: boolean;
  }): Promise<PgStore> {
    const pool = await connectPgPool({ usageName: usageName, pgServer: PgServer.default });
    return new PgStore(pool, eventReplay);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async getConnectionApplicationName(): Promise<string> {
    const statResult = await this.query(async client => {
      const result = await client.query<{ application_name: string }>(
        // Get `application_name` for current connection (each connection has a unique PID)
        'select application_name from pg_stat_activity WHERE pid = pg_backend_pid()'
      );
      return result.rows[0].application_name;
    });
    return statResult;
  }

  /**
   * Execute queries against the connection pool.
   */
  async query<T>(cb: (client: ClientBase) => Promise<T>): Promise<T> {
    const client = await connectWithRetry(this.pool);
    try {
      if (SQL_QUERY_LEAK_DETECTION) {
        // Monkey patch in some query leak detection. Taken from the lib's docs:
        // https://node-postgres.com/guides/project-structure
        // eslint-disable-next-line @typescript-eslint/unbound-method
        const query = client.query;
        // eslint-disable-next-line @typescript-eslint/unbound-method
        const release = client.release;
        const lastQueries: any[] = [];
        const timeout = setTimeout(() => {
          const queries = lastQueries.map(q => getSqlQueryString(q));
          logger.error(`Pg client has been checked out for more than 5 seconds`);
          logger.error(`Last query: ${queries.join('|')}`);
        }, 5000);
        // @ts-expect-error hacky typing
        client.query = (...args) => {
          lastQueries.push(args[0]);
          // @ts-expect-error hacky typing
          return query.apply(client, args);
        };
        client.release = () => {
          clearTimeout(timeout);
          client.query = query;
          client.release = release;
          return release.apply(client);
        };
      }
      const result = await cb(client);
      return result;
    } finally {
      client.release();
    }
  }

  /**
   * Execute queries within a sql transaction.
   */
  async queryTx<T>(cb: (client: ClientBase) => Promise<T>): Promise<T> {
    return await this.query(async client => {
      try {
        await client.query('BEGIN');
        const result = await cb(client);
        await client.query('COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  async getChainTip(
    client: ClientBase
  ): Promise<{ blockHeight: number; blockHash: string; indexBlockHash: string }> {
    const currentTipBlock = await client.query<{
      block_height: number;
      block_hash: Buffer;
      index_block_hash: Buffer;
    }>(
      // The `chain_tip` materialized view is not available during event replay.
      // Since `getChainTip()` is used heavily during event ingestion, we'll fall back to
      // a classic query.
      this.eventReplay
        ? `
          SELECT block_height, block_hash, index_block_hash
          FROM blocks
          WHERE canonical = true AND block_height = (SELECT MAX(block_height) FROM blocks)
          `
        : `SELECT block_height, block_hash, index_block_hash FROM chain_tip`
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

  async getTxStrict(args: { txId: string; indexBlockHash: string }): Promise<FoundOrNot<DbTx>> {
    return this.query(async client => {
      const result = await client.query<ContractTxQueryResult>(
        `
        SELECT ${TX_COLUMNS}, ${abiColumn()}
        FROM txs
        WHERE tx_id = $1 AND index_block_hash = $2
        ORDER BY canonical DESC, microblock_canonical DESC, block_height DESC
        LIMIT 1
        `,
        [hexToBuffer(args.txId), hexToBuffer(args.indexBlockHash)]
      );
      if (result.rowCount === 0) {
        return { found: false } as const;
      }
      const row = result.rows[0];
      const tx = parseTxQueryResult(row);
      return { found: true, result: tx };
    });
  }

  async getBlockWithMetadata<TWithTxs extends boolean, TWithMicroblocks extends boolean>(
    blockIdentifer: BlockIdentifier,
    metadata?: DbGetBlockWithMetadataOpts<TWithTxs, TWithMicroblocks>
  ): Promise<FoundOrNot<DbGetBlockWithMetadataResponse<TWithTxs, TWithMicroblocks>>> {
    return await this.queryTx(async client => {
      const block = await this.getBlockInternal(client, blockIdentifer);
      if (!block.found) {
        return { found: false };
      }
      let txs: DbTx[] | null = null;
      let microblocksAccepted: DbMicroblock[] | null = null;
      let microblocksStreamed: DbMicroblock[] | null = null;
      if (metadata?.txs) {
        const txQuery = await client.query<ContractTxQueryResult>(
          `
          SELECT ${TX_COLUMNS}, ${abiColumn()}
          FROM txs
          WHERE index_block_hash = $1 AND canonical = true AND microblock_canonical = true
          ORDER BY microblock_sequence DESC, tx_index DESC
          `,
          [hexToBuffer(block.result.index_block_hash)]
        );
        txs = txQuery.rows.map(r => parseTxQueryResult(r));
      }
      if (metadata?.microblocks) {
        const microblocksQuery = await client.query<MicroblockQueryResult>(
          `
          SELECT ${MICROBLOCK_COLUMNS}
          FROM microblocks
          WHERE parent_index_block_hash IN ($1, $2)
          AND microblock_canonical = true
          ORDER BY microblock_sequence DESC
          `,
          [
            hexToBuffer(block.result.index_block_hash),
            hexToBuffer(block.result.parent_index_block_hash),
          ]
        );
        const parsedMicroblocks = microblocksQuery.rows.map(r => parseMicroblockQueryResult(r));
        microblocksAccepted = parsedMicroblocks.filter(
          mb => mb.parent_index_block_hash === block.result.parent_index_block_hash
        );
        microblocksStreamed = parsedMicroblocks.filter(
          mb => mb.parent_index_block_hash === block.result.index_block_hash
        );
      }
      type ResultType = DbGetBlockWithMetadataResponse<TWithTxs, TWithMicroblocks>;
      const result: ResultType = {
        block: block.result,
        txs: txs as ResultType['txs'],
        microblocks: {
          accepted: microblocksAccepted,
          streamed: microblocksStreamed,
        } as ResultType['microblocks'],
      };
      return {
        found: true,
        result: result,
      };
    });
  }

  async getUnanchoredChainTip(): Promise<FoundOrNot<DbChainTip>> {
    return await this.queryTx(async client => {
      const result = await client.query<{
        block_height: number;
        index_block_hash: Buffer;
        block_hash: Buffer;
        microblock_hash: Buffer | null;
        microblock_sequence: number | null;
      }>(
        `
        SELECT block_height, index_block_hash, block_hash, microblock_hash, microblock_sequence
        FROM chain_tip
        `
      );
      if (result.rowCount === 0) {
        return { found: false } as const;
      }
      const row = result.rows[0];
      const chainTipResult: DbChainTip = {
        blockHeight: row.block_height,
        indexBlockHash: bufferToHexPrefixString(row.index_block_hash),
        blockHash: bufferToHexPrefixString(row.block_hash),
        microblockHash:
          row.microblock_hash === null ? undefined : bufferToHexPrefixString(row.microblock_hash),
        microblockSequence: row.microblock_sequence === null ? undefined : row.microblock_sequence,
      };
      return { found: true, result: chainTipResult };
    });
  }

  getBlock(blockIdentifer: BlockIdentifier): Promise<FoundOrNot<DbBlock>> {
    return this.query(client => this.getBlockInternal(client, blockIdentifer));
  }

  async getBlockInternal(
    client: ClientBase,
    blockIdentifer: BlockIdentifier
  ): Promise<FoundOrNot<DbBlock>> {
    let result: QueryResult<BlockQueryResult>;
    if ('hash' in blockIdentifer) {
      result = await client.query<BlockQueryResult>(
        `
        SELECT ${BLOCK_COLUMNS}
        FROM blocks
        WHERE block_hash = $1
        ORDER BY canonical DESC, block_height DESC
        LIMIT 1
        `,
        [hexToBuffer(blockIdentifer.hash)]
      );
    } else if ('height' in blockIdentifer) {
      result = await client.query<BlockQueryResult>(
        `
        SELECT ${BLOCK_COLUMNS}
        FROM blocks
        WHERE block_height = $1
        ORDER BY canonical DESC
        LIMIT 1
        `,
        [blockIdentifer.height]
      );
    } else if ('burnBlockHash' in blockIdentifer) {
      result = await client.query<BlockQueryResult>(
        `
        SELECT ${BLOCK_COLUMNS}
        FROM blocks
        WHERE burn_block_hash = $1
        ORDER BY canonical DESC, block_height DESC
        LIMIT 1
        `,
        [hexToBuffer(blockIdentifer.burnBlockHash)]
      );
    } else {
      result = await client.query<BlockQueryResult>(
        `
        SELECT ${BLOCK_COLUMNS}
        FROM blocks
        WHERE burn_block_height = $1
        ORDER BY canonical DESC, block_height DESC
        LIMIT 1
        `,
        [blockIdentifer.burnBlockHeight]
      );
    }

    if (result.rowCount === 0) {
      return { found: false } as const;
    }
    const row = result.rows[0];
    const block = parseBlockQueryResult(row);
    return { found: true, result: block } as const;
  }

  async getBlockByHeightInternal(client: ClientBase, blockHeight: number) {
    const result = await client.query<BlockQueryResult>(
      `
      SELECT ${BLOCK_COLUMNS}
      FROM blocks
      WHERE block_height = $1 AND canonical = true
      `,
      [blockHeight]
    );
    if (result.rowCount === 0) {
      return { found: false } as const;
    }
    const row = result.rows[0];
    const block = parseBlockQueryResult(row);
    return { found: true, result: block } as const;
  }

  async getCurrentBlock() {
    return this.query(async client => {
      return this.getCurrentBlockInternal(client);
    });
  }

  async getCurrentBlockHeight(): Promise<FoundOrNot<number>> {
    return this.query(async client => {
      const result = await client.query<{ block_height: number }>(
        `SELECT block_height FROM chain_tip`
      );
      if (result.rowCount === 0) {
        return { found: false } as const;
      }
      const row = result.rows[0];
      return { found: true, result: row.block_height } as const;
    });
  }

  async getCurrentBlockInternal(client: ClientBase) {
    const result = await client.query<BlockQueryResult>(
      `
      SELECT ${BLOCK_COLUMNS}
      FROM blocks
      WHERE canonical = true
      ORDER BY block_height DESC
      LIMIT 1
      `
    );
    if (result.rowCount === 0) {
      return { found: false } as const;
    }
    const row = result.rows[0];
    const block = parseBlockQueryResult(row);
    return { found: true, result: block } as const;
  }

  async getBlocks({ limit, offset }: { limit: number; offset: number }) {
    return this.queryTx(async client => {
      const total = await client.query<{ count: number }>(`
        SELECT block_count AS count FROM chain_tip
      `);
      const results = await client.query<BlockQueryResult>(
        `
        SELECT ${BLOCK_COLUMNS}
        FROM blocks
        WHERE canonical = true
        ORDER BY block_height DESC
        LIMIT $1
        OFFSET $2
        `,
        [limit, offset]
      );
      const parsed = results.rows.map(r => parseBlockQueryResult(r));
      return { results: parsed, total: total.rows[0].count } as const;
    });
  }

  async getBlockTxs(indexBlockHash: string) {
    return this.query(async client => {
      const result = await client.query<{ tx_id: Buffer; tx_index: number }>(
        `
        SELECT tx_id, tx_index
        FROM txs
        WHERE index_block_hash = $1 AND canonical = true AND microblock_canonical = true
        `,
        [hexToBuffer(indexBlockHash)]
      );
      const txIds = result.rows
        .sort(tx => tx.tx_index)
        .map(tx => bufferToHexPrefixString(tx.tx_id));
      return { results: txIds };
    });
  }

  async getBlockTxsRows(blockHash: string) {
    return this.queryTx(async client => {
      const blockQuery = await this.getBlockInternal(client, { hash: blockHash });
      if (!blockQuery.found) {
        throw new Error(`Could not find block by hash ${blockHash}`);
      }
      const result = await client.query<ContractTxQueryResult>(
        `
        -- getBlockTxsRows
        SELECT ${TX_COLUMNS}, ${abiColumn()}
        FROM txs
        WHERE index_block_hash = $1 AND canonical = true AND microblock_canonical = true
        ORDER BY microblock_sequence ASC, tx_index ASC
        `,
        [hexToBuffer(blockQuery.result.index_block_hash)]
      );
      if (result.rowCount === 0) {
        return { found: false } as const;
      }
      const parsed = result.rows.map(r => parseTxQueryResult(r));
      return { found: true, result: parsed };
    });
  }

  async getMicroblock(args: {
    microblockHash: string;
  }): Promise<FoundOrNot<{ microblock: DbMicroblock; txs: string[] }>> {
    return await this.queryTx(async client => {
      const result = await client.query<MicroblockQueryResult>(
        `
        SELECT ${MICROBLOCK_COLUMNS}
        FROM microblocks
        WHERE microblock_hash = $1
        ORDER BY canonical DESC, microblock_canonical DESC
        LIMIT 1
        `,
        [hexToBuffer(args.microblockHash)]
      );
      if (result.rowCount === 0) {
        return { found: false } as const;
      }
      const txQuery = await client.query<{ tx_id: Buffer }>(
        `
        SELECT tx_id
        FROM txs
        WHERE microblock_hash = $1
        ORDER BY tx_index DESC
        `,
        [hexToBuffer(args.microblockHash)]
      );
      const microblock = parseMicroblockQueryResult(result.rows[0]);
      const txs = txQuery.rows.map(row => bufferToHexPrefixString(row.tx_id));
      return { found: true, result: { microblock, txs } };
    });
  }

  async getMicroblocks(args: {
    limit: number;
    offset: number;
  }): Promise<{ result: { microblock: DbMicroblock; txs: string[] }[]; total: number }> {
    const result = await this.queryTx(async client => {
      const countQuery = await client.query<{ total: number }>(
        `SELECT microblock_count AS total FROM chain_tip`
      );
      const microblockQuery = await client.query<
        MicroblockQueryResult & { tx_id?: Buffer | null; tx_index?: number | null }
      >(
        `
        SELECT microblocks.*, tx_id FROM (
          SELECT ${MICROBLOCK_COLUMNS}
          FROM microblocks
          WHERE canonical = true AND microblock_canonical = true
          ORDER BY block_height DESC, microblock_sequence DESC
          LIMIT $1
          OFFSET $2
        ) microblocks
        LEFT JOIN (
          SELECT tx_id, tx_index, microblock_hash
          FROM txs
          WHERE canonical = true AND microblock_canonical = true
          ORDER BY tx_index DESC
        ) txs
        ON microblocks.microblock_hash = txs.microblock_hash
        ORDER BY microblocks.block_height DESC, microblocks.microblock_sequence DESC, txs.tx_index DESC
        `,
        [args.limit, args.offset]
      );

      const microblocks: { microblock: DbMicroblock; txs: string[] }[] = [];
      microblockQuery.rows.forEach(row => {
        const mb = parseMicroblockQueryResult(row);
        let existing = microblocks.find(
          item => item.microblock.microblock_hash === mb.microblock_hash
        );
        if (!existing) {
          existing = { microblock: mb, txs: [] };
          microblocks.push(existing);
        }
        if (row.tx_id) {
          const txId = bufferToHexPrefixString(row.tx_id);
          existing.txs.push(txId);
        }
      });
      return {
        result: microblocks,
        total: countQuery.rows[0].total,
      };
    });
    return result;
  }

  async getUnanchoredTxsInternal(client: ClientBase): Promise<{ txs: DbTx[] }> {
    // Get transactions that have been streamed in microblocks but not yet accepted or rejected in an anchor block.
    const { blockHeight } = await this.getChainTip(client);
    const unanchoredBlockHeight = blockHeight + 1;
    const query = await client.query<ContractTxQueryResult>(
      `
      SELECT ${TX_COLUMNS}, ${abiColumn()}
      FROM txs
      WHERE canonical = true AND microblock_canonical = true AND block_height = $1
      ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC
      `,
      [unanchoredBlockHeight]
    );
    const txs = query.rows.map(row => parseTxQueryResult(row));
    return { txs: txs };
  }

  async getUnanchoredTxs(): Promise<{ txs: DbTx[] }> {
    return await this.queryTx(client => {
      return this.getUnanchoredTxsInternal(client);
    });
  }

  async getAddressNonceAtBlock(args: {
    stxAddress: string;
    blockIdentifier: BlockIdentifier;
  }): Promise<FoundOrNot<{ lastExecutedTxNonce: number | null; possibleNextNonce: number }>> {
    return await this.queryTx(async client => {
      const dbBlock = await this.getBlockInternal(client, args.blockIdentifier);
      if (!dbBlock.found) {
        return { found: false };
      }
      const nonceQuery = await client.query<{ nonce: number | null }>(
        `
        SELECT MAX(nonce) nonce
        FROM txs
        WHERE ((sender_address = $1 AND sponsored = false) OR (sponsor_address = $1 AND sponsored = true))
        AND canonical = true AND microblock_canonical = true
        AND block_height <= $2
        `,
        [args.stxAddress, dbBlock.result.block_height]
      );
      let lastExecutedTxNonce: number | null = null;
      let possibleNextNonce = 0;
      if (nonceQuery.rows.length > 0 && typeof nonceQuery.rows[0].nonce === 'number') {
        lastExecutedTxNonce = nonceQuery.rows[0].nonce;
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
    return await this.queryTx(async client => {
      const executedTxNonce = await client.query<{ nonce: number | null }>(
        `
        SELECT MAX(nonce) nonce
        FROM txs
        WHERE sender_address = $1
        AND canonical = true AND microblock_canonical = true
        `,
        [args.stxAddress]
      );

      const executedTxSponsorNonce = await client.query<{ nonce: number | null }>(
        `
        SELECT MAX(sponsor_nonce) nonce
        FROM txs
        WHERE sponsor_address = $1 AND sponsored = true
        AND canonical = true AND microblock_canonical = true
        `,
        [args.stxAddress]
      );

      const mempoolTxNonce = await client.query<{ nonce: number | null }>(
        `
        SELECT MAX(nonce) nonce
        FROM mempool_txs
        WHERE sender_address = $1
        AND pruned = false
        `,
        [args.stxAddress]
      );

      const mempoolTxSponsorNonce = await client.query<{ nonce: number | null }>(
        `
        SELECT MAX(sponsor_nonce) nonce
        FROM mempool_txs
        WHERE sponsor_address = $1 AND sponsored= true
        AND pruned = false
        `,
        [args.stxAddress]
      );

      let lastExecutedTxNonce = executedTxNonce.rows[0]?.nonce ?? null;
      const lastExecutedTxSponsorNonce = executedTxSponsorNonce.rows[0]?.nonce ?? null;
      if (lastExecutedTxNonce != null || lastExecutedTxSponsorNonce != null) {
        lastExecutedTxNonce = Math.max(lastExecutedTxNonce ?? 0, lastExecutedTxSponsorNonce ?? 0);
      }

      let lastMempoolTxNonce = mempoolTxNonce.rows[0]?.nonce ?? null;
      const lastMempoolTxSponsorNonce = mempoolTxSponsorNonce.rows[0]?.nonce ?? null;

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
          const mempoolNonces = await client.query<{ nonce: number }>(
            `
            SELECT nonce
            FROM mempool_txs
            WHERE sender_address = $1 AND nonce = ANY($2)
            AND pruned = false
            UNION
            SELECT sponsor_nonce as nonce
            FROM mempool_txs
            WHERE sponsor_address = $1 AND sponsored= true AND sponsor_nonce = ANY($2)
            AND pruned = false
            `,
            [args.stxAddress, expectedNonces]
          );
          const mempoolNonceArr = mempoolNonces.rows.map(r => r.nonce);
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

  getNameCanonical(txId: string, indexBlockHash: string): Promise<FoundOrNot<boolean>> {
    return this.query(async client => {
      const queryResult = await client.query(
        `
        SELECT canonical FROM names
        WHERE tx_id = $1
        AND index_block_hash = $2
        `,
        [hexToBuffer(txId), hexToBuffer(indexBlockHash)]
      );
      if (queryResult.rowCount > 0) {
        return {
          found: true,
          result: queryResult.rows[0],
        };
      }
      return { found: false } as const;
    });
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
    return await this.query(async client => {
      const queryResults = await client.query<{
        burn_block_hash: Buffer;
        burn_block_height: number;
        address: string;
        slot_index: number;
        count: number;
      }>(
        `
        SELECT
          burn_block_hash, burn_block_height, address, slot_index, ${countOverColumn()}
        FROM reward_slot_holders
        WHERE canonical = true ${burnchainAddress ? 'AND address = $3' : ''}
        ORDER BY burn_block_height DESC, slot_index DESC
        LIMIT $1
        OFFSET $2
        `,
        burnchainAddress ? [limit, offset, burnchainAddress] : [limit, offset]
      );
      const count = queryResults.rows[0]?.count ?? 0;
      const slotHolders = queryResults.rows.map(r => {
        const parsed: DbRewardSlotHolder = {
          canonical: true,
          burn_block_hash: bufferToHexPrefixString(r.burn_block_hash),
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
    });
  }

  async getTxsFromBlock(
    blockIdentifer: BlockIdentifier,
    limit: number,
    offset: number
  ): Promise<FoundOrNot<{ results: DbTx[]; total: number }>> {
    return this.queryTx(async client => {
      const blockQuery = await this.getBlockInternal(client, blockIdentifer);
      if (!blockQuery.found) {
        return { found: false };
      }
      const totalQuery = await client.query<{ count: number }>(
        `
        SELECT COUNT(*)::integer
        FROM txs
        WHERE canonical = true AND microblock_canonical = true AND index_block_hash = $1
        `,
        [hexToBuffer(blockQuery.result.index_block_hash)]
      );
      const result = await client.query<ContractTxQueryResult>(
        `
        SELECT ${TX_COLUMNS}, ${abiColumn()}
        FROM txs
        WHERE canonical = true AND microblock_canonical = true AND index_block_hash = $1
        ORDER BY microblock_sequence DESC, tx_index DESC
        LIMIT $2
        OFFSET $3
        `,
        [hexToBuffer(blockQuery.result.index_block_hash), limit, offset]
      );
      const total = totalQuery.rowCount > 0 ? totalQuery.rows[0].count : 0;
      const parsed = result.rows.map(r => parseTxQueryResult(r));
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
    return this.query(async client => {
      const queryResults = await client.query<{
        burn_block_hash: Buffer;
        burn_block_height: number;
        burn_amount: string;
        reward_recipient: string;
        reward_amount: string;
        reward_index: number;
      }>(
        `
        SELECT burn_block_hash, burn_block_height, burn_amount, reward_recipient, reward_amount, reward_index
        FROM burnchain_rewards
        WHERE canonical = true ${burnchainRecipient ? 'AND reward_recipient = $3' : ''}
        ORDER BY burn_block_height DESC, reward_index DESC
        LIMIT $1
        OFFSET $2
        `,
        burnchainRecipient ? [limit, offset, burnchainRecipient] : [limit, offset]
      );
      return queryResults.rows.map(r => {
        const parsed: DbBurnchainReward = {
          canonical: true,
          burn_block_hash: bufferToHexPrefixString(r.burn_block_hash),
          burn_block_height: r.burn_block_height,
          burn_amount: BigInt(r.burn_amount),
          reward_recipient: r.reward_recipient,
          reward_amount: BigInt(r.reward_amount),
          reward_index: r.reward_index,
        };
        return parsed;
      });
    });
  }
  async getMinersRewardsAtHeight({
    blockHeight,
  }: {
    blockHeight: number;
  }): Promise<DbMinerReward[]> {
    return this.query(async client => {
      const queryResults = await client.query<{
        block_hash: Buffer;
        from_index_block_hash: Buffer;
        index_block_hash: Buffer;
        mature_block_height: number;
        recipient: string;
        coinbase_amount: number;
        tx_fees_anchored: number;
        tx_fees_streamed_confirmed: number;
        tx_fees_streamed_produced: number;
      }>(
        `
        SELECT id, mature_block_height, recipient, block_hash, index_block_hash, from_index_block_hash, canonical, coinbase_amount, tx_fees_anchored, tx_fees_streamed_confirmed, tx_fees_streamed_produced
        FROM miner_rewards
        WHERE canonical = true AND mature_block_height = $1
        ORDER BY id DESC
        `,
        [blockHeight]
      );
      return queryResults.rows.map(r => {
        const parsed: DbMinerReward = {
          block_hash: bufferToHexPrefixString(r.block_hash),
          from_index_block_hash: bufferToHexPrefixString(r.from_index_block_hash),
          index_block_hash: bufferToHexPrefixString(r.index_block_hash),
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
    });
  }

  async getBurnchainRewardsTotal(
    burnchainRecipient: string
  ): Promise<{ reward_recipient: string; reward_amount: bigint }> {
    return this.query(async client => {
      const queryResults = await client.query<{
        amount: string;
      }>(
        `
        SELECT sum(reward_amount) amount
        FROM burnchain_rewards
        WHERE canonical = true AND reward_recipient = $1
        `,
        [burnchainRecipient]
      );
      const resultAmount = BigInt(queryResults.rows[0]?.amount ?? 0);
      return { reward_recipient: burnchainRecipient, reward_amount: resultAmount };
    });
  }

  private async parseMempoolTransactions(
    result: QueryResult<MempoolTxQueryResult>,
    client: ClientBase,
    includeUnanchored: boolean
  ) {
    if (result.rowCount === 0) {
      return [];
    }
    const pruned = result.rows.filter(memTx => memTx.pruned && !includeUnanchored);
    if (pruned.length !== 0) {
      const unanchoredBlockHeight = await this.getMaxBlockHeight(client, {
        includeUnanchored: true,
      });
      const notPrunedBufferTxIds = pruned.map(tx => tx.tx_id);
      const query = await client.query<{ tx_id: Buffer }>(
        `
          SELECT tx_id
          FROM txs
          WHERE canonical = true AND microblock_canonical = true
          AND tx_id = ANY($1)
          AND block_height = $2
          `,
        [notPrunedBufferTxIds, unanchoredBlockHeight]
      );
      // The tx is marked as pruned because it's in an unanchored microblock
      query.rows.forEach(tran => {
        const transaction = result.rows.find(
          tx => bufferToHexPrefixString(tx.tx_id) === bufferToHexPrefixString(tran.tx_id)
        );
        if (transaction) {
          transaction.pruned = false;
          transaction.status = DbTxStatus.Pending;
        }
      });
    }
    return result.rows.map(transaction => parseMempoolTxQueryResult(transaction));
  }

  async getMempoolTxs(args: {
    txIds: string[];
    includeUnanchored: boolean;
    includePruned?: boolean;
  }): Promise<DbMempoolTx[]> {
    return this.queryTx(async client => {
      const hexTxIds = args.txIds.map(txId => hexToBuffer(txId));
      const result = await client.query<MempoolTxQueryResult>(
        `
        SELECT ${MEMPOOL_TX_COLUMNS}, ${abiColumn('mempool_txs')}
        FROM mempool_txs
        WHERE tx_id = ANY($1)
        `,
        [hexTxIds]
      );
      return await this.parseMempoolTransactions(result, client, args.includeUnanchored);
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
  }) {
    return this.queryTx(async client => {
      const result = await client.query<MempoolTxQueryResult>(
        `
        SELECT ${MEMPOOL_TX_COLUMNS}, ${abiColumn('mempool_txs')}
        FROM mempool_txs
        WHERE tx_id = $1
        `,
        [hexToBuffer(txId)]
      );
      // Treat the tx as "not pruned" if it's in an unconfirmed microblock and the caller is has not opted-in to unanchored data.
      if (result.rows[0]?.pruned && !includeUnanchored) {
        const unanchoredBlockHeight = await this.getMaxBlockHeight(client, {
          includeUnanchored: true,
        });
        const query = await client.query<{ tx_id: Buffer }>(
          `
          SELECT tx_id
          FROM txs
          WHERE canonical = true AND microblock_canonical = true
          AND block_height = $1
          AND tx_id = $2
          LIMIT 1
          `,
          [unanchoredBlockHeight, hexToBuffer(txId)]
        );
        // The tx is marked as pruned because it's in an unanchored microblock
        if (query.rowCount > 0) {
          result.rows[0].pruned = false;
          result.rows[0].status = DbTxStatus.Pending;
        }
      }
      if (result.rowCount === 0 || (!includePruned && result.rows[0].pruned)) {
        return { found: false } as const;
      }
      if (result.rowCount > 1) {
        throw new Error(`Multiple transactions found in mempool table for txid: ${txId}`);
      }
      const rows = await this.parseMempoolTransactions(result, client, includeUnanchored);
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
    return await this.queryTx(async client => {
      const droppedStatuses = [
        DbTxStatus.DroppedReplaceByFee,
        DbTxStatus.DroppedReplaceAcrossFork,
        DbTxStatus.DroppedTooExpensive,
        DbTxStatus.DroppedStaleGarbageCollect,
      ];
      const selectCols = MEMPOOL_TX_COLUMNS.replace('tx_id', 'mempool.tx_id');
      const resultQuery = await client.query<MempoolTxQueryResult & { count: number }>(
        `
        SELECT ${selectCols}, ${abiColumn('mempool')}, ${countOverColumn()}
        FROM (
          SELECT *
          FROM mempool_txs
          WHERE pruned = true AND status = ANY($1)
        ) mempool
        LEFT JOIN (
          SELECT tx_id
          FROM txs
          WHERE canonical = true AND microblock_canonical = true
        ) mined
        ON mempool.tx_id = mined.tx_id
        WHERE mined.tx_id IS NULL
        ORDER BY receipt_time DESC
        LIMIT $2
        OFFSET $3
        `,
        [droppedStatuses, limit, offset]
      );
      const count = resultQuery.rows.length > 0 ? resultQuery.rows[0].count : 0;
      const mempoolTxs = resultQuery.rows.map(r => parseMempoolTxQueryResult(r));
      return { results: mempoolTxs, total: count };
    });
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
    const whereConditions: string[] = [];
    const queryValues: any[] = [];

    if (address) {
      whereConditions.push(
        `(sender_address = $$
          OR token_transfer_recipient_address = $$
          OR smart_contract_contract_id = $$
          OR contract_call_contract_id = $$)`
      );
      queryValues.push(address, address, address, address);
    } else if (senderAddress && recipientAddress) {
      whereConditions.push('(sender_address = $$ AND token_transfer_recipient_address = $$)');
      queryValues.push(senderAddress, recipientAddress);
    } else if (senderAddress) {
      whereConditions.push('sender_address = $$');
      queryValues.push(senderAddress);
    } else if (recipientAddress) {
      whereConditions.push('token_transfer_recipient_address = $$');
      queryValues.push(recipientAddress);
    }

    const queryResult = await this.queryTx(async client => {
      // If caller did not opt-in to unanchored tx data, then treat unanchored txs as pending mempool txs.
      if (!includeUnanchored) {
        const unanchoredTxs = (await this.getUnanchoredTxsInternal(client)).txs.map(tx =>
          hexToBuffer(tx.tx_id)
        );
        whereConditions.push('(pruned = false OR tx_id = ANY($$))');
        queryValues.push(unanchoredTxs);
      } else {
        whereConditions.push('pruned = false');
      }
      let paramNum = 1;
      const whereCondition = whereConditions.join(' AND ').replace(/\$\$/g, () => `$${paramNum++}`);
      const totalQuery = await client.query<{ count: number }>(
        `
        SELECT COUNT(*)::integer
        FROM mempool_txs
        WHERE ${whereCondition}
        `,
        [...queryValues]
      );
      const resultQuery = await client.query<MempoolTxQueryResult>(
        `
        SELECT ${MEMPOOL_TX_COLUMNS}, ${abiColumn('mempool_txs')}
        FROM mempool_txs
        WHERE ${whereCondition}
        ORDER BY receipt_time DESC
        LIMIT $${queryValues.length + 1}
        OFFSET $${queryValues.length + 2}
        `,
        [...queryValues, limit, offset]
      );
      return { total: totalQuery.rows[0].count, rows: resultQuery.rows };
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
    return await this.query(async client => {
      const result = await client.query<{ digest: string }>(`SELECT digest FROM mempool_digest`);
      if (result.rowCount === 0) {
        return { found: false } as const;
      }
      return { found: true, result: { digest: result.rows[0].digest } };
    });
  }

  async getTx({ txId, includeUnanchored }: { txId: string; includeUnanchored: boolean }) {
    return this.queryTx(async client => {
      const maxBlockHeight = await this.getMaxBlockHeight(client, { includeUnanchored });
      const result = await client.query<ContractTxQueryResult>(
        `
        SELECT ${TX_COLUMNS}, ${abiColumn()}
        FROM txs
        WHERE tx_id = $1 AND block_height <= $2
        ORDER BY canonical DESC, microblock_canonical DESC, block_height DESC
        LIMIT 1
        `,
        [hexToBuffer(txId), maxBlockHeight]
      );
      if (result.rowCount === 0) {
        return { found: false } as const;
      }
      const row = result.rows[0];
      const tx = parseTxQueryResult(row);
      return { found: true, result: tx };
    });
  }

  async getMaxBlockHeight(
    client: ClientBase,
    { includeUnanchored }: { includeUnanchored: boolean }
  ): Promise<number> {
    const chainTip = await this.getChainTip(client);
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
  }) {
    let totalQuery: QueryResult<{ count: number }>;
    let resultQuery: QueryResult<ContractTxQueryResult>;
    return this.queryTx(async client => {
      const maxHeight = await this.getMaxBlockHeight(client, { includeUnanchored });

      if (txTypeFilter.length === 0) {
        totalQuery = await client.query<{ count: number }>(
          `
          SELECT ${includeUnanchored ? 'tx_count_unanchored' : 'tx_count'} AS count
          FROM chain_tip
          `
        );
        resultQuery = await client.query<ContractTxQueryResult>(
          `
          SELECT ${TX_COLUMNS}, ${abiColumn()}
          FROM txs
          WHERE canonical = true AND microblock_canonical = true AND block_height <= $3
          ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC
          LIMIT $1
          OFFSET $2
          `,
          [limit, offset, maxHeight]
        );
      } else {
        const txTypeIds = txTypeFilter.map<number>(t => getTxTypeId(t));
        totalQuery = await client.query<{ count: number }>(
          `
          SELECT COUNT(*)::integer
          FROM txs
          WHERE canonical = true AND microblock_canonical = true AND type_id = ANY($1) AND block_height <= $2
          `,
          [txTypeIds, maxHeight]
        );
        resultQuery = await client.query<ContractTxQueryResult>(
          `
          SELECT ${TX_COLUMNS}, ${abiColumn()}
          FROM txs
          WHERE canonical = true AND microblock_canonical = true AND type_id = ANY($1) AND block_height <= $4
          ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC
          LIMIT $2
          OFFSET $3
          `,
          [txTypeIds, limit, offset, maxHeight]
        );
      }
      const parsed = resultQuery.rows.map(r => parseTxQueryResult(r));
      return { results: parsed, total: totalQuery.rows[0].count };
    });
  }

  getTxListEvents(args: {
    txs: {
      txId: string;
      indexBlockHash: string;
    }[];
    limit: number;
    offset: number;
  }) {
    return this.queryTx(async client => {
      // preparing condition to query from
      // condition = (tx_id=$1 AND index_block_hash=$2) OR (tx_id=$3 AND index_block_hash=$4)
      // let condition = this.generateParameterizedWhereAndOrClause(args.txs);
      if (args.txs.length === 0) return { results: [] };
      let condition = '(tx_id, index_block_hash) = ANY(VALUES ';
      let counter = 1;
      const transactionValues = args.txs
        .map(_ => {
          const singleCondition = '($' + counter + '::bytea, $' + (counter + 1) + '::bytea)';
          counter += 2;
          return singleCondition;
        })
        .join(', ');
      condition += transactionValues + ')';
      // preparing values for condition
      // conditionParams = [tx_id1, index_block_hash1, tx_id2, index_block_hash2]
      const conditionParams: Buffer[] = [];
      args.txs.forEach(transaction =>
        conditionParams.push(hexToBuffer(transaction.txId), hexToBuffer(transaction.indexBlockHash))
      );
      const eventIndexStart = args.offset;
      const eventIndexEnd = args.offset + args.limit - 1;
      // preparing complete where clause condition
      const paramEventIndexStart = args.txs.length * 2 + 1;
      const paramEventIndexEnd = paramEventIndexStart + 1;
      condition =
        condition +
        ' AND microblock_canonical = true AND event_index BETWEEN $' +
        paramEventIndexStart +
        ' AND $' +
        paramEventIndexEnd;
      const stxLockResults = await client.query<{
        event_index: number;
        tx_id: Buffer;
        tx_index: number;
        block_height: number;
        canonical: boolean;
        locked_amount: string;
        unlock_height: string;
        locked_address: string;
      }>(
        `
        SELECT
          event_index, tx_id, tx_index, block_height, canonical, locked_amount, unlock_height, locked_address
        FROM stx_lock_events
        WHERE ${condition}
        `,
        [...conditionParams, eventIndexStart, eventIndexEnd]
      );
      const stxResults = await client.query<{
        event_index: number;
        tx_id: Buffer;
        tx_index: number;
        block_height: number;
        canonical: boolean;
        asset_event_type_id: number;
        sender?: string;
        recipient?: string;
        amount: string;
      }>(
        `
        SELECT
          event_index, tx_id, tx_index, block_height, canonical, asset_event_type_id, sender, recipient, amount
        FROM stx_events
        WHERE ${condition}
        `,
        [...conditionParams, eventIndexStart, eventIndexEnd]
      );
      const ftResults = await client.query<{
        event_index: number;
        tx_id: Buffer;
        tx_index: number;
        block_height: number;
        canonical: boolean;
        asset_event_type_id: number;
        sender?: string;
        recipient?: string;
        asset_identifier: string;
        amount: string;
      }>(
        `
        SELECT
          event_index, tx_id, tx_index, block_height, canonical, asset_event_type_id, sender, recipient, asset_identifier, amount
        FROM ft_events
        WHERE ${condition}
        `,
        [...conditionParams, eventIndexStart, eventIndexEnd]
      );
      const nftResults = await client.query<{
        event_index: number;
        tx_id: Buffer;
        tx_index: number;
        block_height: number;
        canonical: boolean;
        asset_event_type_id: number;
        sender?: string;
        recipient?: string;
        asset_identifier: string;
        value: Buffer;
      }>(
        `
        SELECT
          event_index, tx_id, tx_index, block_height, canonical, asset_event_type_id, sender, recipient, asset_identifier, value
        FROM nft_events
        WHERE ${condition}
        `,
        [...conditionParams, eventIndexStart, eventIndexEnd]
      );
      const logResults = await client.query<{
        event_index: number;
        tx_id: Buffer;
        tx_index: number;
        block_height: number;
        canonical: boolean;
        contract_identifier: string;
        topic: string;
        value: Buffer;
      }>(
        `
        SELECT
          event_index, tx_id, tx_index, block_height, canonical, contract_identifier, topic, value
        FROM contract_logs
        WHERE ${condition}
        `,
        [...conditionParams, eventIndexStart, eventIndexEnd]
      );
      return {
        results: parseDbEvents(stxLockResults, stxResults, ftResults, nftResults, logResults),
      };
    });
  }

  /**
   * TODO investigate if this method needs be deprecated in favor of {@link getTransactionEvents}
   */
  async getTxEvents(args: { txId: string; indexBlockHash: string; limit: number; offset: number }) {
    // Note: when this is used to fetch events for an unanchored microblock tx, the `indexBlockHash` is empty
    // which will cause the sql queries to also match micro-orphaned tx data (resulting in duplicate event results).
    // To prevent that, all micro-orphaned events are excluded using `microblock_orphaned=false`.
    // That means, unlike regular orphaned txs, if a micro-orphaned tx is never re-mined, the micro-orphaned event data
    // will never be returned.
    return this.queryTx(async client => {
      const eventIndexStart = args.offset;
      const eventIndexEnd = args.offset + args.limit - 1;
      const txIdBuffer = hexToBuffer(args.txId);
      const blockHashBuffer = hexToBuffer(args.indexBlockHash);
      const stxLockResults = await client.query<{
        event_index: number;
        tx_id: Buffer;
        tx_index: number;
        block_height: number;
        canonical: boolean;
        locked_amount: string;
        unlock_height: string;
        locked_address: string;
      }>(
        `
        SELECT
          event_index, tx_id, tx_index, block_height, canonical, locked_amount, unlock_height, locked_address
        FROM stx_lock_events
        WHERE tx_id = $1 AND index_block_hash = $2 AND microblock_canonical = true AND event_index BETWEEN $3 AND $4
        `,
        [txIdBuffer, blockHashBuffer, eventIndexStart, eventIndexEnd]
      );
      const stxResults = await client.query<{
        event_index: number;
        tx_id: Buffer;
        tx_index: number;
        block_height: number;
        canonical: boolean;
        asset_event_type_id: number;
        sender?: string;
        recipient?: string;
        amount: string;
      }>(
        `
        SELECT
          event_index, tx_id, tx_index, block_height, canonical, asset_event_type_id, sender, recipient, amount
        FROM stx_events
        WHERE tx_id = $1 AND index_block_hash = $2 AND microblock_canonical = true AND event_index BETWEEN $3 AND $4
        `,
        [txIdBuffer, blockHashBuffer, eventIndexStart, eventIndexEnd]
      );
      const ftResults = await client.query<{
        event_index: number;
        tx_id: Buffer;
        tx_index: number;
        block_height: number;
        canonical: boolean;
        asset_event_type_id: number;
        sender?: string;
        recipient?: string;
        asset_identifier: string;
        amount: string;
      }>(
        `
        SELECT
          event_index, tx_id, tx_index, block_height, canonical, asset_event_type_id, sender, recipient, asset_identifier, amount
        FROM ft_events
        WHERE tx_id = $1 AND index_block_hash = $2 AND microblock_canonical = true AND event_index BETWEEN $3 AND $4
        `,
        [txIdBuffer, blockHashBuffer, eventIndexStart, eventIndexEnd]
      );
      const nftResults = await client.query<{
        event_index: number;
        tx_id: Buffer;
        tx_index: number;
        block_height: number;
        canonical: boolean;
        asset_event_type_id: number;
        sender?: string;
        recipient?: string;
        asset_identifier: string;
        value: Buffer;
      }>(
        `
        SELECT
          event_index, tx_id, tx_index, block_height, canonical, asset_event_type_id, sender, recipient, asset_identifier, value
        FROM nft_events
        WHERE tx_id = $1 AND index_block_hash = $2 AND microblock_canonical = true AND event_index BETWEEN $3 AND $4
        `,
        [txIdBuffer, blockHashBuffer, eventIndexStart, eventIndexEnd]
      );
      const logResults = await client.query<{
        event_index: number;
        tx_id: Buffer;
        tx_index: number;
        block_height: number;
        canonical: boolean;
        contract_identifier: string;
        topic: string;
        value: Buffer;
      }>(
        `
        SELECT
          event_index, tx_id, tx_index, block_height, canonical, contract_identifier, topic, value
        FROM contract_logs
        WHERE tx_id = $1 AND index_block_hash = $2 AND microblock_canonical = true AND event_index BETWEEN $3 AND $4
        `,
        [txIdBuffer, blockHashBuffer, eventIndexStart, eventIndexEnd]
      );
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
  }) {
    return this.queryTx(async client => {
      const eventsQueries: string[] = [];
      let events: DbEvent[] = [];
      let whereClause = '';
      if (args.addressOrTxId.txId) {
        whereClause = 'tx_id = $1';
      }
      const txIdBuffer = args.addressOrTxId.txId ? hexToBuffer(args.addressOrTxId.txId) : undefined;
      for (const eventType of args.eventTypeFilter) {
        switch (eventType) {
          case DbEventTypeId.StxLock:
            if (args.addressOrTxId.address) {
              whereClause = 'locked_address = $1';
            }
            eventsQueries.push(`
            SELECT
              tx_id, event_index, tx_index, block_height, locked_address as sender, NULL as recipient,
              locked_amount as amount, unlock_height, NULL as asset_identifier, NULL as contract_identifier,
              '0'::bytea as value, NULL as topic,
              ${DbEventTypeId.StxLock} as event_type_id, 0 as asset_event_type_id
            FROM stx_lock_events
            WHERE ${whereClause} AND canonical = true AND microblock_canonical = true`);
            break;
          case DbEventTypeId.StxAsset:
            if (args.addressOrTxId.address) {
              whereClause = '(sender = $1 OR recipient = $1)';
            }
            eventsQueries.push(`
            SELECT
              tx_id, event_index, tx_index, block_height, sender, recipient,
              amount, 0 as unlock_height, NULL as asset_identifier, NULL as contract_identifier,
              '0'::bytea as value, NULL as topic,
              ${DbEventTypeId.StxAsset} as event_type_id, asset_event_type_id
            FROM stx_events
            WHERE ${whereClause} AND canonical = true AND microblock_canonical = true`);
            break;
          case DbEventTypeId.FungibleTokenAsset:
            if (args.addressOrTxId.address) {
              whereClause = '(sender = $1 OR recipient = $1)';
            }
            eventsQueries.push(`
            SELECT
              tx_id, event_index, tx_index, block_height, sender, recipient,
              amount, 0 as unlock_height, asset_identifier, NULL as contract_identifier,
              '0'::bytea as value, NULL as topic,
              ${DbEventTypeId.FungibleTokenAsset} as event_type_id, asset_event_type_id
            FROM ft_events
            WHERE ${whereClause} AND canonical = true AND microblock_canonical = true`);
            break;
          case DbEventTypeId.NonFungibleTokenAsset:
            if (args.addressOrTxId.address) {
              whereClause = '(sender = $1 OR recipient = $1)';
            }
            eventsQueries.push(`
            SELECT
              tx_id, event_index, tx_index, block_height, sender, recipient,
              0 as amount, 0 as unlock_height, asset_identifier, NULL as contract_identifier,
              value, NULL as topic,
              ${DbEventTypeId.NonFungibleTokenAsset} as event_type_id, asset_event_type_id
            FROM nft_events
            WHERE ${whereClause} AND canonical = true AND microblock_canonical = true`);
            break;
          case DbEventTypeId.SmartContractLog:
            if (args.addressOrTxId.address) {
              whereClause = 'contract_identifier = $1';
            }
            eventsQueries.push(`
            SELECT
              tx_id, event_index, tx_index, block_height, NULL as sender, NULL as recipient,
              0 as amount, 0 as unlock_height, NULL as asset_identifier, contract_identifier,
              value, topic,
              ${DbEventTypeId.SmartContractLog} as event_type_id, 0 as asset_event_type_id
            FROM contract_logs
            WHERE ${whereClause} AND canonical = true AND microblock_canonical = true`);
            break;
          default:
            throw new Error('Unexpected event type');
        }
      }

      const queryString =
        `WITH events AS ( ` +
        eventsQueries.join(`\nUNION\n`) +
        `)
        SELECT *
        FROM events JOIN txs USING(tx_id)
        WHERE txs.canonical = true AND txs.microblock_canonical = true
        ORDER BY events.block_height DESC, microblock_sequence DESC, events.tx_index DESC, event_index DESC
        LIMIT $2 OFFSET $3`;

      const eventsResult = await client.query<{
        tx_id: Buffer;
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
        value: Buffer;
        event_type_id: number;
        asset_event_type_id: number;
      }>(queryString, [txIdBuffer ?? args.addressOrTxId.address, args.limit, args.offset]);
      if (eventsResult.rowCount > 0) {
        events = eventsResult.rows.map(r => {
          const event: DbEvent = {
            tx_id: bufferToHexPrefixString(r.tx_id),
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
    const result = await this.query(async client => {
      const queryResult = await client.query<DbTokenMetadataQueueEntryQuery>(
        `SELECT * FROM token_metadata_queue WHERE queue_id = $1`,
        [queueId]
      );
      return queryResult;
    });
    if (result.rowCount === 0) {
      return { found: false };
    }
    const row = result.rows[0];
    const entry: DbTokenMetadataQueueEntry = {
      queueId: row.queue_id,
      txId: bufferToHexPrefixString(row.tx_id),
      contractId: row.contract_id,
      contractAbi: JSON.parse(row.contract_abi),
      blockHeight: row.block_height,
      processed: row.processed,
    };
    return { found: true, result: entry };
  }

  async getTokenMetadataQueue(
    limit: number,
    excludingEntries: number[]
  ): Promise<DbTokenMetadataQueueEntry[]> {
    const result = await this.queryTx(async client => {
      const queryResult = await client.query<DbTokenMetadataQueueEntryQuery>(
        `
        SELECT *
        FROM token_metadata_queue
        WHERE NOT (queue_id = ANY($1))
        AND processed = false
        ORDER BY block_height ASC, queue_id ASC
        LIMIT $2
        `,
        [excludingEntries, limit]
      );
      return queryResult;
    });
    const entries = result.rows.map(row => {
      const entry: DbTokenMetadataQueueEntry = {
        queueId: row.queue_id,
        txId: bufferToHexPrefixString(row.tx_id),
        contractId: row.contract_id,
        contractAbi: JSON.parse(row.contract_abi),
        blockHeight: row.block_height,
        processed: row.processed,
      };
      return entry;
    });
    return entries;
  }

  async getSmartContractList(contractIds: string[]) {
    return this.query(async client => {
      const result = await client.query<{
        contract_id: string;
        canonical: boolean;
        tx_id: Buffer;
        block_height: number;
        source_code: string;
        abi: unknown | null;
      }>(
        `
        SELECT DISTINCT ON (contract_id) contract_id, canonical, tx_id, block_height, source_code, abi
        FROM smart_contracts
        WHERE contract_id = ANY($1)
        ORDER BY contract_id DESC, abi != 'null' DESC, canonical DESC, microblock_canonical DESC, block_height DESC
      `,
        [contractIds]
      );
      if (result.rowCount === 0) {
        [];
      }
      return result.rows.map(r => parseQueryResultToSmartContract(r)).map(res => res.result);
    });
  }

  async getSmartContract(contractId: string) {
    return this.query(async client => {
      const result = await client.query<{
        tx_id: Buffer;
        canonical: boolean;
        contract_id: string;
        block_height: number;
        source_code: string;
        abi: unknown | null;
      }>(
        `
        SELECT tx_id, canonical, contract_id, block_height, source_code, abi
        FROM smart_contracts
        WHERE contract_id = $1
        ORDER BY abi != 'null' DESC, canonical DESC, microblock_canonical DESC, block_height DESC
        LIMIT 1
        `,
        [contractId]
      );
      if (result.rowCount === 0) {
        return { found: false } as const;
      }
      const row = result.rows[0];
      return parseQueryResultToSmartContract(row);
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
    return this.query(async client => {
      const logResults = await client.query<{
        event_index: number;
        tx_id: Buffer;
        tx_index: number;
        block_height: number;
        contract_identifier: string;
        topic: string;
        value: Buffer;
      }>(
        `
        SELECT
          event_index, tx_id, tx_index, block_height, contract_identifier, topic, value
        FROM contract_logs
        WHERE canonical = true AND microblock_canonical = true AND contract_identifier = $1
        ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
        LIMIT $2
        OFFSET $3
        `,
        [contractId, limit, offset]
      );
      const result = logResults.rows.map(result => {
        const event: DbSmartContractEvent = {
          event_index: result.event_index,
          tx_id: bufferToHexPrefixString(result.tx_id),
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
    });
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

    return this.query(async client => {
      const result = await client.query<{
        tx_id: Buffer;
        canonical: boolean;
        contract_id: string;
        block_height: number;
        source_code: string;
        abi: unknown | null;
      }>(
        `
        SELECT tx_id, canonical, contract_id, block_height, source_code, abi
        FROM smart_contracts
        WHERE abi->'functions' @> $1::jsonb AND canonical = true AND microblock_canonical = true
        ORDER BY block_height DESC
        LIMIT $2 OFFSET $3
        `,
        [JSON.stringify(traitFunctionList), args.limit, args.offset]
      );
      if (result.rowCount === 0) {
        return { found: false } as const;
      }
      const smartContracts = result.rows.map(row => {
        return parseQueryResultToSmartContract(row).result;
      });
      return { found: true, result: smartContracts };
    });
  }

  async getStxBalance({
    stxAddress,
    includeUnanchored,
  }: {
    stxAddress: string;
    includeUnanchored: boolean;
  }): Promise<DbStxBalance> {
    return this.queryTx(async client => {
      const blockQuery = await this.getCurrentBlockInternal(client);
      if (!blockQuery.found) {
        throw new Error(`Could not find current block`);
      }
      let blockHeight = blockQuery.result.block_height;
      if (includeUnanchored) {
        blockHeight++;
      }
      const result = await this.internalGetStxBalanceAtBlock(
        client,
        stxAddress,
        blockHeight,
        blockQuery.result.burn_block_height
      );
      return result;
    });
  }

  async getStxBalanceAtBlock(stxAddress: string, blockHeight: number): Promise<DbStxBalance> {
    return this.queryTx(async client => {
      const chainTip = await this.getChainTip(client);
      const blockHeightToQuery =
        blockHeight > chainTip.blockHeight ? chainTip.blockHeight : blockHeight;
      const blockQuery = await this.getBlockByHeightInternal(client, blockHeightToQuery);
      if (!blockQuery.found) {
        throw new Error(`Could not find block at height: ${blockHeight}`);
      }
      const result = await this.internalGetStxBalanceAtBlock(
        client,
        stxAddress,
        blockHeight,
        blockQuery.result.burn_block_height
      );
      return result;
    });
  }

  async internalGetStxBalanceAtBlock(
    client: ClientBase,
    stxAddress: string,
    blockHeight: number,
    burnBlockHeight: number
  ): Promise<DbStxBalance> {
    const result = await client.query<{
      credit_total: string | null;
      debit_total: string | null;
    }>(
      `
      WITH credit AS (
        SELECT sum(amount) as credit_total
        FROM stx_events
        WHERE canonical = true AND microblock_canonical = true AND recipient = $1 AND block_height <= $2
      ),
      debit AS (
        SELECT sum(amount) as debit_total
        FROM stx_events
        WHERE canonical = true AND microblock_canonical = true AND sender = $1 AND block_height <= $2
      )
      SELECT credit_total, debit_total
      FROM credit CROSS JOIN debit
      `,
      [stxAddress, blockHeight]
    );
    const feeQuery = await client.query<{ fee_sum: string }>(
      `
      SELECT sum(fee_rate) as fee_sum
      FROM txs
      WHERE canonical = true AND microblock_canonical = true AND ((sender_address = $1 AND sponsored = false) OR (sponsor_address = $1 AND sponsored= true)) AND block_height <= $2
      `,
      [stxAddress, blockHeight]
    );
    const lockQuery = await client.query<{
      locked_amount: string;
      unlock_height: string;
      block_height: string;
      tx_id: Buffer;
    }>(
      `
      SELECT locked_amount, unlock_height, block_height, tx_id
      FROM stx_lock_events
      WHERE canonical = true AND microblock_canonical = true AND locked_address = $1
      AND block_height <= $2 AND unlock_height > $3
      `,
      [stxAddress, blockHeight, burnBlockHeight]
    );
    let lockTxId: string = '';
    let locked: bigint = 0n;
    let lockHeight = 0;
    let burnchainLockHeight = 0;
    let burnchainUnlockHeight = 0;
    if (lockQuery.rowCount > 1) {
      throw new Error(
        `stx_lock_events event query for ${stxAddress} should return zero or one rows but returned ${lockQuery.rowCount}`
      );
    } else if (lockQuery.rowCount === 1) {
      lockTxId = bufferToHexPrefixString(lockQuery.rows[0].tx_id);
      locked = BigInt(lockQuery.rows[0].locked_amount);
      burnchainUnlockHeight = parseInt(lockQuery.rows[0].unlock_height);
      lockHeight = parseInt(lockQuery.rows[0].block_height);
      const blockQuery = await this.getBlockByHeightInternal(client, lockHeight);
      burnchainLockHeight = blockQuery.found ? blockQuery.result.burn_block_height : 0;
    }
    const minerRewardQuery = await client.query<{ amount: string }>(
      `
      SELECT sum(
        coinbase_amount + tx_fees_anchored + tx_fees_streamed_confirmed + tx_fees_streamed_produced
      ) amount
      FROM miner_rewards
      WHERE canonical = true AND recipient = $1 AND mature_block_height <= $2
      `,
      [stxAddress, blockHeight]
    );
    const totalRewards = BigInt(minerRewardQuery.rows[0]?.amount ?? 0);
    const totalFees = BigInt(feeQuery.rows[0]?.fee_sum ?? 0);
    const totalSent = BigInt(result.rows[0]?.debit_total ?? 0);
    const totalReceived = BigInt(result.rows[0]?.credit_total ?? 0);
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
  ) {
    return this.queryTx(async client => {
      let atBlockHeight: number;
      let atMatureBlockHeight: number;
      if ('blockHeight' in args) {
        atBlockHeight = args.blockHeight;
        atMatureBlockHeight = args.blockHeight;
      } else {
        atBlockHeight = await this.getMaxBlockHeight(client, {
          includeUnanchored: args.includeUnanchored,
        });
        atMatureBlockHeight = args.includeUnanchored ? atBlockHeight - 1 : atBlockHeight;
      }
      const result = await client.query<{ amount: string }>(
        `
        SELECT SUM(amount) amount FROM (
            SELECT SUM(amount) amount
            FROM stx_events
            WHERE canonical = true AND microblock_canonical = true
            AND asset_event_type_id = 2 -- mint events
            AND block_height <= $1
          UNION ALL
            SELECT (SUM(amount) * -1) amount
            FROM stx_events
            WHERE canonical = true AND microblock_canonical = true
            AND asset_event_type_id = 3 -- burn events
            AND block_height <= $1
          UNION ALL
            SELECT SUM(coinbase_amount) amount
            FROM miner_rewards
            WHERE canonical = true
            AND mature_block_height <= $2
        ) totals
        `,
        [atBlockHeight, atMatureBlockHeight]
      );
      if (result.rows.length < 1) {
        throw new Error(`No rows returned from total supply query`);
      }
      return { stx: BigInt(result.rows[0].amount), blockHeight: atBlockHeight };
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
    return this.queryTx(async client => {
      const results = await client.query<
        {
          asset_type: 'stx_lock' | 'stx' | 'ft' | 'nft';
          event_index: number;
          tx_id: Buffer;
          tx_index: number;
          block_height: number;
          canonical: boolean;
          asset_event_type_id: number;
          sender?: string;
          recipient?: string;
          asset_identifier: string;
          amount?: string;
          unlock_height?: string;
          value?: Buffer;
        } & { count: number }
      >(
        `
        SELECT *, ${countOverColumn()}
        FROM(
          SELECT
            'stx_lock' as asset_type, event_index, tx_id, microblock_sequence, tx_index, block_height, canonical, 0 as asset_event_type_id,
            locked_address as sender, '' as recipient, '<stx>' as asset_identifier, locked_amount as amount, unlock_height, null::bytea as value
          FROM stx_lock_events
          WHERE canonical = true AND microblock_canonical = true AND locked_address = $1 AND block_height <= $4
          UNION ALL
          SELECT
            'stx' as asset_type, event_index, tx_id, microblock_sequence, tx_index, block_height, canonical, asset_event_type_id,
            sender, recipient, '<stx>' as asset_identifier, amount::numeric, null::numeric as unlock_height, null::bytea as value
          FROM stx_events
          WHERE canonical = true AND microblock_canonical = true AND (sender = $1 OR recipient = $1) AND block_height <= $4
          UNION ALL
          SELECT
            'ft' as asset_type, event_index, tx_id, microblock_sequence, tx_index, block_height, canonical, asset_event_type_id,
            sender, recipient, asset_identifier, amount, null::numeric as unlock_height, null::bytea as value
          FROM ft_events
          WHERE canonical = true AND microblock_canonical = true AND (sender = $1 OR recipient = $1) AND block_height <= $4
          UNION ALL
          SELECT
            'nft' as asset_type, event_index, tx_id, microblock_sequence, tx_index, block_height, canonical, asset_event_type_id,
            sender, recipient, asset_identifier, null::numeric as amount, null::numeric as unlock_height, value
          FROM nft_events
          WHERE canonical = true AND microblock_canonical = true AND (sender = $1 OR recipient = $1) AND block_height <= $4
        ) asset_events
        ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
        LIMIT $2
        OFFSET $3
        `,
        [stxAddress, limit, offset, blockHeight]
      );

      const events: DbEvent[] = results.rows.map(row => {
        if (row.asset_type === 'stx_lock') {
          const event: DbStxLockEvent = {
            event_index: row.event_index,
            tx_id: bufferToHexPrefixString(row.tx_id),
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
            tx_id: bufferToHexPrefixString(row.tx_id),
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
            tx_id: bufferToHexPrefixString(row.tx_id),
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
            tx_id: bufferToHexPrefixString(row.tx_id),
            tx_index: row.tx_index,
            block_height: row.block_height,
            canonical: row.canonical,
            asset_event_type_id: row.asset_event_type_id,
            sender: row.sender,
            recipient: row.recipient,
            asset_identifier: row.asset_identifier,
            event_type: DbEventTypeId.NonFungibleTokenAsset,
            value: row.value as Buffer,
          };
          return event;
        } else {
          throw new Error(`Unexpected asset_type "${row.asset_type}"`);
        }
      });
      const count = results.rowCount > 0 ? results.rows[0].count : 0;
      return {
        results: events,
        total: count,
      };
    });
  }

  async getFungibleTokenBalances(args: {
    stxAddress: string;
    untilBlock: number;
  }): Promise<Map<string, DbFtBalance>> {
    return this.queryTx(async client => {
      const result = await client.query<{
        asset_identifier: string;
        credit_total: string | null;
        debit_total: string | null;
      }>(
        `
        WITH transfers AS (
          SELECT amount, sender, recipient, asset_identifier
          FROM ft_events
          WHERE canonical = true AND microblock_canonical = true
          AND (sender = $1 OR recipient = $1)
          AND block_height <= $2
        ), credit AS (
          SELECT asset_identifier, sum(amount) as credit_total
          FROM transfers
          WHERE recipient = $1
          GROUP BY asset_identifier
        ), debit AS (
          SELECT asset_identifier, sum(amount) as debit_total
          FROM transfers
          WHERE sender = $1
          GROUP BY asset_identifier
        )
        SELECT coalesce(credit.asset_identifier, debit.asset_identifier) as asset_identifier, credit_total, debit_total
        FROM credit FULL JOIN debit USING (asset_identifier)
        `,
        [args.stxAddress, args.untilBlock]
      );
      // sort by asset name (case-insensitive)
      const rows = result.rows.sort((r1, r2) =>
        r1.asset_identifier.localeCompare(r2.asset_identifier)
      );
      const assetBalances = new Map<string, DbFtBalance>(
        rows.map(r => {
          const totalSent = BigInt(r.debit_total ?? 0);
          const totalReceived = BigInt(r.credit_total ?? 0);
          const balance = totalReceived - totalSent;
          return [r.asset_identifier, { balance, totalSent, totalReceived }];
        })
      );
      return assetBalances;
    });
  }

  async getNonFungibleTokenCounts(args: {
    stxAddress: string;
    untilBlock: number;
  }): Promise<Map<string, { count: bigint; totalSent: bigint; totalReceived: bigint }>> {
    return this.queryTx(async client => {
      const result = await client.query<{
        asset_identifier: string;
        received_total: string | null;
        sent_total: string | null;
      }>(
        `
        WITH transfers AS (
          SELECT sender, recipient, asset_identifier
          FROM nft_events
          WHERE canonical = true AND microblock_canonical = true
          AND (sender = $1 OR recipient = $1)
          AND block_height <= $2
        ), credit AS (
          SELECT asset_identifier, COUNT(*) as received_total
          FROM transfers
          WHERE recipient = $1
          GROUP BY asset_identifier
        ), debit AS (
          SELECT asset_identifier, COUNT(*) as sent_total
          FROM transfers
          WHERE sender = $1
          GROUP BY asset_identifier
        )
        SELECT coalesce(credit.asset_identifier, debit.asset_identifier) as asset_identifier, received_total, sent_total
        FROM credit FULL JOIN debit USING (asset_identifier)
        `,
        [args.stxAddress, args.untilBlock]
      );
      // sort by asset name (case-insensitive)
      const rows = result.rows.sort((r1, r2) =>
        r1.asset_identifier.localeCompare(r2.asset_identifier)
      );
      const assetBalances = new Map(
        rows.map(r => {
          const totalSent = BigInt(r.sent_total ?? 0);
          const totalReceived = BigInt(r.received_total ?? 0);
          const count = totalReceived - totalSent;
          return [r.asset_identifier, { count, totalSent, totalReceived }];
        })
      );
      return assetBalances;
    });
  }

  async getAddressTxs(args: {
    stxAddress: string;
    blockHeight: number;
    atSingleBlock: boolean;
    limit: number;
    offset: number;
  }): Promise<{ results: DbTx[]; total: number }> {
    return this.queryTx(async client => {
      const blockCond = args.atSingleBlock ? 'block_height = $4' : 'block_height <= $4';
      const resultQuery = await client.query<ContractTxQueryResult & { count: number }>(
        // Query the `principal_stx_txs` table first to get the results page we want and then
        // join against `txs` to get the full transaction objects only for that page.
        `
        WITH stx_txs AS (
          SELECT tx_id, index_block_hash, microblock_hash, ${countOverColumn()}
          FROM principal_stx_txs
          WHERE principal = $1 AND ${blockCond}
          AND canonical = TRUE AND microblock_canonical = TRUE
          ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC
          LIMIT $2
          OFFSET $3
        )
        SELECT ${txColumns()}, ${abiColumn()}, count
        FROM stx_txs
        INNER JOIN txs USING (tx_id, index_block_hash, microblock_hash)
        `,
        [args.stxAddress, args.limit, args.offset, args.blockHeight]
      );
      const count = resultQuery.rowCount > 0 ? resultQuery.rows[0].count : 0;
      const parsed = resultQuery.rows.map(r => parseTxQueryResult(r));
      return { results: parsed, total: count };
    });
  }

  async getInformationTxsWithStxTransfers({
    stxAddress,
    tx_id,
  }: {
    stxAddress: string;
    tx_id: string;
  }): Promise<DbTxWithAssetTransfers> {
    return this.query(async client => {
      const queryParams: (string | Buffer)[] = [stxAddress, hexToBuffer(tx_id)];
      const resultQuery = await client.query<
        ContractTxQueryResult & {
          count: number;
          event_index?: number;
          event_type?: number;
          event_amount?: string;
          event_sender?: string;
          event_recipient?: string;
        }
      >(
        `
      WITH transactions AS (
        WITH principal_txs AS (
          WITH event_txs AS (
            SELECT tx_id FROM stx_events WHERE stx_events.sender = $1 OR stx_events.recipient = $1
          )
          SELECT *
          FROM txs
          WHERE canonical = true AND microblock_canonical = true AND txs.tx_id = $2 AND (
            sender_address = $1 OR
            token_transfer_recipient_address = $1 OR
            contract_call_contract_id = $1 OR
            smart_contract_contract_id = $1
          )
          UNION
          SELECT txs.* FROM txs
          INNER JOIN event_txs ON txs.tx_id = event_txs.tx_id
          WHERE txs.canonical = true AND txs.microblock_canonical = true AND txs.tx_id = $2
        )
        SELECT ${TX_COLUMNS}, ${countOverColumn()}
        FROM principal_txs
        ORDER BY block_height DESC, tx_index DESC
      ), events AS (
        SELECT *, ${DbEventTypeId.StxAsset} as event_type_id
        FROM stx_events
        WHERE canonical = true AND microblock_canonical = true AND (sender = $1 OR recipient = $1)
      )
      SELECT
        transactions.*,
        events.event_index as event_index,
        events.event_type_id as event_type,
        events.amount as event_amount,
        events.sender as event_sender,
        events.recipient as event_recipient,
        ${abiColumn('transactions')}
      FROM transactions
      LEFT JOIN events ON transactions.tx_id = events.tx_id AND transactions.tx_id = $2
      ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
      `,
        queryParams
      );

      const txs = this.parseTxsWithAssetTransfers(resultQuery, stxAddress);
      const txTransfers = [...txs.values()];
      return txTransfers[0];
    });
  }

  async getAddressTxsWithAssetTransfers(args: {
    stxAddress: string;
    blockHeight: number;
    atSingleBlock: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ results: DbTxWithAssetTransfers[]; total: number }> {
    return this.queryTx(async client => {
      const queryParams: (string | number)[] = [args.stxAddress];

      if (args.atSingleBlock) {
        queryParams.push(args.blockHeight);
      } else {
        queryParams.push(args.limit ?? 20);
        queryParams.push(args.offset ?? 0);
        queryParams.push(args.blockHeight);
      }
      // Use a JOIN to include stx_events associated with the address's txs
      const resultQuery = await client.query<
        ContractTxQueryResult & {
          count: number;
          event_index?: number;
          event_type?: number;
          event_amount?: string;
          event_sender?: string;
          event_recipient?: string;
          event_asset_identifier?: string;
          event_value?: Buffer;
        }
      >(
        `
        WITH transactions AS (
          WITH principal_txs AS (
            WITH event_txs AS (
              SELECT tx_id FROM stx_events WHERE stx_events.sender = $1 OR stx_events.recipient = $1
              UNION
              SELECT tx_id FROM ft_events WHERE ft_events.sender = $1 OR ft_events.recipient = $1
              UNION
              SELECT tx_id FROM nft_events WHERE nft_events.sender = $1 OR nft_events.recipient = $1
            )
            SELECT * FROM txs
            WHERE canonical = true AND microblock_canonical = true AND (
              sender_address = $1 OR
              token_transfer_recipient_address = $1 OR
              contract_call_contract_id = $1 OR
              smart_contract_contract_id = $1
            )
            UNION
            SELECT txs.* FROM txs
            INNER JOIN event_txs ON txs.tx_id = event_txs.tx_id
            WHERE canonical = true AND microblock_canonical = true
          )
          SELECT ${TX_COLUMNS}, ${countOverColumn()}
          FROM principal_txs
          ${args.atSingleBlock ? 'WHERE block_height = $2' : 'WHERE block_height <= $4'}
          ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC
          ${!args.atSingleBlock ? 'LIMIT $2 OFFSET $3' : ''}
        ), events AS (
          SELECT
            tx_id, sender, recipient, event_index, amount,
            ${DbEventTypeId.StxAsset} as event_type_id,
            NULL as asset_identifier, '0'::bytea as value
          FROM stx_events
          WHERE canonical = true AND microblock_canonical = true AND (sender = $1 OR recipient = $1)
          UNION
          SELECT
            tx_id, sender, recipient, event_index, amount,
            ${DbEventTypeId.FungibleTokenAsset} as event_type_id,
            asset_identifier, '0'::bytea as value
          FROM ft_events
          WHERE canonical = true AND microblock_canonical = true AND (sender = $1 OR recipient = $1)
          UNION
          SELECT
            tx_id, sender, recipient, event_index, 0 as amount,
            ${DbEventTypeId.NonFungibleTokenAsset} as event_type_id,
            asset_identifier, value
          FROM nft_events
          WHERE canonical = true AND microblock_canonical = true AND (sender = $1 OR recipient = $1)
        )
        SELECT
          transactions.*,
          ${abiColumn('transactions')},
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
        `,
        queryParams
      );

      // TODO: should mining rewards be added?

      const txs = this.parseTxsWithAssetTransfers(resultQuery, args.stxAddress);
      const txTransfers = [...txs.values()];
      txTransfers.sort((a, b) => {
        return b.tx.block_height - a.tx.block_height || b.tx.tx_index - a.tx.tx_index;
      });
      const count = resultQuery.rowCount > 0 ? resultQuery.rows[0].count : 0;
      return { results: txTransfers, total: count };
    });
  }

  parseTxsWithAssetTransfers(
    resultQuery: QueryResult<
      TxQueryResult & {
        count: number;
        event_index?: number | undefined;
        event_type?: number | undefined;
        event_amount?: string | undefined;
        event_sender?: string | undefined;
        event_recipient?: string | undefined;
        event_asset_identifier?: string | undefined;
        event_value?: Buffer | undefined;
      }
    >,
    stxAddress: string
  ) {
    const txs = new Map<
      string,
      {
        tx: DbTx;
        stx_sent: bigint;
        stx_received: bigint;
        stx_transfers: {
          amount: bigint;
          sender?: string;
          recipient?: string;
        }[];
        ft_transfers: {
          asset_identifier: string;
          amount: bigint;
          sender?: string;
          recipient?: string;
        }[];
        nft_transfers: {
          asset_identifier: string;
          value: Buffer;
          sender?: string;
          recipient?: string;
        }[];
      }
    >();
    for (const r of resultQuery.rows) {
      const txId = bufferToHexPrefixString(r.tx_id);
      let txResult = txs.get(txId);
      if (!txResult) {
        txResult = {
          tx: parseTxQueryResult(r),
          stx_sent: 0n,
          stx_received: 0n,
          stx_transfers: [],
          ft_transfers: [],
          nft_transfers: [],
        };
        if (txResult.tx.sender_address === stxAddress) {
          txResult.stx_sent += txResult.tx.fee_rate;
        }
        txs.set(txId, txResult);
      }
      if (r.event_index !== undefined && r.event_index !== null) {
        const eventAmount = BigInt(r.event_amount as string);
        switch (r.event_type) {
          case DbEventTypeId.StxAsset:
            txResult.stx_transfers.push({
              amount: eventAmount,
              sender: r.event_sender,
              recipient: r.event_recipient,
            });
            if (r.event_sender === stxAddress) {
              txResult.stx_sent += eventAmount;
            }
            if (r.event_recipient === stxAddress) {
              txResult.stx_received += eventAmount;
            }
            break;

          case DbEventTypeId.FungibleTokenAsset:
            txResult.ft_transfers.push({
              asset_identifier: r.event_asset_identifier as string,
              amount: eventAmount,
              sender: r.event_sender,
              recipient: r.event_recipient,
            });
            break;

          case DbEventTypeId.NonFungibleTokenAsset:
            txResult.nft_transfers.push({
              asset_identifier: r.event_asset_identifier as string,
              value: r.event_value as Buffer,
              sender: r.event_sender,
              recipient: r.event_recipient,
            });
            break;
        }
      }
    }
    return txs;
  }

  async getInboundTransfers(args: {
    stxAddress: string;
    blockHeight: number;
    atSingleBlock: boolean;
    limit: number;
    offset: number;
    sendManyContractId: string;
  }): Promise<{ results: DbInboundStxTransfer[]; total: number }> {
    return this.queryTx(async client => {
      let whereClause: string;
      if (args.atSingleBlock) {
        whereClause = 'WHERE block_height = $5';
      } else {
        whereClause = 'WHERE block_height <= $5';
      }
      const resultQuery = await client.query<TransferQueryResult & { count: number }>(
        `
        SELECT
          *, ${countOverColumn()}
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
              contract_logs.contract_identifier = $2
              AND contract_logs.tx_id = stx_events.tx_id
              AND stx_events.recipient = $1
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
              AND token_transfer_recipient_address = $1
          ) transfers
        ${whereClause}
        ORDER BY
          block_height DESC,
          microblock_sequence DESC,
          tx_index DESC
        LIMIT $3
        OFFSET $4
        `,
        [args.stxAddress, args.sendManyContractId, args.limit, args.offset, args.blockHeight]
      );
      const count = resultQuery.rowCount > 0 ? resultQuery.rows[0].count : 0;
      const parsed: DbInboundStxTransfer[] = resultQuery.rows.map(r => {
        return {
          sender: r.sender,
          memo: bufferToHexPrefixString(r.memo),
          amount: BigInt(r.amount),
          tx_id: bufferToHexPrefixString(r.tx_id),
          tx_index: r.tx_index,
          block_height: r.block_height,
          transfer_type: r.transfer_type,
        };
      });
      return {
        results: parsed,
        total: count,
      };
    });
  }

  async searchHash({ hash }: { hash: string }): Promise<FoundOrNot<DbSearchResult>> {
    // TODO(mb): add support for searching for microblock by hash
    return this.query(async client => {
      const txQuery = await client.query<ContractTxQueryResult>(
        `SELECT ${TX_COLUMNS}, ${abiColumn()} FROM txs WHERE tx_id = $1 LIMIT 1`,
        [hexToBuffer(hash)]
      );
      if (txQuery.rowCount > 0) {
        const txResult = parseTxQueryResult(txQuery.rows[0]);
        return {
          found: true,
          result: {
            entity_type: 'tx_id',
            entity_id: bufferToHexPrefixString(txQuery.rows[0].tx_id),
            entity_data: txResult,
          },
        };
      }

      const txMempoolQuery = await client.query<MempoolTxQueryResult>(
        `
        SELECT ${MEMPOOL_TX_COLUMNS}, ${abiColumn('mempool_txs')}
        FROM mempool_txs WHERE pruned = false AND tx_id = $1 LIMIT 1
        `,
        [hexToBuffer(hash)]
      );
      if (txMempoolQuery.rowCount > 0) {
        const txResult = parseMempoolTxQueryResult(txMempoolQuery.rows[0]);
        return {
          found: true,
          result: {
            entity_type: 'mempool_tx_id',
            entity_id: bufferToHexPrefixString(txMempoolQuery.rows[0].tx_id),
            entity_data: txResult,
          },
        };
      }

      const blockQueryResult = await client.query<BlockQueryResult>(
        `SELECT ${BLOCK_COLUMNS} FROM blocks WHERE block_hash = $1 LIMIT 1`,
        [hexToBuffer(hash)]
      );
      if (blockQueryResult.rowCount > 0) {
        const blockResult = parseBlockQueryResult(blockQueryResult.rows[0]);
        return {
          found: true,
          result: {
            entity_type: 'block_hash',
            entity_id: bufferToHexPrefixString(blockQueryResult.rows[0].block_hash),
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
    return await this.query(async client => {
      if (isContract) {
        const contractMempoolTxResult = await client.query<MempoolTxQueryResult>(
          `
          SELECT ${MEMPOOL_TX_COLUMNS}, ${abiColumn('mempool_txs')}
          FROM mempool_txs WHERE pruned = false AND smart_contract_contract_id = $1 LIMIT 1
          `,
          [principal]
        );
        if (contractMempoolTxResult.rowCount > 0) {
          const txResult = parseMempoolTxQueryResult(contractMempoolTxResult.rows[0]);
          return {
            found: true,
            result: {
              entity_type: 'contract_address',
              entity_id: principal,
              entity_data: txResult,
            },
          };
        }
        const contractTxResult = await client.query<ContractTxQueryResult>(
          `
          SELECT ${TX_COLUMNS}, ${abiColumn()}
          FROM txs
          WHERE smart_contract_contract_id = $1
          ORDER BY canonical DESC, microblock_canonical DESC, block_height DESC
          LIMIT 1
          `,
          [principal]
        );
        if (contractTxResult.rowCount > 0) {
          const txResult = parseTxQueryResult(contractTxResult.rows[0]);
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

      const addressQueryResult = await client.query(
        `
        SELECT sender_address, token_transfer_recipient_address
        FROM txs
        WHERE sender_address = $1 OR token_transfer_recipient_address = $1
        LIMIT 1
        `,
        [principal]
      );
      if (addressQueryResult.rowCount > 0) {
        return successResponse;
      }

      const stxQueryResult = await client.query(
        `
        SELECT sender, recipient
        FROM stx_events
        WHERE sender = $1 OR recipient = $1
        LIMIT 1
        `,
        [principal]
      );
      if (stxQueryResult.rowCount > 0) {
        return successResponse;
      }

      const ftQueryResult = await client.query(
        `
        SELECT sender, recipient
        FROM ft_events
        WHERE sender = $1 OR recipient = $1
        LIMIT 1
        `,
        [principal]
      );
      if (ftQueryResult.rowCount > 0) {
        return successResponse;
      }

      const nftQueryResult = await client.query(
        `
        SELECT sender, recipient
        FROM nft_events
        WHERE sender = $1 OR recipient = $1
        LIMIT 1
        `,
        [principal]
      );
      if (nftQueryResult.rowCount > 0) {
        return successResponse;
      }

      return { found: false };
    });
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

  async getBTCFaucetRequests(address: string) {
    return this.query(async client => {
      const queryResult = await client.query<FaucetRequestQueryResult>(
        `
        SELECT ip, address, currency, occurred_at
        FROM faucet_requests
        WHERE address = $1 AND currency = 'btc'
        ORDER BY occurred_at DESC
        LIMIT 5
        `,
        [address]
      );
      const results = queryResult.rows.map(r => parseFaucetRequestQueryResult(r));
      return { results };
    });
  }

  async getSTXFaucetRequests(address: string) {
    return await this.query(async client => {
      const queryResult = await client.query<FaucetRequestQueryResult>(
        `
        SELECT ip, address, currency, occurred_at
        FROM faucet_requests
        WHERE address = $1 AND currency = 'stx'
        ORDER BY occurred_at DESC
        LIMIT 5
        `,
        [address]
      );
      const results = queryResult.rows.map(r => parseFaucetRequestQueryResult(r));
      return { results };
    });
  }

  async getRawTx(txId: string) {
    return this.query(async client => {
      const result = await client.query<RawTxQueryResult>(
        // Note the extra "limit 1" statements are only query hints
        `
        (
          SELECT raw_tx
          FROM txs
          WHERE tx_id = $1
          LIMIT 1
        )
        UNION ALL
        (
          SELECT raw_tx
          FROM mempool_txs
          WHERE tx_id = $1
          LIMIT 1
        )
        LIMIT 1
        `,
        [hexToBuffer(txId)]
      );
      if (result.rowCount === 0) {
        return { found: false } as const;
      }
      const queryResult: RawTxQueryResult = {
        raw_tx: result.rows[0].raw_tx,
      };
      return { found: true, result: queryResult };
    });
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
    return this.queryTx(async client => {
      const queryArgs: (string | string[] | number)[] = [args.principal, args.limit, args.offset];
      if (args.assetIdentifiers) {
        queryArgs.push(args.assetIdentifiers);
      }
      const nftCustody = args.includeUnanchored ? 'nft_custody_unanchored' : 'nft_custody';
      const assetIdFilter = args.assetIdentifiers ? 'AND nft.asset_identifier = ANY ($4)' : '';
      const nftTxResults = await client.query<
        NftHoldingInfo & ContractTxQueryResult & { count: number }
      >(
        `
        WITH nft AS (
          SELECT *, ${countOverColumn()}
          FROM ${nftCustody} AS nft
          WHERE nft.recipient = $1
          ${assetIdFilter}
          LIMIT $2
          OFFSET $3
        )
        ` +
          (args.includeTxMetadata
            ? `SELECT nft.asset_identifier, nft.value, ${txColumns()}, ${abiColumn()}, nft.count
            FROM nft
            INNER JOIN txs USING (tx_id)
            WHERE txs.canonical = TRUE AND txs.microblock_canonical = TRUE`
            : `SELECT * FROM nft`),
        queryArgs
      );
      return {
        results: nftTxResults.rows.map(row => ({
          nft_holding_info: {
            asset_identifier: row.asset_identifier,
            value: row.value,
            recipient: row.recipient,
            tx_id: row.tx_id,
          },
          tx: args.includeTxMetadata ? parseTxQueryResult(row) : undefined,
        })),
        total: nftTxResults.rows.length > 0 ? nftTxResults.rows[0].count : 0,
      };
    });
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
    return this.queryTx(async client => {
      const queryArgs: (string | number | Buffer)[] = [
        args.assetIdentifier,
        hexToBuffer(args.value),
        args.blockHeight,
        args.limit,
        args.offset,
      ];
      const columns = args.includeTxMetadata
        ? `asset_identifier, value, event_index, asset_event_type_id, sender, recipient,
           ${txColumns()}, ${abiColumn()}`
        : `nft.*`;
      const nftTxResults = await client.query<
        DbNftEvent & ContractTxQueryResult & { count: number }
      >(
        `
        SELECT ${columns}, ${countOverColumn()}
        FROM nft_events AS nft
        INNER JOIN txs USING (tx_id)
        WHERE asset_identifier = $1 AND nft.value = $2
          AND txs.canonical = TRUE AND txs.microblock_canonical = TRUE
          AND nft.canonical = TRUE AND nft.microblock_canonical = TRUE
          AND nft.block_height <= $3
        ORDER BY
          nft.block_height DESC,
          txs.microblock_sequence DESC,
          txs.tx_index DESC,
          nft.event_index DESC
        LIMIT $4
        OFFSET $5
        `,
        queryArgs
      );
      return {
        results: nftTxResults.rows.map(row => ({
          nft_event: {
            event_type: DbEventTypeId.NonFungibleTokenAsset,
            value: row.value,
            asset_identifier: row.asset_identifier,
            asset_event_type_id: row.asset_event_type_id,
            sender: row.sender,
            recipient: row.recipient,
            event_index: row.event_index,
            tx_id: bufferToHexPrefixString(row.tx_id),
            tx_index: row.tx_index,
            block_height: row.block_height,
            canonical: row.canonical,
          },
          tx: args.includeTxMetadata ? parseTxQueryResult(row) : undefined,
        })),
        total: nftTxResults.rows.length > 0 ? nftTxResults.rows[0].count : 0,
      };
    });
  }

  /**
   * Returns all NFT mint events for a particular asset identifier.
   * @param args - Query arguments
   */
  getNftMints(args: {
    assetIdentifier: string;
    limit: number;
    offset: number;
    blockHeight: number;
    includeTxMetadata: boolean;
  }): Promise<{ results: NftEventWithTxMetadata[]; total: number }> {
    return this.queryTx(async client => {
      const queryArgs: (string | number)[] = [
        args.assetIdentifier,
        args.blockHeight,
        args.limit,
        args.offset,
      ];
      const columns = args.includeTxMetadata
        ? `asset_identifier, value, event_index, asset_event_type_id, sender, recipient,
           ${txColumns()}, ${abiColumn()}`
        : `nft.*`;
      const nftTxResults = await client.query<
        DbNftEvent & ContractTxQueryResult & { count: number }
      >(
        `
        SELECT ${columns}, ${countOverColumn()}
        FROM nft_events AS nft
        INNER JOIN txs USING (tx_id)
        WHERE nft.asset_identifier = $1
          AND nft.asset_event_type_id = ${DbAssetEventTypeId.Mint}
          AND nft.canonical = TRUE AND nft.microblock_canonical = TRUE
          AND txs.canonical = TRUE AND txs.microblock_canonical = TRUE
          AND nft.block_height <= $2
        ORDER BY
          nft.block_height DESC,
          txs.microblock_sequence DESC,
          txs.tx_index DESC,
          nft.event_index DESC
        LIMIT $3
        OFFSET $4
        `,
        queryArgs
      );
      return {
        results: nftTxResults.rows.map(row => ({
          nft_event: {
            event_type: DbEventTypeId.NonFungibleTokenAsset,
            value: row.value,
            asset_identifier: row.asset_identifier,
            asset_event_type_id: row.asset_event_type_id,
            sender: row.sender,
            recipient: row.recipient,
            event_index: row.event_index,
            tx_id: bufferToHexPrefixString(row.tx_id),
            tx_index: row.tx_index,
            block_height: row.block_height,
            canonical: row.canonical,
          },
          tx: args.includeTxMetadata ? parseTxQueryResult(row) : undefined,
        })),
        total: nftTxResults.rows.length > 0 ? nftTxResults.rows[0].count : 0,
      };
    });
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
    return this.queryTx(async client => {
      const result = await client.query<AddressNftEventIdentifier & { count: number }>(
        // Join against `nft_custody` materialized view only if we're looking for canonical results.
        `
        WITH address_transfers AS (
          SELECT asset_identifier, value, sender, recipient, block_height, microblock_sequence, tx_index, event_index, tx_id
          FROM nft_events
          WHERE canonical = true AND microblock_canonical = true
          AND recipient = $1 AND block_height <= $4
        ),
        last_nft_transfers AS (
          SELECT DISTINCT ON(asset_identifier, value) asset_identifier, value, recipient
          FROM nft_events
          WHERE canonical = true AND microblock_canonical = true
          AND block_height <= $4
          ORDER BY asset_identifier, value, block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
        )
        SELECT sender, recipient, asset_identifier, value, address_transfers.block_height, address_transfers.tx_id, ${countOverColumn()}
        FROM address_transfers
        INNER JOIN ${args.includeUnanchored ? 'last_nft_transfers' : 'nft_custody'}
          USING (asset_identifier, value, recipient)
        ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
        LIMIT $2 OFFSET $3
        `,
        [args.stxAddress, args.limit, args.offset, args.blockHeight]
      );

      const count = result.rows.length > 0 ? result.rows[0].count : 0;

      const nftEvents = result.rows.map(row => ({
        sender: row.sender,
        recipient: row.recipient,
        asset_identifier: row.asset_identifier,
        value: row.value,
        block_height: row.block_height,
        tx_id: row.tx_id,
      }));

      return { results: nftEvents, total: count };
    });
  }

  async getTxListDetails({
    txIds,
    includeUnanchored,
  }: {
    txIds: string[];
    includeUnanchored: boolean;
  }) {
    return this.queryTx(async client => {
      const values = txIds.map(id => hexToBuffer(id));
      const maxBlockHeight = await this.getMaxBlockHeight(client, { includeUnanchored });
      const result = await client.query<ContractTxQueryResult>(
        `
        SELECT ${TX_COLUMNS}, ${abiColumn()}
        FROM txs
        WHERE tx_id = ANY($1) AND block_height <= $2 AND canonical = true AND microblock_canonical = true
        `,
        [values, maxBlockHeight]
      );
      if (result.rowCount === 0) {
        return [];
      }
      return result.rows.map(row => {
        return parseTxQueryResult(row);
      });
    });
  }

  async getNamespaceList({ includeUnanchored }: { includeUnanchored: boolean }) {
    const queryResult = await this.queryTx(async client => {
      const maxBlockHeight = await this.getMaxBlockHeight(client, { includeUnanchored });
      return await client.query<{ namespace_id: string }>(
        `
        SELECT DISTINCT ON (namespace_id) namespace_id
        FROM namespaces
        WHERE canonical = true AND microblock_canonical = true
        AND ready_block <= $1
        ORDER BY namespace_id, ready_block DESC, tx_index DESC
        `,
        [maxBlockHeight]
      );
    });

    const results = queryResult.rows.map(r => r.namespace_id);
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
    const queryResult = await this.queryTx(async client => {
      const maxBlockHeight = await this.getMaxBlockHeight(client, { includeUnanchored });
      return await client.query<{ name: string }>(
        `
        SELECT DISTINCT ON (name) name
        FROM names
        WHERE namespace_id = $1
        AND registered_at <= $3
        AND canonical = true AND microblock_canonical = true
        ORDER BY name, registered_at DESC, tx_index DESC
        LIMIT 100
        OFFSET $2
        `,
        [namespace, offset, maxBlockHeight]
      );
    });

    const results = queryResult.rows.map(r => r.name);
    return { results };
  }

  async getNamespace({
    namespace,
    includeUnanchored,
  }: {
    namespace: string;
    includeUnanchored: boolean;
  }): Promise<FoundOrNot<DbBnsNamespace & { index_block_hash: string }>> {
    const queryResult = await this.queryTx(async client => {
      const maxBlockHeight = await this.getMaxBlockHeight(client, { includeUnanchored });
      return await client.query<DbBnsNamespace & { tx_id: Buffer; index_block_hash: Buffer }>(
        `
        SELECT DISTINCT ON (namespace_id) namespace_id, *
        FROM namespaces
        WHERE namespace_id = $1
        AND ready_block <= $2
        AND canonical = true AND microblock_canonical = true
        ORDER BY namespace_id, ready_block DESC, tx_index DESC
        LIMIT 1
        `,
        [namespace, maxBlockHeight]
      );
    });
    if (queryResult.rowCount > 0) {
      return {
        found: true,
        result: {
          ...queryResult.rows[0],
          tx_id: bufferToHexPrefixString(queryResult.rows[0].tx_id),
          index_block_hash: bufferToHexPrefixString(queryResult.rows[0].index_block_hash),
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
  }): Promise<FoundOrNot<DbBnsName & { index_block_hash: string }>> {
    const queryResult = await this.queryTx(async client => {
      const maxBlockHeight = await this.getMaxBlockHeight(client, { includeUnanchored });
      return await client.query<DbBnsName & { tx_id: Buffer; index_block_hash: Buffer }>(
        `
        SELECT DISTINCT ON (names.name) names.name, names.*, zonefiles.zonefile
        FROM names
        LEFT JOIN zonefiles ON names.zonefile_hash = zonefiles.zonefile_hash
        WHERE name = $1
        AND registered_at <= $2
        AND canonical = true AND microblock_canonical = true
        ORDER BY name, registered_at DESC, tx_index DESC
        LIMIT 1
        `,
        [name, maxBlockHeight]
      );
    });
    if (queryResult.rowCount > 0) {
      return {
        found: true,
        result: {
          ...queryResult.rows[0],
          tx_id: bufferToHexPrefixString(queryResult.rows[0].tx_id),
          index_block_hash: bufferToHexPrefixString(queryResult.rows[0].index_block_hash),
        },
      };
    }
    return { found: false } as const;
  }

  async getHistoricalZoneFile(args: {
    name: string;
    zoneFileHash: string;
  }): Promise<FoundOrNot<DbBnsZoneFile>> {
    const queryResult = await this.query(client => {
      const validZonefileHash = validateZonefileHash(args.zoneFileHash);
      return client.query<{ zonefile: string }>(
        `
        SELECT zonefile
        FROM names
        LEFT JOIN zonefiles ON zonefiles.zonefile_hash = names.zonefile_hash
        WHERE name = $1
        AND names.zonefile_hash = $2
        UNION ALL
        SELECT zonefile
        FROM subdomains
        LEFT JOIN zonefiles ON zonefiles.zonefile_hash = subdomains.zonefile_hash
        WHERE fully_qualified_subdomain = $1
        AND subdomains.zonefile_hash = $2
        `,
        [args.name, validZonefileHash]
      );
    });

    if (queryResult.rowCount > 0) {
      return {
        found: true,
        result: queryResult.rows[0],
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
    const queryResult = await this.queryTx(async client => {
      const maxBlockHeight = await this.getMaxBlockHeight(client, { includeUnanchored });
      const zonefileHashResult = await client.query<{ name: string; zonefile: string }>(
        `
        SELECT name, zonefile_hash as zonefile FROM (
          (
            SELECT DISTINCT ON (name) name, zonefile_hash
            FROM names
            WHERE name = $1
            AND registered_at <= $2
            AND canonical = true AND microblock_canonical = true
            ORDER BY name, registered_at DESC, tx_index DESC
            LIMIT 1
          )
          UNION ALL (
            SELECT DISTINCT ON (fully_qualified_subdomain) fully_qualified_subdomain as name, zonefile_hash
            FROM subdomains
            WHERE fully_qualified_subdomain = $1
            AND block_height <= $2
            AND canonical = true AND microblock_canonical = true
            ORDER BY fully_qualified_subdomain, block_height DESC, tx_index DESC
            LIMIT 1
          )
        ) results
        LIMIT 1
        `,
        [name, maxBlockHeight]
      );
      if (zonefileHashResult.rowCount === 0) {
        return zonefileHashResult;
      }
      const zonefileHash = zonefileHashResult.rows[0].zonefile;
      const zonefileResult = await client.query<{ zonefile: string }>(
        `
        SELECT zonefile
        FROM zonefiles
        WHERE zonefile_hash = $1
      `,
        [zonefileHash]
      );
      if (zonefileResult.rowCount === 0) {
        return zonefileHashResult;
      }
      zonefileHashResult.rows[0].zonefile = zonefileResult.rows[0].zonefile;
      return zonefileHashResult;
    });

    if (queryResult.rowCount > 0) {
      return {
        found: true,
        result: queryResult.rows[0],
      };
    }
    return { found: false } as const;
  }

  async getNamesByAddressList({
    address,
    includeUnanchored,
  }: {
    address: string;
    includeUnanchored: boolean;
  }): Promise<FoundOrNot<string[]>> {
    const queryResult = await this.queryTx(async client => {
      const maxBlockHeight = await this.getMaxBlockHeight(client, { includeUnanchored });
      const query = await client.query<{ name: string }>(
        `
      WITH address_names AS(
        (
          SELECT name
          FROM names
          WHERE address = $1
          AND registered_at <= $2
          AND canonical = true AND microblock_canonical = true
        )
        UNION ALL (
          SELECT DISTINCT ON (fully_qualified_subdomain) fully_qualified_subdomain as name
          FROM subdomains
          WHERE owner = $1
          AND block_height <= $2
          AND canonical = true AND microblock_canonical = true
        )),

      latest_names AS(
      (
        SELECT DISTINCT ON (names.name) names.name, address, registered_at as block_height, tx_index
        FROM names, address_names
        WHERE address_names.name = names.name
        AND canonical = true AND microblock_canonical = true
        ORDER BY names.name, registered_at DESC, tx_index DESC
      )
      UNION ALL(
        SELECT DISTINCT ON (fully_qualified_subdomain) fully_qualified_subdomain as name, owner as address, block_height, tx_index
        FROM subdomains, address_names
        WHERE fully_qualified_subdomain = address_names.name
        AND canonical = true AND microblock_canonical = true
        ORDER BY fully_qualified_subdomain, block_height DESC, tx_index DESC
      ))

      SELECT name from latest_names
      WHERE address = $1
      ORDER BY name, block_height DESC, tx_index DESC
        `,
        [address, maxBlockHeight]
      );
      return query;
    });

    if (queryResult.rowCount > 0) {
      return {
        found: true,
        result: queryResult.rows.map(r => r.name),
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
    const queryResult = await this.queryTx(async client => {
      const maxBlockHeight = await this.getMaxBlockHeight(client, { includeUnanchored });
      return await client.query<{ fully_qualified_subdomain: string }>(
        `
        SELECT DISTINCT ON (fully_qualified_subdomain) fully_qualified_subdomain
        FROM subdomains
        WHERE name = $1 AND block_height <= $2
        AND canonical = true AND microblock_canonical = true
        ORDER BY fully_qualified_subdomain, block_height DESC, microblock_sequence DESC, tx_index DESC
        `,
        [name, maxBlockHeight]
      );
    });
    const results = queryResult.rows.map(r => r.fully_qualified_subdomain);
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
    const queryResult = await this.queryTx(async client => {
      const maxBlockHeight = await this.getMaxBlockHeight(client, { includeUnanchored });
      return await client.query<{ fully_qualified_subdomain: string }>(
        `
        SELECT DISTINCT ON (fully_qualified_subdomain) fully_qualified_subdomain
        FROM subdomains
        WHERE block_height <= $2
        AND canonical = true AND microblock_canonical = true
        ORDER BY fully_qualified_subdomain, block_height DESC, tx_index DESC
        LIMIT 100
        OFFSET $1
        `,
        [offset, maxBlockHeight]
      );
    });
    const results = queryResult.rows.map(r => r.fully_qualified_subdomain);
    return { results };
  }

  async getNamesList({ page, includeUnanchored }: { page: number; includeUnanchored: boolean }) {
    const offset = page * 100;
    const queryResult = await this.queryTx(async client => {
      const maxBlockHeight = await this.getMaxBlockHeight(client, { includeUnanchored });
      return await client.query<{ name: string }>(
        `
        SELECT DISTINCT ON (name) name
        FROM names
        WHERE canonical = true AND microblock_canonical = true
        AND registered_at <= $2
        ORDER BY name, registered_at DESC, tx_index DESC
        LIMIT 100
        OFFSET $1
        `,
        [offset, maxBlockHeight]
      );
    });

    const results = queryResult.rows.map(r => r.name);
    return { results };
  }

  async getSubdomain({
    subdomain,
    includeUnanchored,
  }: {
    subdomain: string;
    includeUnanchored: boolean;
  }): Promise<FoundOrNot<DbBnsSubdomain & { index_block_hash: string }>> {
    const queryResult = await this.queryTx(async client => {
      const maxBlockHeight = await this.getMaxBlockHeight(client, { includeUnanchored });
      const subdomainResult = await client.query<
        DbBnsSubdomain & { tx_id: Buffer; index_block_hash: Buffer }
      >(
        `
        SELECT DISTINCT ON(subdomains.fully_qualified_subdomain) subdomains.fully_qualified_subdomain, *
        FROM subdomains
        WHERE canonical = true AND microblock_canonical = true
        AND block_height <= $2
        AND fully_qualified_subdomain = $1
        ORDER BY fully_qualified_subdomain, block_height DESC, tx_index DESC
        `,
        [subdomain, maxBlockHeight]
      );
      if (subdomainResult.rowCount === 0 || !subdomainResult.rows[0].zonefile_hash) {
        return subdomainResult;
      }
      const zonefileHash = subdomainResult.rows[0].zonefile_hash;
      const zonefileResult = await client.query(
        `
        SELECT zonefile
        FROM zonefiles
        WHERE zonefile_hash = $1
      `,
        [zonefileHash]
      );
      if (zonefileResult.rowCount === 0) {
        return subdomainResult;
      }
      subdomainResult.rows[0].zonefile = zonefileResult.rows[0].zonefile;
      return subdomainResult;
    });
    if (queryResult.rowCount > 0) {
      return {
        found: true,
        result: {
          ...queryResult.rows[0],
          tx_id: bufferToHexPrefixString(queryResult.rows[0].tx_id),
          index_block_hash: bufferToHexPrefixString(queryResult.rows[0].index_block_hash),
        },
      };
    }
    return { found: false } as const;
  }

  async getSubdomainResolver(args: { name: string }): Promise<FoundOrNot<string>> {
    const queryResult = await this.query(client => {
      return client.query<{ resolver: string }>(
        `
        SELECT DISTINCT ON (name) name, resolver
        FROM subdomains
        WHERE canonical = true AND microblock_canonical = true
        AND name = $1
        ORDER BY name, block_height DESC, tx_index DESC
        LIMIT 1
        `,
        [args.name]
      );
    });
    if (queryResult.rowCount > 0) {
      return {
        found: true,
        result: queryResult.rows[0].resolver,
      };
    }
    return { found: false } as const;
  }

  async getTokenOfferingLocked(address: string, blockHeight: number) {
    return this.query(async client => {
      const queryResult = await client.query<DbTokenOfferingLocked>(
        `
         SELECT block, value
         FROM token_offering_locked
         WHERE address = $1
         ORDER BY block ASC
       `,
        [address]
      );
      if (queryResult.rowCount > 0) {
        let totalLocked = 0n;
        let totalUnlocked = 0n;
        const unlockSchedules: AddressUnlockSchedule[] = [];
        queryResult.rows.forEach(lockedInfo => {
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
    });
  }

  async getUnlockedAddressesAtBlock(block: DbBlock): Promise<StxUnlockEvent[]> {
    return this.queryTx(async client => {
      return await this.internalGetUnlockedAccountsAtHeight(client, block);
    });
  }

  async internalGetUnlockedAccountsAtHeight(
    client: ClientBase,
    block: DbBlock
  ): Promise<StxUnlockEvent[]> {
    const current_burn_height = block.burn_block_height;
    let previous_burn_height = current_burn_height;
    if (block.block_height > 1) {
      const previous_block = await this.getBlockByHeightInternal(client, block.block_height - 1);
      if (previous_block.found) {
        previous_burn_height = previous_block.result.burn_block_height;
      }
    }

    const lockQuery = await client.query<{
      locked_amount: string;
      unlock_height: string;
      locked_address: string;
      tx_id: Buffer;
    }>(
      `
      SELECT locked_amount, unlock_height, locked_address
      FROM stx_lock_events
      WHERE microblock_canonical = true AND canonical = true
      AND unlock_height <= $1 AND unlock_height > $2
      `,
      [current_burn_height, previous_burn_height]
    );

    const txIdQuery = await client.query<{
      tx_id: Buffer;
    }>(
      `
      SELECT tx_id
      FROM txs
      WHERE microblock_canonical = true AND canonical = true
      AND block_height = $1 AND type_id = $2
      LIMIT 1
      `,
      [block.block_height, DbTxTypeId.Coinbase]
    );

    const result: StxUnlockEvent[] = [];
    lockQuery.rows.forEach(row => {
      const unlockEvent: StxUnlockEvent = {
        unlock_height: row.unlock_height,
        unlocked_amount: row.locked_amount,
        stacker_address: row.locked_address,
        tx_id: bufferToHexPrefixString(txIdQuery.rows[0].tx_id),
      };
      result.push(unlockEvent);
    });

    return result;
  }

  async getStxUnlockHeightAtTransaction(txId: string): Promise<FoundOrNot<number>> {
    return this.queryTx(async client => {
      const lockQuery = await client.query<{ unlock_height: number }>(
        `
        SELECT unlock_height
        FROM stx_lock_events
        WHERE canonical = true AND tx_id = $1
        `,
        [hexToBuffer(txId)]
      );
      if (lockQuery.rowCount > 0) {
        return { found: true, result: lockQuery.rows[0].unlock_height };
      }
      return { found: false };
    });
  }

  async getFtMetadata(contractId: string): Promise<FoundOrNot<DbFungibleTokenMetadata>> {
    return this.query(async client => {
      const queryResult = await client.query<FungibleTokenMetadataQueryResult>(
        `
         SELECT token_uri, name, description, image_uri, image_canonical_uri, symbol, decimals, contract_id, tx_id, sender_address
         FROM ft_metadata
         WHERE contract_id = $1
         LIMIT 1
       `,
        [contractId]
      );
      if (queryResult.rowCount > 0) {
        const metadata: DbFungibleTokenMetadata = {
          token_uri: queryResult.rows[0].token_uri,
          name: queryResult.rows[0].name,
          description: queryResult.rows[0].description,
          image_uri: queryResult.rows[0].image_uri,
          image_canonical_uri: queryResult.rows[0].image_canonical_uri,
          symbol: queryResult.rows[0].symbol,
          decimals: queryResult.rows[0].decimals,
          contract_id: queryResult.rows[0].contract_id,
          tx_id: bufferToHexPrefixString(queryResult.rows[0].tx_id),
          sender_address: queryResult.rows[0].sender_address,
        };
        return {
          found: true,
          result: metadata,
        };
      } else {
        return { found: false } as const;
      }
    });
  }

  async getNftMetadata(contractId: string): Promise<FoundOrNot<DbNonFungibleTokenMetadata>> {
    return this.query(async client => {
      const queryResult = await client.query<NonFungibleTokenMetadataQueryResult>(
        `
         SELECT token_uri, name, description, image_uri, image_canonical_uri, contract_id, tx_id, sender_address
         FROM nft_metadata
         WHERE contract_id = $1
         LIMIT 1
       `,
        [contractId]
      );
      if (queryResult.rowCount > 0) {
        const metadata: DbNonFungibleTokenMetadata = {
          token_uri: queryResult.rows[0].token_uri,
          name: queryResult.rows[0].name,
          description: queryResult.rows[0].description,
          image_uri: queryResult.rows[0].image_uri,
          image_canonical_uri: queryResult.rows[0].image_canonical_uri,
          contract_id: queryResult.rows[0].contract_id,
          tx_id: bufferToHexPrefixString(queryResult.rows[0].tx_id),
          sender_address: queryResult.rows[0].sender_address,
        };
        return {
          found: true,
          result: metadata,
        };
      } else {
        return { found: false } as const;
      }
    });
  }

  getFtMetadataList({
    limit,
    offset,
  }: {
    limit: number;
    offset: number;
  }): Promise<{ results: DbFungibleTokenMetadata[]; total: number }> {
    return this.queryTx(async client => {
      const totalQuery = await client.query<{ count: number }>(
        `
          SELECT COUNT(*)::integer
          FROM ft_metadata
          `
      );
      const resultQuery = await client.query<FungibleTokenMetadataQueryResult>(
        `
          SELECT *
          FROM ft_metadata
          LIMIT $1
          OFFSET $2
          `,
        [limit, offset]
      );
      const parsed = resultQuery.rows.map(r => {
        const metadata: DbFungibleTokenMetadata = {
          name: r.name,
          description: r.description,
          token_uri: r.token_uri,
          image_uri: r.image_uri,
          image_canonical_uri: r.image_canonical_uri,
          decimals: r.decimals,
          symbol: r.symbol,
          contract_id: r.contract_id,
          tx_id: bufferToHexPrefixString(r.tx_id),
          sender_address: r.sender_address,
        };
        return metadata;
      });
      return { results: parsed, total: totalQuery.rows[0].count };
    });
  }

  getNftMetadataList({
    limit,
    offset,
  }: {
    limit: number;
    offset: number;
  }): Promise<{ results: DbNonFungibleTokenMetadata[]; total: number }> {
    return this.queryTx(async client => {
      const totalQuery = await client.query<{ count: number }>(
        `
          SELECT COUNT(*)::integer
          FROM nft_metadata
          `
      );
      const resultQuery = await client.query<FungibleTokenMetadataQueryResult>(
        `
          SELECT *
          FROM nft_metadata
          LIMIT $1
          OFFSET $2
          `,
        [limit, offset]
      );
      const parsed = resultQuery.rows.map(r => {
        const metadata: DbNonFungibleTokenMetadata = {
          name: r.name,
          description: r.description,
          token_uri: r.token_uri,
          image_uri: r.image_uri,
          image_canonical_uri: r.image_canonical_uri,
          contract_id: r.contract_id,
          tx_id: bufferToHexPrefixString(r.tx_id),
          sender_address: r.sender_address,
        };
        return metadata;
      });
      return { results: parsed, total: totalQuery.rows[0].count };
    });
  }
}
