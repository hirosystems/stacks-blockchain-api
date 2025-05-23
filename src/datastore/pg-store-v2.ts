import { BasePgStoreModule, PgSqlClient, has0xPrefix } from '@hirosystems/api-toolkit';
import {
  BlockLimitParamSchema,
  TransactionPaginationQueryParams,
  TransactionLimitParamSchema,
  BlockPaginationQueryParams,
  SmartContractStatusParams,
  AddressParams,
  PoxCyclePaginationQueryParams,
  PoxCycleLimitParamSchema,
  PoxSignerLimitParamSchema,
  BlockIdParam,
  BlockSignerSignatureLimitParamSchema,
} from '../api/routes/v2/schemas';
import { InvalidRequestError, InvalidRequestErrorType } from '../errors';
import { FoundOrNot, normalizeHashString } from '../helpers';
import {
  DbPaginatedResult,
  DbBlock,
  BlockQueryResult,
  DbTx,
  TxQueryResult,
  DbBurnBlock,
  DbTxTypeId,
  DbSmartContractStatus,
  AddressTransfersTxQueryResult,
  DbTxWithAddressTransfers,
  DbEventTypeId,
  DbAddressTransactionEvent,
  DbAssetEventTypeId,
  DbPoxCycle,
  PoxCycleQueryResult,
  DbPoxCycleSigner,
  DbPoxCycleSignerStacker,
  DbCursorPaginatedResult,
  PoxSyntheticEventQueryResult,
} from './common';
import {
  BLOCK_COLUMNS,
  parseBlockQueryResult,
  TX_COLUMNS,
  parseTxQueryResult,
  parseAccountTransferSummaryTxQueryResult,
  POX4_SYNTHETIC_EVENT_COLUMNS,
  parseDbPoxSyntheticEvent,
} from './helpers';
import { SyntheticPoxEventName } from '../pox-helpers';

async function assertTxIdExists(sql: PgSqlClient, tx_id: string) {
  const txCheck = await sql`SELECT tx_id FROM txs WHERE tx_id = ${tx_id} LIMIT 1`;
  if (txCheck.count === 0)
    throw new InvalidRequestError(`Transaction not found`, InvalidRequestErrorType.invalid_param);
}

export class PgStoreV2 extends BasePgStoreModule {
  async getBlocks(args: {
    limit: number;
    offset?: number;
    cursor?: string;
    tenureHeight?: number;
  }): Promise<DbCursorPaginatedResult<DbBlock>> {
    return await this.sqlTransaction(async sql => {
      const limit = args.limit;
      const offset = args.offset ?? 0;
      const cursor = args.cursor ?? null;
      const tenureFilter = args.tenureHeight
        ? sql`AND tenure_height = ${args.tenureHeight}`
        : sql``;

      const blocksQuery = await sql<
        (BlockQueryResult & { total: number; next_block_hash: string; prev_block_hash: string })[]
      >`
      WITH cursor_block AS (
        WITH ordered_blocks AS (
          SELECT *, LEAD(block_height, ${offset}) OVER (ORDER BY block_height DESC) offset_block_height
          FROM blocks
          WHERE canonical = true ${tenureFilter}
          ORDER BY block_height DESC
        )
        SELECT offset_block_height as block_height
        FROM ordered_blocks
        WHERE index_block_hash = ${cursor ?? sql`(SELECT index_block_hash FROM chain_tip LIMIT 1)`}
        LIMIT 1
      ),
      selected_blocks AS (
        SELECT ${sql(BLOCK_COLUMNS)}
        FROM blocks
        WHERE canonical = true
          ${tenureFilter}
          AND block_height <= (SELECT block_height FROM cursor_block)
        ORDER BY block_height DESC
        LIMIT ${limit}
      ),
      prev_page AS (
        SELECT index_block_hash as prev_block_hash
        FROM blocks
        WHERE canonical = true
          ${tenureFilter}
          AND block_height < (
            SELECT block_height
            FROM selected_blocks
            ORDER BY block_height DESC
            LIMIT 1
          )
        ORDER BY block_height DESC
        OFFSET ${limit - 1}
        LIMIT 1
      ),
      next_page AS (
        SELECT index_block_hash as next_block_hash
        FROM blocks
        WHERE canonical = true
          ${tenureFilter}
          AND block_height > (
            SELECT block_height
            FROM selected_blocks
            ORDER BY block_height DESC
            LIMIT 1
          )
        ORDER BY block_height ASC
        OFFSET ${limit - 1}
        LIMIT 1
      ),
      block_count AS (
        SELECT ${
          args.tenureHeight
            ? sql`(SELECT COUNT(*) FROM blocks WHERE tenure_height = ${args.tenureHeight})::int`
            : sql`(SELECT block_count FROM chain_tip)::int`
        } AS total
      )
      SELECT
        (SELECT total FROM block_count) AS total,
        sb.*,
        nb.next_block_hash,
        pb.prev_block_hash
      FROM selected_blocks sb
      LEFT JOIN next_page nb ON true
      LEFT JOIN prev_page pb ON true
      ORDER BY sb.block_height DESC
      `;

      // Parse blocks
      const blocks = blocksQuery.map(b => parseBlockQueryResult(b));
      const total = blocksQuery[0]?.total ?? 0;

      // Determine cursors
      const nextCursor = blocksQuery[0]?.next_block_hash ?? null;
      const prevCursor = blocksQuery[0]?.prev_block_hash ?? null;
      const currentCursor = blocksQuery[0]?.index_block_hash ?? null;

      const result: DbCursorPaginatedResult<DbBlock> = {
        limit,
        offset: offset,
        results: blocks,
        total: total,
        next_cursor: nextCursor,
        prev_cursor: prevCursor,
        current_cursor: currentCursor,
      };
      return result;
    });
  }

