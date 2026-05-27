import { BasePgStoreModule } from '@stacks/api-toolkit';
import {
  DbCursorPaginatedResult,
  DbMempoolTransaction,
  DbMempoolTransactionSummary,
  DbPrincipalTransactionSummary,
  DbTransaction,
  DbTransactionEvent,
  DbTransactionSummary,
} from './types.js';
import {
  MEMPOOL_TX_COLUMNS,
  MEMPOOL_TX_SUMMARY_COLUMNS,
  TX_COLUMNS,
  TX_SUMMARY_COLUMNS,
} from './constants.js';
import { prefixedCols } from '../helpers.js';
import { Principal } from '../../api/schemas/v3/entities/common.js';
import { normalizeHashString } from '../../helpers.js';
import { BlockIdParam } from '../../api/routes/v2/schemas.js';
import { InvalidRequestError, InvalidRequestErrorType } from '../../errors.js';
import { TransactionIncludeField } from '../../api/schemas/v3/entities/transactions.js';
import type { TransactionCursor, TransactionEventCursor } from '../../api/schemas/v3/cursors.js';
import { encodeTransactionCursor, resolveTransactionCursor } from './helpers.js';
import { DbEventTypeId } from '../common.js';

export class PgStoreV3 extends BasePgStoreModule {
  /**
   * Gets the summaries for all transactions.
   * @param args - The arguments for the query.
   * @returns The summaries for all transactions.
   */
  async getTransactionSummaries(args: {
    limit: number;
    cursor?: TransactionCursor;
  }): Promise<DbCursorPaginatedResult<DbTransactionSummary>> {
    return await this.sqlTransaction(async sql => {
      let cursorFilter = sql``;
      if (args.cursor) {
        const cursor = await resolveTransactionCursor(args.cursor, async cursor => {
          const exactCursorQuery = await sql<{ exists: boolean }[]>`
            SELECT EXISTS (
              SELECT 1
              FROM txs
              WHERE canonical = true
                AND microblock_canonical = true
                AND (block_height, microblock_sequence, tx_index)
                    = (${cursor.block_height}, ${cursor.microblock_sequence}, ${cursor.tx_index})
            ) AS exists
          `;
          return exactCursorQuery[0]?.exists ?? false;
        });
        cursorFilter = sql`
          AND (block_height, microblock_sequence, tx_index)
              <= (${cursor.block_height}, ${cursor.microblock_sequence}, ${cursor.tx_index})
        `;
      }
      const resultQuery = await sql<
        (DbTransactionSummary & { microblock_sequence: number; total: number })[]
      >`
        SELECT
          ${sql(TX_SUMMARY_COLUMNS)},
          (SELECT tx_count FROM chain_tip) AS total
        FROM txs
        WHERE canonical = true
          AND microblock_canonical = true
          ${cursorFilter}
        ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC
        LIMIT ${args.limit + 1}
      `;

      const hasNextPage = resultQuery.count > args.limit;
      const results = hasNextPage ? resultQuery.slice(0, args.limit) : resultQuery;
      const total = resultQuery.count > 0 ? resultQuery[0].total : 0;

      const nextResult = resultQuery[resultQuery.length - 1];
      const nextCursor = hasNextPage && nextResult ? encodeTransactionCursor(nextResult) : null;

      const firstResult = results[0];
      const currentCursor = firstResult ? encodeTransactionCursor(firstResult) : null;

      let prevCursor: string | null = null;
      if (firstResult) {
        const prevPageQuery = await sql<
          { block_height: number; microblock_sequence: number; tx_index: number }[]
        >`
          SELECT block_height, microblock_sequence, tx_index
          FROM txs
          WHERE canonical = true
            AND microblock_canonical = true
            AND (block_height, microblock_sequence, tx_index)
                > (
                  ${firstResult.block_height},
                  ${firstResult.microblock_sequence},
                  ${firstResult.tx_index}
                )
          ORDER BY block_height ASC, microblock_sequence ASC, tx_index ASC
          LIMIT ${args.limit}
        `;
        if (prevPageQuery.length > 0) {
          const prevPage = prevPageQuery[prevPageQuery.length - 1];
          prevCursor = encodeTransactionCursor(prevPage);
        }
      }

      return {
        limit: args.limit,
        offset: 0,
        next_cursor: nextCursor,
        prev_cursor: prevCursor,
        current_cursor: currentCursor,
        total,
        results,
      };
    });
  }

