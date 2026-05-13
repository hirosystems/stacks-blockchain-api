import { BasePgStoreModule } from '@stacks/api-toolkit';
import { DbCursorPaginatedResult, DbPrincipalTransactionSummary } from './types.js';
import { TX_SUMMARY_COLUMNS } from './constants.js';
import { prefixedCols } from '../helpers.js';

export class PgStoreV3 extends BasePgStoreModule {
  /**
   * Gets the summaries for a principal's transactions.
   * @param args - The arguments for the query.
   * @returns The summaries for the principal's transactions.
   */
  async getPrincipalTransactionSummaries(args: {
    principal: string;
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
}