  async getBlocksByBurnBlock(args: {
    block: BlockIdParam;
    limit?: number;
    offset?: number;
  }): Promise<DbPaginatedResult<DbBlock>> {
    return await this.sqlTransaction(async sql => {
      const limit = args.limit ?? BlockLimitParamSchema.default;
      const offset = args.offset ?? 0;
      const filter =
        args.block.type === 'latest'
          ? sql`burn_block_hash = (SELECT burn_block_hash FROM blocks WHERE canonical = TRUE ORDER BY block_height DESC LIMIT 1)`
          : args.block.type === 'hash'
          ? sql`burn_block_hash = ${normalizeHashString(args.block.hash)}`
          : sql`burn_block_height = ${args.block.height}`;
      const blockCheck = await sql`SELECT burn_block_hash FROM blocks WHERE ${filter} LIMIT 1`;
      if (blockCheck.count === 0)
        throw new InvalidRequestError(
          `Burn block not found`,
          InvalidRequestErrorType.invalid_param
        );

      const blocksQuery = await sql<(BlockQueryResult & { total: number })[]>`
        WITH block_count AS (
          SELECT COUNT(*) AS count FROM blocks WHERE canonical = TRUE AND ${filter}
        )
        SELECT
          ${sql(BLOCK_COLUMNS)},
          (SELECT count FROM block_count)::int AS total
        FROM blocks
        WHERE canonical = true AND ${filter}
        ORDER BY block_height DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `;
      if (blocksQuery.count === 0)
        return {
          limit,
          offset,
          results: [],
          total: 0,
        };
      const blocks = blocksQuery.map(b => parseBlockQueryResult(b));
      return {
        limit,
        offset,
        results: blocks,
        total: blocksQuery[0].total,
      };
    });
  }

  async getBlock(args: BlockIdParam): Promise<DbBlock | undefined> {
    return await this.sqlTransaction(async sql => {
      const filter =
        args.type === 'latest'
          ? sql`index_block_hash = (SELECT index_block_hash FROM blocks WHERE canonical = TRUE ORDER BY block_height DESC LIMIT 1)`
          : args.type === 'hash'
          ? sql`(
              block_hash = ${normalizeHashString(args.hash)}
              OR index_block_hash = ${normalizeHashString(args.hash)}
            )`
          : sql`block_height = ${args.height}`;
      const blockQuery = await sql<BlockQueryResult[]>`
        SELECT ${sql(BLOCK_COLUMNS)}
        FROM blocks
        WHERE canonical = true AND ${filter}
        LIMIT 1
      `;
      if (blockQuery.count > 0) return parseBlockQueryResult(blockQuery[0]);
    });
  }

  async getBlockSignerSignature(args: {
    blockId: BlockIdParam;
    limit?: number;
    offset?: number;
  }): Promise<DbPaginatedResult<string>> {
    return await this.sqlTransaction(async sql => {
      const limit = args.limit ?? BlockSignerSignatureLimitParamSchema.default;
      const offset = args.offset ?? 0;
      const blockId = args.blockId;
      const filter =
        blockId.type === 'latest'
          ? sql`index_block_hash = (SELECT index_block_hash FROM blocks WHERE canonical = TRUE ORDER BY block_height DESC LIMIT 1)`
          : blockId.type === 'hash'
          ? sql`(
              block_hash = ${normalizeHashString(blockId.hash)}
              OR index_block_hash = ${normalizeHashString(blockId.hash)}
            )`
          : sql`block_height = ${blockId.height}`;
      const blockQuery = await sql<{ signer_signatures: string[]; total: number }[]>`
        SELECT
          signer_signatures[${offset + 1}:${offset + limit}] as signer_signatures,
          array_length(signer_signatures, 1)::integer AS total
        FROM blocks
        WHERE canonical = true AND ${filter}
        LIMIT 1
      `;
      if (blockQuery.count === 0)
        return {
          limit,
          offset,
          results: [],
          total: 0,
        };
      return {
        limit,
        offset,
        results: blockQuery[0].signer_signatures,
        total: blockQuery[0].total,
      };
    });
  }