  /**
   * Gets the summaries for a principal's transactions.
   * @param args - The arguments for the query.
   * @returns The summaries for the principal's transactions.
   */
  async getPrincipalTransactionSummaries(args: {
    principal: Principal;
    limit: number;
    cursor?: TransactionCursor;
  }): Promise<DbCursorPaginatedResult<DbPrincipalTransactionSummary>> {
    return await this.sqlTransaction(async sql => {
      let cursorFilter = sql``;
      if (args.cursor) {
        const cursor = await resolveTransactionCursor(args.cursor, async cursor => {
          const exactCursorQuery = await sql<{ exists: boolean }[]>`
            SELECT EXISTS (
              SELECT 1
              FROM principal_txs
              WHERE canonical = true
                AND microblock_canonical = true
                AND principal = ${args.principal}
                AND (block_height, microblock_sequence, tx_index)
                    = (${cursor.block_height}, ${cursor.microblock_sequence}, ${cursor.tx_index})
            ) AS exists
          `;
          return exactCursorQuery[0]?.exists ?? false;
        });
        cursorFilter = sql`
          AND (block_height, microblock_sequence, tx_index)
              <= (${cursor.block_height}, ${cursor.microblock_sequence}, ${cursor.tx_index})
        `;
      }
      const resultQuery = await sql<
        (DbPrincipalTransactionSummary & { microblock_sequence: number; total: number })[]
      >`
        WITH p AS (
          SELECT
            tx_id,
            index_block_hash,
            microblock_hash,
            block_height,
            microblock_sequence,
            tx_index,
            stx_sent,
            stx_received,
            stx_balance_affected,
            ft_balance_affected,
            nft_balance_affected
          FROM principal_txs
          WHERE canonical = true
            AND microblock_canonical = true
            AND principal = ${args.principal}
            ${cursorFilter}
          ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC
          LIMIT ${args.limit + 1}
        )
        SELECT
          ${sql(prefixedCols(TX_SUMMARY_COLUMNS, 't'))},
          p.stx_sent,
          p.stx_received,
          (p.stx_received - p.stx_sent) AS stx_net,
          p.stx_balance_affected,
          p.ft_balance_affected,
          p.nft_balance_affected,
          CASE
            WHEN t.sender_address = ${args.principal} THEN 'sender'
            WHEN t.sponsor_address = ${args.principal} THEN 'sponsor'
            ELSE 'affected'
          END AS involvement,
          (
            SELECT COALESCE(count, 0)::int FROM principal_tx_counts WHERE principal = ${args.principal}
          ) AS total
        FROM p
        INNER JOIN txs AS t USING (tx_id, index_block_hash, microblock_hash)
        ORDER BY p.block_height DESC, p.microblock_sequence DESC, p.tx_index DESC
      `;

      const hasNextPage = resultQuery.count > args.limit;
      const results = hasNextPage ? resultQuery.slice(0, args.limit) : resultQuery;
      const total = resultQuery.count > 0 ? resultQuery[0].total : 0;

      const nextResult = resultQuery[resultQuery.length - 1];
      const nextCursor = hasNextPage && nextResult ? encodeTransactionCursor(nextResult) : null;

      const firstResult = results[0];
      const currentCursor = firstResult ? encodeTransactionCursor(firstResult) : null;

      let prevCursor: string | null = null;
      if (firstResult) {
        const prevPageQuery = await sql<
          { block_height: number; microblock_sequence: number; tx_index: number }[]
        >`
          SELECT block_height, microblock_sequence, tx_index
          FROM principal_txs
          WHERE canonical = true
            AND microblock_canonical = true
            AND principal = ${args.principal}
            AND (block_height, microblock_sequence, tx_index)
                > (
                  ${firstResult.block_height},
                  ${firstResult.microblock_sequence},
                  ${firstResult.tx_index}
                )
          ORDER BY block_height ASC, microblock_sequence ASC, tx_index ASC
          LIMIT ${args.limit}
        `;
        if (prevPageQuery.length > 0) {
          const prevPage = prevPageQuery[prevPageQuery.length - 1];
          prevCursor = encodeTransactionCursor(prevPage);
        }
      }

      return {
        limit: args.limit,
        next_cursor: nextCursor,
        prev_cursor: prevCursor,
        current_cursor: currentCursor,
        total,
        results,
      };
    });
  }

