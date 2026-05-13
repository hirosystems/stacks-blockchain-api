import { BasePgStoreModule } from '@stacks/api-toolkit';
import {
  DbCursorPaginatedResult,
  DbPrincipalTransactionBalanceChange,
  DbPrincipalTransactionSummary,
} from './types.js';
import { PRINCIPAL_TRANSACTION_BALANCE_CHANGE_COLUMNS, TX_SUMMARY_COLUMNS } from './constants.js';
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
          AND (p.block_height, p.microblock_sequence, p.tx_index)
              <= (${blockHeight}, ${microblockSequence}, ${txIndex})
        `;
      }
      const resultQuery = await sql<
        (DbPrincipalTransactionSummary & { microblock_sequence: number; total: number })[]
      >`
        SELECT
          ${sql(prefixedCols(TX_SUMMARY_COLUMNS, 't'))},
          t.microblock_sequence,
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
        FROM principal_txs AS p
        INNER JOIN txs AS t USING (tx_id, index_block_hash, microblock_hash)
        WHERE p.canonical = true
          AND p.microblock_canonical = true
          AND p.principal = ${args.principal}
          ${cursorFilter}
        ORDER BY p.block_height DESC, p.microblock_sequence DESC, p.tx_index DESC
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
   * Gets the balance changes for a principal's transaction.
   * @param args - The arguments for the query.
   * @returns The balance changes for the principal's transaction.
   */
  async getPrincipalTransactionBalanceChanges(args: {
    principal: string;
    tx_id: string;
    limit: number;
    cursor?: string;
  }): Promise<DbCursorPaginatedResult<DbPrincipalTransactionBalanceChange>> {
    return await this.sqlTransaction(async sql => {
      // Cursor format: `${asset_type}:${asset_identifier}`. We split on the *first* colon
      // only because FT/NFT asset identifiers contain `::` internally (e.g.
      // `SP000…contract-name::asset-name`); a naive split would over-split. The cursor is
      // inclusive and points at the first row of the current page, matching the convention
      // used by `getPrincipalTransactionSummaryList`.
      let cursorFilter = sql``;
      if (args.cursor) {
        const colonIdx = args.cursor.indexOf(':');
        if (colonIdx > 0) {
          const cursorAssetType = parseInt(args.cursor.substring(0, colonIdx), 10);
          const cursorAssetIdentifier = args.cursor.substring(colonIdx + 1);
          cursorFilter = sql`
            AND (asset_type, asset_identifier)
                >= (${cursorAssetType}, ${cursorAssetIdentifier})
          `;
        }
      }

      const resultQuery = await sql<(DbPrincipalTransactionBalanceChange & { total: number })[]>`
        WITH total AS (
          SELECT balance_change_count
          FROM principal_txs
          WHERE principal = ${args.principal}
            AND tx_id = ${args.tx_id}
            AND canonical = true
            AND microblock_canonical = true
        )
        SELECT ${sql(PRINCIPAL_TRANSACTION_BALANCE_CHANGE_COLUMNS)},
          (received - sent) AS net,
          (SELECT balance_change_count FROM total) AS total
        FROM principal_tx_balance_changes
        WHERE principal = ${args.principal}
          AND tx_id = ${args.tx_id}
          AND canonical = true
          AND microblock_canonical = true
          ${cursorFilter}
        ORDER BY asset_type ASC, asset_identifier ASC
        LIMIT ${args.limit + 1}
      `;

      const hasNextPage = resultQuery.count > args.limit;
      const results = hasNextPage ? resultQuery.slice(0, args.limit) : resultQuery;
      const total = resultQuery.count > 0 ? resultQuery[0].total : 0;

      const peekResult = resultQuery[resultQuery.length - 1];
      const nextCursor =
        hasNextPage && peekResult
          ? `${peekResult.asset_type}:${peekResult.asset_identifier}`
          : null;

      const firstResult = results[0];
      const currentCursor = firstResult
        ? `${firstResult.asset_type}:${firstResult.asset_identifier}`
        : null;

      let prevCursor: string | null = null;
      if (firstResult) {
        const prevPageQuery = await sql<{ asset_type: number; asset_identifier: string }[]>`
          SELECT asset_type, asset_identifier
          FROM principal_tx_balance_changes
          WHERE principal = ${args.principal}
            AND tx_id = ${args.tx_id}
            AND canonical = true
            AND microblock_canonical = true
            AND (asset_type, asset_identifier)
                < (${firstResult.asset_type}, ${firstResult.asset_identifier})
          ORDER BY asset_type DESC, asset_identifier DESC
          OFFSET ${args.limit - 1}
          LIMIT 1
        `;
        if (prevPageQuery.length > 0) {
          const prevPage = prevPageQuery[0];
          prevCursor = `${prevPage.asset_type}:${prevPage.asset_identifier}`;
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
   * Gets the balance changes for a principal across a batch of transactions, paginated as a
   * single flat array ordered by chain position DESC (newest tx first) then by asset
   * (STX, FT, NFT) ASC within each tx.
   * @param args - The arguments for the query.
   * @returns The paginated balance changes for the principal across the given tx ids.
   */
  async getPrincipalBalanceChanges(args: {
    principal: string;
    tx_ids: string[];
    limit: number;
    cursor?: string;
  }): Promise<DbCursorPaginatedResult<DbPrincipalTransactionBalanceChange>> {
    return await this.sqlTransaction(async sql => {
      // Cursor format: `${block_height}:${microblock_sequence}:${tx_index}:${asset_type}:${asset_identifier}`.
      // We walk the first 4 colons manually and treat everything after as the asset_identifier,
      // because FT/NFT asset_identifier values contain `::` internally — a naive `split(':')`
      // would over-split. The cursor is inclusive and points at the first row of the current
      // page.
      //
      // The page direction is mixed: DESC by chain position, ASC by asset within a tx. SQL row
      // comparison can only express one direction at a time, so the "row >= cursor in page
      // order" predicate is expressed as a two-branch OR.
      let cursorFilter = sql``;
      if (args.cursor) {
        const parts: string[] = [];
        let idx = 0;
        let valid = true;
        for (let i = 0; i < 4; i++) {
          const next = args.cursor.indexOf(':', idx);
          if (next === -1) {
            valid = false;
            break;
          }
          parts.push(args.cursor.substring(idx, next));
          idx = next + 1;
        }
        if (valid) {
          parts.push(args.cursor.substring(idx));
          const blockHeight = parseInt(parts[0], 10);
          const microblockSequence = parseInt(parts[1], 10);
          const txIndex = parseInt(parts[2], 10);
          const cursorAssetType = parseInt(parts[3], 10);
          const cursorAssetIdentifier = parts[4];
          cursorFilter = sql`
            AND (
              (block_height, microblock_sequence, tx_index)
                < (${blockHeight}, ${microblockSequence}, ${txIndex})
              OR (
                (block_height, microblock_sequence, tx_index)
                  = (${blockHeight}, ${microblockSequence}, ${txIndex})
                AND (asset_type, asset_identifier)
                  >= (${cursorAssetType}, ${cursorAssetIdentifier})
              )
            )
          `;
        }
      }

      const resultQuery = await sql<(DbPrincipalTransactionBalanceChange & { total: number })[]>`
        WITH total AS (
          SELECT COALESCE(SUM(balance_change_count)::int, 0) AS count
          FROM principal_txs
          WHERE principal = ${args.principal}
            AND tx_id IN ${sql(args.tx_ids)}
            AND canonical = true
            AND microblock_canonical = true
        )
        SELECT ${sql(PRINCIPAL_TRANSACTION_BALANCE_CHANGE_COLUMNS)},
          (received - sent) AS net,
          (SELECT count FROM total) AS total
        FROM principal_tx_balance_changes
        WHERE principal = ${args.principal}
          AND tx_id IN ${sql(args.tx_ids)}
          AND canonical = true
          AND microblock_canonical = true
          ${cursorFilter}
        ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC,
          asset_type ASC, asset_identifier ASC
        LIMIT ${args.limit + 1}
      `;

      const hasNextPage = resultQuery.count > args.limit;
      const results = hasNextPage ? resultQuery.slice(0, args.limit) : resultQuery;
      const total = resultQuery.count > 0 ? resultQuery[0].total : 0;

      const buildCursor = (row: DbPrincipalTransactionBalanceChange) =>
        `${row.block_height}:${row.microblock_sequence}:${row.tx_index}:${row.asset_type}:${row.asset_identifier}`;

      const peekResult = resultQuery[resultQuery.length - 1];
      const nextCursor = hasNextPage && peekResult ? buildCursor(peekResult) : null;

      const firstResult = results[0];
      const currentCursor = firstResult ? buildCursor(firstResult) : null;

      // Previous page: rows that come BEFORE firstResult in the forward direction. In our
      // mixed DESC/ASC order that means a chain position later than firstResult, or the
      // same tx with an earlier asset. Ordered in reverse direction (ASC chain + DESC
      // asset) and offset by `limit - 1` so the returned row is the first row of the
      // previous page.
      let prevCursor: string | null = null;
      if (firstResult) {
        const prevPageQuery = await sql<
          {
            block_height: number;
            microblock_sequence: number;
            tx_index: number;
            asset_type: number;
            asset_identifier: string;
          }[]
        >`
          SELECT block_height, microblock_sequence, tx_index, asset_type, asset_identifier
          FROM principal_tx_balance_changes
          WHERE principal = ${args.principal}
            AND tx_id IN ${sql(args.tx_ids)}
            AND canonical = true
            AND microblock_canonical = true
            AND (
              (block_height, microblock_sequence, tx_index)
                > (${firstResult.block_height}, ${firstResult.microblock_sequence}, ${firstResult.tx_index})
              OR (
                (block_height, microblock_sequence, tx_index)
                  = (${firstResult.block_height}, ${firstResult.microblock_sequence}, ${firstResult.tx_index})
                AND (asset_type, asset_identifier)
                  < (${firstResult.asset_type}, ${firstResult.asset_identifier})
              )
            )
          ORDER BY block_height ASC, microblock_sequence ASC, tx_index ASC,
            asset_type DESC, asset_identifier DESC
          OFFSET ${args.limit - 1}
          LIMIT 1
        `;
        if (prevPageQuery.length > 0) {
          const prevPage = prevPageQuery[0];
          prevCursor = `${prevPage.block_height}:${prevPage.microblock_sequence}:${prevPage.tx_index}:${prevPage.asset_type}:${prevPage.asset_identifier}`;
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