  async getAverageBlockTimes(): Promise<{
    last_1h: number;
    last_24h: number;
    last_7d: number;
    last_30d: number;
  }> {
    return await this.sqlTransaction(async sql => {
      // Query against block_time but fallback to burn_block_time if block_time is 0 (work around for recent bug).
      // TODO: remove the burn_block_time fallback once all blocks for last N time have block_time set.
      const avgBlockTimeQuery = await sql<
        {
          last_1h: string | null;
          last_24h: string | null;
          last_7d: string | null;
          last_30d: string | null;
        }[]
      >`
        WITH TimeThresholds AS (
          SELECT
            FLOOR(EXTRACT(EPOCH FROM NOW() - INTERVAL '1 HOUR'))::INT AS h1,
            FLOOR(EXTRACT(EPOCH FROM NOW() - INTERVAL '24 HOURS'))::INT AS h24,
            FLOOR(EXTRACT(EPOCH FROM NOW() - INTERVAL '7 DAYS'))::INT AS d7,
            FLOOR(EXTRACT(EPOCH FROM NOW() - INTERVAL '30 DAYS'))::INT AS d30
        ),
        OrderedCanonicalBlocks AS (
          SELECT
            CASE WHEN block_time = 0 THEN burn_block_time ELSE block_time END AS effective_time,
            LAG(CASE WHEN block_time = 0 THEN burn_block_time ELSE block_time END) OVER (ORDER BY block_height) AS prev_time
          FROM
            blocks
          WHERE
            canonical = true AND
            (CASE WHEN block_time = 0 THEN burn_block_time ELSE block_time END) >= (SELECT d30 FROM TimeThresholds)
        )
        SELECT
          AVG(CASE WHEN effective_time >= (SELECT h1 FROM TimeThresholds) THEN effective_time - prev_time ELSE NULL END) AS last_1h,
          AVG(CASE WHEN effective_time >= (SELECT h24 FROM TimeThresholds) THEN effective_time - prev_time ELSE NULL END) AS last_24h,
          AVG(CASE WHEN effective_time >= (SELECT d7 FROM TimeThresholds) THEN effective_time - prev_time ELSE NULL END) AS last_7d,
          AVG(effective_time - prev_time) AS last_30d
        FROM
          OrderedCanonicalBlocks
        WHERE
          prev_time IS NOT NULL
      `;
      const times = {
        last_1h: Number.parseFloat(avgBlockTimeQuery[0]?.last_1h ?? '0'),
        last_24h: Number.parseFloat(avgBlockTimeQuery[0]?.last_24h ?? '0'),
        last_7d: Number.parseFloat(avgBlockTimeQuery[0]?.last_7d ?? '0'),
        last_30d: Number.parseFloat(avgBlockTimeQuery[0]?.last_30d ?? '0'),
      };
      return times;
    });
  }

  async getBlockTransactions(args: {
    block: BlockIdParam;
    limit?: number;
    offset?: number;
  }): Promise<DbPaginatedResult<DbTx>> {
    return await this.sqlTransaction(async sql => {
      const limit = args.limit ?? TransactionLimitParamSchema.default;
      const offset = args.offset ?? 0;
      const txsQuery = await sql<(TxQueryResult & { total: number })[]>`
        WITH block_ptr AS (
          SELECT index_block_hash FROM blocks
          WHERE ${
            args.block.type === 'latest'
              ? sql`canonical = TRUE ORDER BY block_height DESC`
              : args.block.type === 'hash'
              ? sql`(
                  block_hash = ${normalizeHashString(args.block.hash)}
                  OR index_block_hash = ${normalizeHashString(args.block.hash)}
                ) AND canonical = TRUE`
              : sql`block_height = ${args.block.height} AND canonical = TRUE`
          }
          LIMIT 1
        ),
        tx_count AS (
          SELECT tx_count AS total
          FROM blocks
          WHERE index_block_hash = (SELECT index_block_hash FROM block_ptr)
        )
        SELECT ${sql(TX_COLUMNS)}, (SELECT total FROM tx_count)::int AS total
        FROM txs
        WHERE canonical = true
          AND microblock_canonical = true
          AND index_block_hash = (SELECT index_block_hash FROM block_ptr)
        ORDER BY microblock_sequence ASC, tx_index ASC
        LIMIT ${limit}
        OFFSET ${offset}
      `;
      if (txsQuery.count === 0)
        throw new InvalidRequestError(`Block not found`, InvalidRequestErrorType.invalid_param);
      return {
        limit,
        offset,
        results: txsQuery.map(t => parseTxQueryResult(t)),
        total: txsQuery[0].total,
      };
    });
  }

  async getBurnBlocks(args: BlockPaginationQueryParams): Promise<DbPaginatedResult<DbBurnBlock>> {
    return await this.sqlTransaction(async sql => {
      const limit = args.limit ?? BlockLimitParamSchema.default;
      const offset = args.offset ?? 0;
      const blocksQuery = await sql<(DbBurnBlock & { total: number })[]>`
        WITH RelevantBlocks AS (
          SELECT DISTINCT ON (burn_block_height)
            burn_block_time,
            burn_block_hash,
            burn_block_height
          FROM blocks
          WHERE canonical = true
          ORDER BY burn_block_height DESC, block_height DESC
          LIMIT ${limit}
          OFFSET ${offset}
        ),
        BlocksWithPrevTime AS (
          SELECT
            b.burn_block_time,
            b.burn_block_hash,
            b.burn_block_height,
            b.block_hash,
            b.block_time,
            b.block_height,
            b.tx_count,
            LAG(b.block_time) OVER (PARTITION BY b.burn_block_height ORDER BY b.block_height) AS previous_block_time
          FROM blocks b
          WHERE
            canonical = true AND
            b.burn_block_height IN (SELECT burn_block_height FROM RelevantBlocks)
        ),
        BlockStatistics AS (
          SELECT
            burn_block_height,
            AVG(block_time - previous_block_time) FILTER (WHERE previous_block_time IS NOT NULL) AS avg_block_time,
            SUM(tx_count) AS total_tx_count
          FROM BlocksWithPrevTime
          GROUP BY burn_block_height
        )
        SELECT DISTINCT ON (r.burn_block_height)
          r.burn_block_time,
          r.burn_block_hash,
          r.burn_block_height,
          ARRAY_AGG(b.block_hash) OVER (
            PARTITION BY r.burn_block_height
            ORDER BY b.block_height DESC
            ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
          ) AS stacks_blocks,
          (SELECT block_count FROM chain_tip)::int AS total,
          a.avg_block_time,
          a.total_tx_count
        FROM RelevantBlocks r
        JOIN BlocksWithPrevTime b ON b.burn_block_height = r.burn_block_height
        JOIN BlockStatistics a ON a.burn_block_height = r.burn_block_height
        ORDER BY r.burn_block_height DESC, b.block_height DESC;
      `;
      return {
        limit,
        offset,
        results: blocksQuery,
        total: blocksQuery.count > 0 ? blocksQuery[0].total : 0,
      };
    });
  }