  /**
   * Gets the summaries for all mempool transactions.
   * @param args - The arguments for the query.
   * @returns The summaries for all mempool transactions.
   */
  async getMempoolTransactionSummaries(args: {
    limit: number;
    cursor?: string;
  }): Promise<DbCursorPaginatedResult<DbMempoolTransactionSummary>> {
    return await this.sqlTransaction(async sql => {
      const encodeMempoolTxSummaryCursor = (
        tx: Pick<DbMempoolTransactionSummary, 'receipt_time' | 'tx_id'>
      ) => `${tx.receipt_time}:${tx.tx_id}`;

      let cursorFilter = sql``;
      if (args.cursor) {
        const [receiptTime, txId] = args.cursor.split(':');
        cursorFilter = sql`
          AND (receipt_time, tx_id) <= (${parseInt(receiptTime, 10)}, ${txId})
        `;
      }

      const resultQuery = await sql<(DbMempoolTransactionSummary & { total: number })[]>`
        SELECT
          ${sql(MEMPOOL_TX_SUMMARY_COLUMNS)},
          (SELECT mempool_tx_count FROM chain_tip) AS total
        FROM mempool_txs
        WHERE pruned = false
          ${cursorFilter}
        ORDER BY receipt_time DESC, tx_id DESC
        LIMIT ${args.limit + 1}
      `;

      const hasNextPage = resultQuery.count > args.limit;
      const results = hasNextPage ? resultQuery.slice(0, args.limit) : resultQuery;
      const total = resultQuery.count > 0 ? resultQuery[0].total : 0;
      const firstResult = results[0];
      const extraResult = hasNextPage ? resultQuery[args.limit] : null;

      let prevCursor: string | null = null;
      if (firstResult) {
        const prevPageQuery = await sql<
          Pick<DbMempoolTransactionSummary, 'receipt_time' | 'tx_id'>[]
        >`
          SELECT receipt_time, tx_id
          FROM mempool_txs
          WHERE pruned = false
            AND (receipt_time, tx_id) > (${firstResult.receipt_time}, ${firstResult.tx_id})
          ORDER BY receipt_time ASC, tx_id ASC
          LIMIT ${args.limit}
        `;
        prevCursor =
          prevPageQuery.length > 0
            ? encodeMempoolTxSummaryCursor(prevPageQuery[prevPageQuery.length - 1])
            : null;
      }

      return {
        limit: args.limit,
        offset: 0,
        next_cursor: extraResult ? encodeMempoolTxSummaryCursor(extraResult) : null,
        prev_cursor: prevCursor,
        current_cursor: firstResult ? encodeMempoolTxSummaryCursor(firstResult) : null,
        total,
        results,
      };
    });
  }

