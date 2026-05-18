import { BasePgStoreModule } from '@stacks/api-toolkit';
import {
  DbCursorPaginatedResult,
  DbMempoolTransactionSummary,
  DbPrincipalTransactionSummary,
  DbTransactionSummary,
} from './types.js';
import { MEMPOOL_TX_SUMMARY_COLUMNS, TX_SUMMARY_COLUMNS } from './constants.js';
import { prefixedCols } from '../helpers.js';
import { Principal } from '../../api/schemas/v3/entities/common.js';
import { normalizeHashString } from '../../helpers.js';
import { BlockIdParam } from '../../api/routes/v2/schemas.js';

export class PgStoreV3 extends BasePgStoreModule {
  /**
   * Gets the summaries for all transactions.
   * @param args - The arguments for the query.
   * @returns The summaries for all transactions.
   */
  async getTransactionSummaries(args: {
    limit: number;
    cursor?: string;
  }): Promise<DbCursorPaginatedResult<DbTransactionSummary>> {
    return await this.sqlTransaction(async sql => {
      let cursorFilter = sql``;
      if (args.cursor) {
        const parts = args.cursor.split(':');
        const [blockHeightStr, microblockSequenceStr, txIndexStr] = parts;
        const blockHeight = parseInt(blockHeightStr, 10);
        const microblockSequence = parseInt(microblockSequenceStr, 10);
        const txIndex = parseInt(txIndexStr, 10);
        cursorFilter = sql`
          AND (block_height, microblock_sequence, tx_index)
              <= (${blockHeight}, ${microblockSequence}, ${txIndex})
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
      const nextCursor =
        hasNextPage && nextResult
          ? `${nextResult.block_height}:${nextResult.microblock_sequence}:${nextResult.tx_index}`
          : null;

      const firstResult = results[0];
      const currentCursor = firstResult
        ? `${firstResult.block_height}:${firstResult.microblock_sequence}:${firstResult.tx_index}`
        : null;

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
          OFFSET ${args.limit - 1}
          LIMIT 1
        `;
        if (prevPageQuery.length > 0) {
          const prevPage = prevPageQuery[0];
          prevCursor = `${prevPage.block_height}:${prevPage.microblock_sequence}:${prevPage.tx_index}`;
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
    cursor?: string;
  }): Promise<DbCursorPaginatedResult<DbPrincipalTransactionSummary>> {
    return await this.sqlTransaction(async sql => {
      let cursorFilter = sql``;
      if (args.cursor) {
        const parts = args.cursor.split(':');
        const [blockHeightStr, microblockSequenceStr, txIndexStr] = parts;
        const blockHeight = parseInt(blockHeightStr, 10);
        const microblockSequence = parseInt(microblockSequenceStr, 10);
        const txIndex = parseInt(txIndexStr, 10);
        cursorFilter = sql`
          AND (block_height, microblock_sequence, tx_index)
              <= (${blockHeight}, ${microblockSequence}, ${txIndex})
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
      const nextCursor =
        hasNextPage && nextResult
          ? `${nextResult.block_height}:${nextResult.microblock_sequence}:${nextResult.tx_index}`
          : null;

      const firstResult = results[0];
      const currentCursor = firstResult
        ? `${firstResult.block_height}:${firstResult.microblock_sequence}:${firstResult.tx_index}`
        : null;

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
          OFFSET ${args.limit - 1}
          LIMIT 1
        `;
        if (prevPageQuery.length > 0) {
          const prevPage = prevPageQuery[0];
          prevCursor = `${prevPage.block_height}:${prevPage.microblock_sequence}:${prevPage.tx_index}`;
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
          OFFSET ${args.limit - 1}
          LIMIT 1
        `;
        prevCursor =
          prevPageQuery.length > 0 ? encodeMempoolTxSummaryCursor(prevPageQuery[0]) : null;
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
    cursor?: string;
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

      let cursorFilter = sql``;
      if (args.cursor) {
        const parts = args.cursor.split(':');
        const [blockHeightStr, microblockSequenceStr, txIndexStr] = parts;
        const blockHeight = parseInt(blockHeightStr, 10);
        const microblockSequence = parseInt(microblockSequenceStr, 10);
        const txIndex = parseInt(txIndexStr, 10);
        cursorFilter = sql`
          AND (block_height, microblock_sequence, tx_index)
              <= (${blockHeight}, ${microblockSequence}, ${txIndex})
        `;
      }

      const resultQuery = await sql<
        (DbTransactionSummary & { microblock_sequence: number; total: number })[]
      >`
        WITH block_ptr AS (
          SELECT index_block_hash FROM blocks WHERE ${blockFilter} LIMIT 1
        ),
        tx_count AS (
          SELECT tx_count AS total
          FROM blocks
          WHERE index_block_hash = (SELECT index_block_hash FROM block_ptr)
        )
        SELECT ${sql(TX_SUMMARY_COLUMNS)}, (SELECT total FROM tx_count)::int AS total
        FROM txs
        WHERE canonical = true
          AND microblock_canonical = true
          AND index_block_hash = (SELECT index_block_hash FROM block_ptr)
          ${cursorFilter}
        ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC
        LIMIT ${args.limit + 1}
      `;

      const hasNextPage = resultQuery.count > args.limit;
      const results = hasNextPage ? resultQuery.slice(0, args.limit) : resultQuery;
      const total = resultQuery.count > 0 ? resultQuery[0].total : 0;

      const nextResult = resultQuery[resultQuery.length - 1];
      const nextCursor =
        hasNextPage && nextResult
          ? `${nextResult.block_height}:${nextResult.microblock_sequence}:${nextResult.tx_index}`
          : null;

      const firstResult = results[0];
      const currentCursor = firstResult
        ? `${firstResult.block_height}:${firstResult.microblock_sequence}:${firstResult.tx_index}`
        : null;

      let prevCursor: string | null = null;
      if (firstResult) {
        const prevPageQuery = await sql<
          { block_height: number; microblock_sequence: number; tx_index: number }[]
        >`
          SELECT block_height, microblock_sequence, tx_index
          FROM txs
          WHERE canonical = true
            AND microblock_canonical = true
            AND index_block_hash = ${firstResult.index_block_hash}
            AND (block_height, microblock_sequence, tx_index)
                > (
                  ${firstResult.block_height},
                  ${firstResult.microblock_sequence},
                  ${firstResult.tx_index}
                )
          ORDER BY block_height ASC, microblock_sequence ASC, tx_index ASC
          OFFSET ${args.limit - 1}
          LIMIT 1
        `;
        if (prevPageQuery.length > 0) {
          const prevPage = prevPageQuery[0];
          prevCursor = `${prevPage.block_height}:${prevPage.microblock_sequence}:${prevPage.tx_index}`;
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
}