  async getBurnBlock(args: BlockIdParam): Promise<DbBurnBlock | undefined> {
    return await this.sqlTransaction(async sql => {
      const filter =
        args.type === 'latest'
          ? sql`burn_block_hash = (SELECT burn_block_hash FROM blocks WHERE canonical = TRUE ORDER BY block_height DESC LIMIT 1)`
          : args.type === 'hash'
          ? sql`burn_block_hash = ${args.hash}`
          : sql`burn_block_height = ${args.height}`;
      const blockQuery = await sql<DbBurnBlock[]>`
        WITH BlocksWithPrevTime AS (
          SELECT
            burn_block_time,
            burn_block_hash,
            burn_block_height,
            block_hash,
            block_time,
            block_height,
            tx_count,
            LAG(block_time) OVER (PARTITION BY burn_block_height ORDER BY block_height) AS previous_block_time
          FROM blocks
          WHERE canonical = true AND ${filter}
        ),
        BlockStatistics AS (
          SELECT
            burn_block_height,
            AVG(block_time - previous_block_time) FILTER (WHERE previous_block_time IS NOT NULL) AS avg_block_time,
            SUM(tx_count) AS total_tx_count
          FROM BlocksWithPrevTime
          GROUP BY burn_block_height
        )
        SELECT DISTINCT ON (b.burn_block_height)
          b.burn_block_time,
          b.burn_block_hash,
          b.burn_block_height,
          ARRAY_AGG(b.block_hash) OVER (
            PARTITION BY b.burn_block_height
            ORDER BY b.block_height DESC
            ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
          ) AS stacks_blocks,
          a.avg_block_time,
          a.total_tx_count
        FROM BlocksWithPrevTime b
        JOIN BlockStatistics a ON a.burn_block_height = b.burn_block_height
        LIMIT 1
      `;
      if (blockQuery.count > 0) return blockQuery[0];
    });
  }

  async getSmartContractStatus(args: SmartContractStatusParams): Promise<DbSmartContractStatus[]> {
    return await this.sqlTransaction(async sql => {
      const statusArray: DbSmartContractStatus[] = [];
      const contractArray = Array.isArray(args.contract_id) ? args.contract_id : [args.contract_id];

      // Search confirmed txs.
      const confirmed = await sql<DbSmartContractStatus[]>`
        SELECT DISTINCT ON (smart_contract_contract_id) smart_contract_contract_id, tx_id, block_height, status
        FROM txs
        WHERE type_id IN ${sql([DbTxTypeId.SmartContract, DbTxTypeId.VersionedSmartContract])}
          AND smart_contract_contract_id IN ${sql(contractArray)}
          AND canonical = TRUE
          AND microblock_canonical = TRUE
        ORDER BY smart_contract_contract_id, block_height DESC, microblock_sequence DESC, tx_index DESC, status
      `;
      statusArray.push(...confirmed);
      if (confirmed.count < contractArray.length) {
        // Search mempool txs.
        const confirmedIds = confirmed.map(c => c.smart_contract_contract_id);
        const remainingIds = contractArray.filter(c => !confirmedIds.includes(c));
        const mempool = await sql<DbSmartContractStatus[]>`
          SELECT DISTINCT ON (smart_contract_contract_id) smart_contract_contract_id, tx_id, status
          FROM mempool_txs
          WHERE pruned = FALSE
            AND type_id IN ${sql([DbTxTypeId.SmartContract, DbTxTypeId.VersionedSmartContract])}
            AND smart_contract_contract_id IN ${sql(remainingIds)}
          ORDER BY smart_contract_contract_id, nonce
        `;
        statusArray.push(...mempool);
      }

      return statusArray;
    });
  }