  /**
   * Gets the summaries for a block's transactions.
   * @param args - The arguments for the query.
   * @returns The summaries for the block's transactions.
   */
  async getBlockTransactionSummaries(args: {
    block: BlockIdParam;
    limit: number;
    cursor?: TransactionCursor;
  }): Promise<DbCursorPaginatedResult<DbTransactionSummary>> {
    return await this.sqlTransaction(async sql => {
      const blockFilter =
        args.block.type === 'latest'
          ? sql`canonical = TRUE ORDER BY block_height DESC`
          : args.block.type === 'hash'
            ? sql`(
                block_hash = ${normalizeHashString(args.block.hash)}
                OR index_block_hash = ${normalizeHashString(args.block.hash)}
              ) AND canonical = TRUE`
            : args.block.type === 'height'
              ? sql`block_height = ${args.block.height} AND canonical = TRUE`
              : sql`block_time = ${args.block.timestamp} AND canonical = TRUE`;

      // Resolve the target block up-front so a missing block surfaces a distinct error
      // (vs. a valid cursor that simply yields zero rows).
      const blockPtr = await sql<{ index_block_hash: string; tx_count: number }[]>`
        SELECT index_block_hash, tx_count FROM blocks WHERE ${blockFilter} LIMIT 1
      `;
      if (blockPtr.count === 0) {
        throw new InvalidRequestError('Block not found', InvalidRequestErrorType.invalid_param);
      }
      const { index_block_hash, tx_count } = blockPtr[0];

      let cursorFilter = sql``;
      if (args.cursor) {
        const cursor = await resolveTransactionCursor(args.cursor, async cursor => {
          const exactCursorQuery = await sql<{ exists: boolean }[]>`
            SELECT EXISTS (
              SELECT 1
              FROM txs
              WHERE canonical = true
                AND microblock_canonical = true
                AND index_block_hash = ${index_block_hash}
                AND (block_height, microblock_sequence, tx_index)
                    = (${cursor.block_height}, ${cursor.microblock_sequence}, ${cursor.tx_index})
            ) AS exists
          `;
          return exactCursorQuery[0]?.exists ?? false;
        });
        cursorFilter = sql`
          AND (block_height, microblock_sequence, tx_index)
              <= (${cursor.block_height}, ${cursor.microblock_sequence}, ${cursor.tx_index})
        `;
      }

      const resultQuery = await sql<(DbTransactionSummary & { microblock_sequence: number })[]>`
        SELECT ${sql(TX_SUMMARY_COLUMNS)}
        FROM txs
        WHERE canonical = true
          AND microblock_canonical = true
          AND index_block_hash = ${index_block_hash}
          ${cursorFilter}
        ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC
        LIMIT ${args.limit + 1}
      `;

      const hasNextPage = resultQuery.count > args.limit;
      const results = hasNextPage ? resultQuery.slice(0, args.limit) : resultQuery;

      const nextResult = resultQuery[resultQuery.length - 1];
      const nextCursor = hasNextPage && nextResult ? encodeTransactionCursor(nextResult) : null;

      const firstResult = results[0];
      const currentCursor = firstResult ? encodeTransactionCursor(firstResult) : null;

      let prevCursor: string | null = null;
      if (firstResult) {
        const prevPageQuery = await sql<
          { block_height: number; microblock_sequence: number; tx_index: number }[]
        >`
          SELECT block_height, microblock_sequence, tx_index
          FROM txs
          WHERE canonical = true
            AND microblock_canonical = true
            AND index_block_hash = ${index_block_hash}
            AND (block_height, microblock_sequence, tx_index)
                > (
                  ${firstResult.block_height},
                  ${firstResult.microblock_sequence},
                  ${firstResult.tx_index}
                )
          ORDER BY block_height ASC, microblock_sequence ASC, tx_index ASC
          LIMIT ${args.limit}
        `;
        if (prevPageQuery.length > 0) {
          const prevPage = prevPageQuery[prevPageQuery.length - 1];
          prevCursor = encodeTransactionCursor(prevPage);
        }
      }

      return {
        limit: args.limit,
        offset: 0,
        next_cursor: nextCursor,
        prev_cursor: prevCursor,
        current_cursor: currentCursor,
        total: tx_count,
        results,
      };
    });
  }