  async getAddressTransactions(
    args: AddressParams & TransactionPaginationQueryParams
  ): Promise<DbPaginatedResult<DbTxWithAddressTransfers>> {
    return await this.sqlTransaction(async sql => {
      const limit = args.limit ?? TransactionLimitParamSchema.default;
      const offset = args.offset ?? 0;

      const eventCond = sql`
        tx_id = address_txs.tx_id
        AND index_block_hash = address_txs.index_block_hash
        AND microblock_hash = address_txs.microblock_hash
      `;
      const eventAcctCond = sql`
        ${eventCond} AND (sender = ${args.address} OR recipient = ${args.address})
      `;
      const resultQuery = await sql<(AddressTransfersTxQueryResult & { count: number })[]>`
        WITH address_txs AS (
          (
            SELECT tx_id, index_block_hash, microblock_hash
            FROM principal_stx_txs
            WHERE principal = ${args.address}
          )
          UNION
          (
            SELECT tx_id, index_block_hash, microblock_hash
            FROM stx_events
            WHERE sender = ${args.address} OR recipient = ${args.address}
          )
          UNION
          (
            SELECT tx_id, index_block_hash, microblock_hash
            FROM ft_events
            WHERE sender = ${args.address} OR recipient = ${args.address}
          )
          UNION
          (
            SELECT tx_id, index_block_hash, microblock_hash
            FROM nft_events
            WHERE sender = ${args.address} OR recipient = ${args.address}
          )
        ),
        count AS (
          SELECT COUNT(*)::int AS total_count
          FROM address_txs
          INNER JOIN txs USING (tx_id, index_block_hash, microblock_hash)
          WHERE canonical = TRUE AND microblock_canonical = TRUE
        )
        SELECT
          ${sql(TX_COLUMNS)},
          (
            SELECT COALESCE(SUM(amount), 0)
            FROM stx_events
            WHERE ${eventCond} AND sender = ${args.address}
          ) +
          CASE
            WHEN (txs.sponsored = false AND txs.sender_address = ${args.address})
              OR (txs.sponsored = true AND txs.sponsor_address = ${args.address})
            THEN txs.fee_rate ELSE 0
          END AS stx_sent,
          (
            SELECT COALESCE(SUM(amount), 0)
            FROM stx_events
            WHERE ${eventCond} AND recipient = ${args.address}
          ) AS stx_received,
          (
            SELECT COUNT(*)::int FROM stx_events
            WHERE ${eventAcctCond} AND asset_event_type_id = ${DbAssetEventTypeId.Transfer}
          ) AS stx_transfer,
          (
            SELECT COUNT(*)::int FROM stx_events
            WHERE ${eventAcctCond} AND asset_event_type_id = ${DbAssetEventTypeId.Mint}
          ) AS stx_mint,
          (
            SELECT COUNT(*)::int FROM stx_events
            WHERE ${eventAcctCond} AND asset_event_type_id = ${DbAssetEventTypeId.Burn}
          ) AS stx_burn,
          (
            SELECT COUNT(*)::int FROM ft_events
            WHERE ${eventAcctCond} AND asset_event_type_id = ${DbAssetEventTypeId.Transfer}
          ) AS ft_transfer,
          (
            SELECT COUNT(*)::int FROM ft_events
            WHERE ${eventAcctCond} AND asset_event_type_id = ${DbAssetEventTypeId.Mint}
          ) AS ft_mint,
          (
            SELECT COUNT(*)::int FROM ft_events
            WHERE ${eventAcctCond} AND asset_event_type_id = ${DbAssetEventTypeId.Burn}
          ) AS ft_burn,
          (
            SELECT COUNT(*)::int FROM nft_events
            WHERE ${eventAcctCond} AND asset_event_type_id = ${DbAssetEventTypeId.Transfer}
          ) AS nft_transfer,
          (
            SELECT COUNT(*)::int FROM nft_events
            WHERE ${eventAcctCond} AND asset_event_type_id = ${DbAssetEventTypeId.Mint}
          ) AS nft_mint,
          (
            SELECT COUNT(*)::int FROM nft_events
            WHERE ${eventAcctCond} AND asset_event_type_id = ${DbAssetEventTypeId.Burn}
          ) AS nft_burn,
          (SELECT total_count FROM count) AS count
        FROM address_txs
        INNER JOIN txs USING (tx_id, index_block_hash, microblock_hash)
        WHERE canonical = TRUE AND microblock_canonical = TRUE
        ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `;
      const total = resultQuery.length > 0 ? resultQuery[0].count : 0;
      const parsed = resultQuery.map(r => parseAccountTransferSummaryTxQueryResult(r));
      return {
        total,
        limit,
        offset,
        results: parsed,
      };
    });
  }

  async getAddressTransactionEvents(args: {
    limit: number;
    offset: number;
    tx_id: string;
    address: string;
  }): Promise<DbPaginatedResult<DbAddressTransactionEvent>> {
    return await this.sqlTransaction(async sql => {
      await assertTxIdExists(sql, args.tx_id);
      const limit = args.limit ?? TransactionLimitParamSchema.default;
      const offset = args.offset ?? 0;

      const eventCond = sql`
        canonical = true
        AND microblock_canonical = true
        AND tx_id = ${args.tx_id}
        AND (sender = ${args.address} OR recipient = ${args.address})
      `;
      const results = await sql<(DbAddressTransactionEvent & { count: number })[]>`
        WITH events AS (
          (
            SELECT
              sender, recipient, event_index, amount, NULL as asset_identifier,
              NULL::bytea as value, ${DbEventTypeId.StxAsset}::int as event_type_id,
              asset_event_type_id
            FROM stx_events
            WHERE ${eventCond}
          )
          UNION
          (
            SELECT
              sender, recipient, event_index, amount, asset_identifier, NULL::bytea as value,
              ${DbEventTypeId.FungibleTokenAsset}::int as event_type_id, asset_event_type_id
            FROM ft_events
            WHERE ${eventCond}
          )
          UNION
          (
            SELECT
              sender, recipient, event_index, 0 as amount, asset_identifier, value,
              ${DbEventTypeId.NonFungibleTokenAsset}::int as event_type_id, asset_event_type_id
            FROM nft_events
            WHERE ${eventCond}
          )
        )
        SELECT *, COUNT(*) OVER()::int AS count
        FROM events
        ORDER BY event_index ASC
        LIMIT ${limit}
        OFFSET ${offset}
      `;
      const total = results.length > 0 ? results[0].count : 0;
      return {
        total,
        limit,
        offset,
        results,
      };
    });
  }

  async getPoxCycles(args: PoxCyclePaginationQueryParams): Promise<DbPaginatedResult<DbPoxCycle>> {
    return this.sqlTransaction(async sql => {
      const limit = args.limit ?? PoxCycleLimitParamSchema.default;
      const offset = args.offset ?? 0;
      const results = await sql<(PoxCycleQueryResult & { total: number })[]>`
        SELECT
          cycle_number, block_height, index_block_hash, total_weight, total_signers,
          total_stacked_amount, COUNT(*) OVER()::int AS total
        FROM pox_cycles
        WHERE canonical = TRUE
        ORDER BY cycle_number DESC
        OFFSET ${offset}
        LIMIT ${limit}
      `;
      const total = results.length > 0 ? results[0].total : 0;
      return {
        limit,
        offset,
        results: results,
        total,
      };
    });
  }

  async getPoxCycle(args: { cycle_number: number }): Promise<DbPoxCycle | undefined> {
    return this.sqlTransaction(async sql => {
      const results = await sql<PoxCycleQueryResult[]>`
        SELECT
          cycle_number, block_height, index_block_hash, total_weight, total_signers,
          total_stacked_amount
        FROM pox_cycles
        WHERE canonical = TRUE AND cycle_number = ${args.cycle_number}
        LIMIT 1
      `;
      if (results.count > 0) return results[0];
    });
  }

  async getPoxCycleSigners(args: {
    cycle_number: number;
    limit: number;
    offset: number;
  }): Promise<DbPaginatedResult<DbPoxCycleSigner>> {
    return this.sqlTransaction(async sql => {
      const limit = args.limit ?? PoxSignerLimitParamSchema.default;
      const offset = args.offset ?? 0;
      const cycleNumber = args.cycle_number;
      const cycleCheck =
        await sql`SELECT cycle_number FROM pox_cycles WHERE cycle_number = ${args.cycle_number} LIMIT 1`;
      if (cycleCheck.count === 0)
        throw new InvalidRequestError(`PoX cycle not found`, InvalidRequestErrorType.invalid_param);
      const results = await sql<(DbPoxCycleSigner & { total: number })[]>`
        WITH signer_keys AS (
            SELECT DISTINCT ON (stacker) stacker, signer_key
            FROM pox4_events
            WHERE canonical = true AND microblock_canonical = true
                AND name in ('stack-aggregation-commit-indexed', 'stack-aggregation-commit')
                AND start_cycle_id = ${cycleNumber}
                AND end_cycle_id = ${cycleNumber + 1}
            ORDER BY stacker, block_height DESC, tx_index DESC, event_index DESC
        ), delegated_stackers AS (
            SELECT DISTINCT ON (main.stacker)
                main.stacker,
                sk.signer_key
            FROM pox4_events main
            LEFT JOIN signer_keys sk ON main.delegator = sk.stacker
            WHERE main.canonical = true
                AND main.microblock_canonical = true
                AND main.name IN ('delegate-stack-stx', 'delegate-stack-increase', 'delegate-stack-extend')
                AND main.start_cycle_id <= ${cycleNumber}
                AND main.end_cycle_id > ${cycleNumber}
            ORDER BY main.stacker, main.block_height DESC, main.microblock_sequence DESC, main.tx_index DESC, main.event_index DESC
        ), solo_stackers AS (
            SELECT DISTINCT ON (stacker)
                stacker,
                signer_key
            FROM pox4_events
            WHERE canonical = true AND microblock_canonical = true
                AND name in ('stack-stx', 'stacks-increase', 'stack-extend')
                AND start_cycle_id <= ${cycleNumber}
                AND end_cycle_id > ${cycleNumber}
            ORDER BY stacker, block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
        )
        SELECT
            ps.signing_key,
            ps.weight,
            ps.stacked_amount,
            ps.weight_percent,
            ps.stacked_amount_percent,
            COUNT(DISTINCT ds.stacker)::int AS pooled_stacker_count,
            COUNT(DISTINCT ss.stacker)::int AS solo_stacker_count,
            COUNT(*) OVER()::int AS total
        FROM pox_sets ps
        LEFT JOIN delegated_stackers ds ON ps.signing_key = ds.signer_key
        LEFT JOIN solo_stackers ss ON ps.signing_key = ss.signer_key
        WHERE ps.canonical = TRUE AND ps.cycle_number = ${cycleNumber}
        GROUP BY ps.signing_key, ps.weight, ps.stacked_amount, ps.weight_percent, ps.stacked_amount_percent
        ORDER BY ps.weight DESC, ps.stacked_amount DESC, ps.signing_key
        OFFSET ${offset}
        LIMIT ${limit}
      `;
      return {
        limit,
        offset,
        results: results,
        total: results.count > 0 ? results[0].total : 0,
      };
    });
  }