  /**
   * Gets the transaction by ID. Looks up in the canonical chain first, then the mempool.
   * Heavy columns (post conditions, contract source, decoded clarity inputs, raw result)
   * are only pulled from Postgres when the caller opts in via `include`, so the DB doesn't
   * pay to read/serialize them when the route is going to drop them anyway.
   * @param args - The arguments for the query.
   * @returns The transaction by ID.
   */
  async getTransaction(args: {
    txId: string;
    include?: readonly TransactionIncludeField[];
  }): Promise<DbTransaction | DbMempoolTransaction | null> {
    /**
     * Columns that are expensive for Postgres to read/serialize across the wire — large blobs
     * (contract source code, post conditions) or values that aren't useful without further
     * decoding work on the JS side. Kept out of {@link TX_COLUMNS} / {@link MEMPOOL_TX_COLUMNS}
     * by default and tacked on per-query when the caller opts in via `?include=`.
     *
     * Split per table because `raw_result` only exists on `txs`; opting into `include=result`
     * on a mempool lookup is silently ignored.
     */
    const TX_HEAVY_COLUMNS: Partial<Record<TransactionIncludeField, string>> = {
      post_conditions: 'post_conditions',
      source_code: 'smart_contract_source_code',
      function_args: 'contract_call_function_args',
      result: 'raw_result',
    };
    const MEMPOOL_TX_HEAVY_COLUMNS: Partial<Record<TransactionIncludeField, string>> = {
      post_conditions: 'post_conditions',
      source_code: 'smart_contract_source_code',
      function_args: 'contract_call_function_args',
    };
    /**
     * Appends any heavy columns the caller opted into via `include` to the base column list.
     * Unknown / non-applicable include fields (e.g. `result` against a mempool query) are
     * dropped.
     */
    const withHeavyColumns = (
      base: readonly string[],
      heavy: Partial<Record<TransactionIncludeField, string>>,
      include?: readonly TransactionIncludeField[]
    ): string[] => {
      if (!include?.length) return [...base];
      const extras: string[] = [];
      for (const field of include) {
        const col = heavy[field];
        if (col) extras.push(col);
      }
      return extras.length ? [...base, ...extras] : [...base];
    };

    return await this.sqlTransaction(async sql => {
      const txColumns = withHeavyColumns(TX_COLUMNS, TX_HEAVY_COLUMNS, args.include);
      const result = await sql<DbTransaction[]>`
        SELECT ${sql(txColumns)}
        FROM txs
        WHERE tx_id = ${args.txId} AND canonical = true AND microblock_canonical = true
      `;
      if (result.count > 0) {
        return result[0];
      }
      const mempoolColumns = withHeavyColumns(
        MEMPOOL_TX_COLUMNS,
        MEMPOOL_TX_HEAVY_COLUMNS,
        args.include
      );
      const mempoolResult = await sql<DbMempoolTransaction[]>`
        SELECT ${sql(mempoolColumns)}
        FROM mempool_txs
        WHERE tx_id = ${args.txId} AND pruned = false
      `;
      if (mempoolResult.count > 0) {
        return mempoolResult[0];
      }
      return null;
    });
  }

  async getTransactionEvents(args: {
    txId: string;
    limit: number;
    cursor?: TransactionEventCursor;
  }): Promise<DbCursorPaginatedResult<DbTransactionEvent>> {
    return await this.sqlTransaction(async sql => {
      const limit = args.limit;
      const txCheck = await sql<{ event_count: number }[]>`
        SELECT event_count
        FROM txs
        WHERE tx_id = ${args.txId} AND canonical = true AND microblock_canonical = true
        LIMIT 1
      `;
      if (txCheck.count === 0)
        throw new InvalidRequestError(
          `Transaction not found`,
          InvalidRequestErrorType.invalid_param
        );

      let cursorFilter = sql``;
      if (args.cursor) {
        cursorFilter = sql`AND event_index >= ${parseInt(args.cursor, 10)}`;
      }

      const eventCond = sql`
        canonical = true AND microblock_canonical = true AND tx_id = ${args.txId} ${cursorFilter}
      `;
      const resultQuery = await sql<DbTransactionEvent[]>`
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
        SELECT *
        FROM events
        ORDER BY event_index ASC
        LIMIT ${limit + 1}
      `;
      const hasNextPage = resultQuery.count > limit;
      const results = hasNextPage ? resultQuery.slice(0, limit) : resultQuery;
      const firstResult = results[0];
      const extraResult = hasNextPage ? resultQuery[limit] : null;
      const prevCursor =
        firstResult && firstResult.event_index > 0
          ? Math.max(firstResult.event_index - limit, 0).toString()
          : null;

      return {
        total: txCheck[0].event_count,
        limit,
        offset: 0,
        next_cursor: extraResult ? extraResult.event_index.toString() : null,
        prev_cursor: prevCursor,
        current_cursor: firstResult ? firstResult.event_index.toString() : null,
        results,
      };
    });
  }
}