  async getPoxCycleSigner(args: {
    cycle_number: number;
    signer_key: string;
  }): Promise<DbPoxCycleSigner | undefined> {
    return this.sqlTransaction(async sql => {
      const signerKey = has0xPrefix(args.signer_key) ? args.signer_key : '0x' + args.signer_key;
      const cycleNumber = args.cycle_number;
      const cycleCheck =
        await sql`SELECT cycle_number FROM pox_cycles WHERE cycle_number = ${cycleNumber} LIMIT 1`;
      if (cycleCheck.count === 0)
        throw new InvalidRequestError(`PoX cycle not found`, InvalidRequestErrorType.invalid_param);
      const results = await sql<DbPoxCycleSigner[]>`
        WITH signer_keys AS (
            SELECT DISTINCT ON (stacker) stacker, signer_key
            FROM pox4_events
            WHERE canonical = true AND microblock_canonical = true
                AND name in ('stack-aggregation-commit-indexed', 'stack-aggregation-commit')
                AND start_cycle_id = ${cycleNumber}
                AND end_cycle_id = ${cycleNumber + 1}
            ORDER BY stacker, block_height DESC, tx_index DESC, event_index DESC
        ), delegated_stackers AS (
            SELECT DISTINCT ON (main.stacker)
                main.stacker,
                sk.signer_key
            FROM pox4_events main
            LEFT JOIN signer_keys sk ON main.delegator = sk.stacker
            WHERE main.canonical = true
                AND main.microblock_canonical = true
                AND main.name IN ('delegate-stack-stx', 'delegate-stack-increase', 'delegate-stack-extend')
                AND main.start_cycle_id <= ${cycleNumber}
                AND main.end_cycle_id > ${cycleNumber}
            ORDER BY main.stacker, main.block_height DESC, main.microblock_sequence DESC, main.tx_index DESC, main.event_index DESC
        ), solo_stackers AS (
            SELECT DISTINCT ON (stacker)
                stacker,
                signer_key
            FROM pox4_events
            WHERE canonical = true AND microblock_canonical = true
                AND name in ('stack-stx', 'stacks-increase', 'stack-extend')
                AND start_cycle_id <= ${cycleNumber}
                AND end_cycle_id > ${cycleNumber}
            ORDER BY stacker, block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
        )
        SELECT
            ps.signing_key,
            ps.weight,
            ps.stacked_amount,
            ps.weight_percent,
            ps.stacked_amount_percent,
            COUNT(DISTINCT ds.stacker)::int AS pooled_stacker_count,
            COUNT(DISTINCT ss.stacker)::int AS solo_stacker_count
        FROM pox_sets ps
        LEFT JOIN delegated_stackers ds ON ps.signing_key = ds.signer_key
        LEFT JOIN solo_stackers ss ON ps.signing_key = ss.signer_key
        WHERE ps.canonical = TRUE
          AND ps.cycle_number = ${cycleNumber}
          AND ps.signing_key = ${signerKey}
        GROUP BY ps.signing_key, ps.weight, ps.stacked_amount, ps.weight_percent, ps.stacked_amount_percent
        LIMIT 1
      `;
      if (results.count > 0) return results[0];
    });
  }

  async getPoxCycleSignerStackers(args: {
    cycle_number: number;
    signer_key: string;
    limit: number;
    offset: number;
  }): Promise<DbPaginatedResult<DbPoxCycleSignerStacker>> {
    return this.sqlTransaction(async sql => {
      const limit = args.limit ?? PoxSignerLimitParamSchema.default;
      const offset = args.offset ?? 0;
      const signerKey = has0xPrefix(args.signer_key) ? args.signer_key : '0x' + args.signer_key;
      const cycleNumber = args.cycle_number;
      const cycleCheck = await sql`
        SELECT cycle_number FROM pox_cycles WHERE cycle_number = ${cycleNumber} LIMIT 1
      `;
      if (cycleCheck.count === 0)
        throw new InvalidRequestError(`PoX cycle not found`, InvalidRequestErrorType.invalid_param);
      const signerCheck = await sql`
        SELECT signing_key
        FROM pox_sets
        WHERE cycle_number = ${cycleNumber} AND signing_key = ${args.signer_key}
        LIMIT 1
      `;
      if (signerCheck.count === 0)
        throw new InvalidRequestError(
          `PoX cycle signer not found`,
          InvalidRequestErrorType.invalid_param
        );
      const results = await sql<(DbPoxCycleSignerStacker & { total: number })[]>`
        WITH signer_keys AS (
            SELECT DISTINCT ON (stacker) stacker, signer_key
            FROM pox4_events
            WHERE canonical = true AND microblock_canonical = true
                AND name in ('stack-aggregation-commit-indexed', 'stack-aggregation-commit')
                AND start_cycle_id = ${cycleNumber}
                AND end_cycle_id = ${cycleNumber + 1}
            ORDER BY stacker, block_height DESC, tx_index DESC, event_index DESC
        ), delegated_stackers AS (
            SELECT DISTINCT ON (main.stacker)
                main.stacker,
                sk.signer_key,
                main.locked,
                main.pox_addr,
                main.name,
                main.amount_ustx,
                'pooled' as stacker_type
            FROM pox4_events main
            LEFT JOIN signer_keys sk ON main.delegator = sk.stacker
            WHERE main.canonical = true
                AND main.microblock_canonical = true
                AND main.name IN ('delegate-stack-stx', 'delegate-stack-increase', 'delegate-stack-extend')
                AND main.start_cycle_id <= ${cycleNumber}
                AND main.end_cycle_id > ${cycleNumber}
            ORDER BY main.stacker, main.block_height DESC, main.microblock_sequence DESC, main.tx_index DESC, main.event_index DESC
        ), solo_stackers AS (
            SELECT DISTINCT ON (stacker)
                stacker,
                signer_key,
                locked,
                pox_addr,
                name,
                amount_ustx,
                'solo' as stacker_type
            FROM pox4_events
            WHERE canonical = true AND microblock_canonical = true
                AND name in ('stack-stx', 'stacks-increase', 'stack-extend')
                AND start_cycle_id <= ${cycleNumber}
                AND end_cycle_id > ${cycleNumber}
            ORDER BY stacker, block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
        ), combined_stackers AS (
            SELECT * FROM delegated_stackers
            UNION ALL
            SELECT * FROM solo_stackers
        )
        SELECT
            ps.signing_key,
            cs.stacker,
            cs.locked,
            cs.pox_addr,
            cs.name,
            cs.amount_ustx,
            cs.stacker_type,
            COUNT(*) OVER()::int AS total
        FROM pox_sets ps
        INNER JOIN combined_stackers cs ON ps.signing_key = cs.signer_key
        WHERE ps.canonical = TRUE 
          AND ps.cycle_number = ${cycleNumber} 
          AND ps.signing_key = ${signerKey}
        ORDER BY locked DESC
        LIMIT ${limit}
        OFFSET ${offset}
      `;
      return {
        limit,
        offset,
        results: results,
        total: results.count > 0 ? results[0].total : 0,
      };
    });
  }

  async getStxMinerRewardsAtBlock({
    sql,
    stxAddress,
    blockHeight,
  }: {
    sql: PgSqlClient;
    stxAddress: string;
    blockHeight: number;
  }) {
    const minerRewardQuery = await sql<{ amount: string }[]>`
      SELECT sum(
        coinbase_amount + tx_fees_anchored + tx_fees_streamed_confirmed + tx_fees_streamed_produced
      ) amount
      FROM miner_rewards
      WHERE canonical = true AND recipient = ${stxAddress} AND mature_block_height <= ${blockHeight}
    `;
    const totalRewards = BigInt(minerRewardQuery[0]?.amount ?? 0);
    return {
      totalMinerRewardsReceived: totalRewards,
    };
  }

  async getFungibleTokenHolderBalances(args: {
    sql: PgSqlClient;
    stxAddress: string;
    limit: number;
    offset: number;
  }): Promise<
    DbPaginatedResult<{
      token: string;
      balance: string;
    }>
  > {
    const queryResp = await args.sql<{ token: string; balance: string; total: string }[]>`
      WITH filtered AS (
        SELECT token, balance
        FROM ft_balances
        WHERE address = ${args.stxAddress}
          AND balance > 0
          AND token != 'stx'
      )
      SELECT token, balance, COUNT(*) OVER() AS total
      FROM filtered
      ORDER BY LOWER(token)
      LIMIT ${args.limit}
      OFFSET ${args.offset};
    `;
    const parsed = queryResp.map(({ token, balance }) => ({ token, balance }));
    const total = queryResp.length > 0 ? parseInt(queryResp[0].total) : 0;
    return {
      limit: args.limit,
      offset: args.offset,
      total,
      results: parsed,
    };
  }

  async getStxHolderBalance(args: {
    sql: PgSqlClient;
    stxAddress: string;
  }): Promise<FoundOrNot<{ balance: bigint }>> {
    const [result] = await args.sql<{ balance: string }[]>`
      SELECT token, balance FROM ft_balances
      WHERE address = ${args.stxAddress}
        AND token = 'stx'
      LIMIT 1
    `;
    if (!result) {
      return { found: false };
    }
    return {
      found: true,
      result: { balance: BigInt(result.balance) },
    };
  }

  async getFtHolderBalance(args: {
    sql: PgSqlClient;
    stxAddress: string;
    token: string;
  }): Promise<FoundOrNot<{ balance: bigint }>> {
    const [result] = await args.sql<{ balance: string }[]>`
      SELECT token, balance FROM ft_balances
      WHERE address = ${args.stxAddress}
        AND token = ${args.token}
      LIMIT 1
    `;
    if (!result) {
      return { found: false };
    }
    return {
      found: true,
      result: { balance: BigInt(result.balance) },
    };
  }

  async getStxPoxLockedAtBlock({
    sql,
    stxAddress,
    blockHeight,
    burnBlockHeight,
  }: {
    sql: PgSqlClient;
    stxAddress: string;
    blockHeight: number;
    burnBlockHeight: number;
  }) {
    let lockTxId: string = '';
    let locked: bigint = 0n;
    let lockHeight = 0;
    let burnchainLockHeight = 0;
    let burnchainUnlockHeight = 0;

    // == PoX-4 ================================================================
    // Query for the latest lock event that still applies to the current burn block height.
    // Special case for `handle-unlock` which should be returned if it is the last received event.

    const pox4EventQuery = await sql<PoxSyntheticEventQueryResult[]>`
          SELECT ${sql(POX4_SYNTHETIC_EVENT_COLUMNS)}
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
      if (pox4Event.name !== SyntheticPoxEventName.HandleUnlock) {
        lockTxId = pox4Event.tx_id;
        locked = pox4Event.locked;
        burnchainUnlockHeight = Number(pox4Event.burnchain_unlock_height);
        lockHeight = pox4Event.block_height;

        const [burnBlockQuery] = await sql<{ burn_block_height: string }[]>`
          SELECT burn_block_height FROM blocks
          WHERE block_height = ${blockHeight} AND canonical = true
          LIMIT 1
        `;
        burnchainLockHeight = parseInt(burnBlockQuery?.burn_block_height ?? '0');
      }
    }

    return {
      lockTxId,
      locked,
      lockHeight,
      burnchainLockHeight,
      burnchainUnlockHeight,
    };
  }
}
