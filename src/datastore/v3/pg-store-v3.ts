import { BasePgStoreModule, has0xPrefix } from '@stacks/api-toolkit';
import {
  DbBond,
  DbBondAllowlistEntry,
  DbBondRegistration,
  DbBondRegistrationSummary,
  DbBondSummary,
  DbCursorPaginatedResult,
  DbCycleSigner,
  DbMempoolTransaction,
  DbMempoolTransactionSummary,
  DbPrincipalBondPosition,
  DbPrincipalFtBalance,
  DbPrincipalNftBalance,
  DbPrincipalStakingSummary,
  DbPrincipalTransactionBalanceChange,
  DbPrincipalTransactionSummary,
  DbSignerStaker,
  DbStakingSigner,
  DbStakingSignerDetail,
  DbTransaction,
  DbTransactionCursor,
  DbTransactionEvent,
  DbTransactionSummary,
} from './types.js';
import {
  BOND_ALLOWLIST_ENTRY_COLUMNS,
  BOND_COLUMNS,
  BOND_REGISTRATION_COLUMNS,
  BOND_REGISTRATION_SUMMARY_COLUMNS,
  BOND_SUMMARY_COLUMNS,
  PRINCIPAL_TRANSACTION_BALANCE_CHANGE_COLUMNS,
  MEMPOOL_TX_COLUMNS,
  MEMPOOL_TX_SUMMARY_COLUMNS,
  PRINCIPAL_BOND_POSITION_COLUMNS,
  STAKING_SIGNER_COLUMNS,
  TX_COLUMNS,
  TX_SUMMARY_COLUMNS,
} from './constants.js';
import { MaterializedStxLockRow, prefixedCols, resolveMaterializedStxLock } from '../helpers.js';
import { Principal } from '../../api/schemas/v3/entities/common.js';
import { normalizeHashString } from '../../helpers.js';
import { BlockIdParam } from '../../api/routes/v2/schemas.js';
import { InvalidRequestError, InvalidRequestErrorType } from '../../errors.js';
import { TransactionIncludeField } from '../../api/schemas/v3/entities/transactions.js';
import type {
  BondCursor,
  FtBalanceCursor,
  NftBalanceCursor,
  SignerCursor,
  TransactionCursor,
  TransactionEventCursor,
} from '../../api/schemas/v3/cursors.js';
import {
  encodeFtBalanceCursor,
  encodeNftBalanceCursor,
  encodeTransactionCursor,
  parseBondLockupTxs,
  parseFtBalanceCursor,
  parseNftBalanceCursor,
  resolveTransactionCursor,
} from './helpers.js';
import { DbEventTypeId, DbSignerKeyGrantKind } from '../common.js';

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
   * Gets a principal's fungible-token balances, sorted by balance descending,
   * keyset-paginated by `(balance, asset_identifier)`.
   * @param args - The arguments for the query.
   * @returns The principal's FT positions.
   */
  async getPrincipalFtBalances(args: {
    principal: Principal;
    limit: number;
    cursor?: FtBalanceCursor;
  }): Promise<DbCursorPaginatedResult<DbPrincipalFtBalance>> {
    return await this.sqlTransaction(async sql => {
      // Position the page at or after the cursor in `(balance DESC, token ASC)`
      // order: a smaller balance comes later, or the same balance with a token
      // at-or-after the cursor's token.
      let cursorFilter = sql``;
      if (args.cursor) {
        const cursor = parseFtBalanceCursor(args.cursor);
        cursorFilter = sql`
          AND (
            balance < ${cursor.balance}::numeric
            OR (balance = ${cursor.balance}::numeric AND token >= ${cursor.token})
          )
        `;
      }
      const baseFilter = sql`
        address = ${args.principal} AND token != 'stx' AND balance > 0
      `;
      const resultQuery = await sql<(DbPrincipalFtBalance & { total: number })[]>`
        SELECT
          token,
          balance::text AS balance,
          (SELECT COUNT(*)::int FROM ft_balances WHERE ${baseFilter}) AS total
        FROM ft_balances
        WHERE ${baseFilter} ${cursorFilter}
        ORDER BY balance DESC, token ASC
        LIMIT ${args.limit + 1}
      `;

      const hasNextPage = resultQuery.count > args.limit;
      const results = hasNextPage ? resultQuery.slice(0, args.limit) : resultQuery;
      const total = resultQuery.count > 0 ? resultQuery[0].total : 0;

      const nextResult = resultQuery[resultQuery.length - 1];
      const nextCursor = hasNextPage && nextResult ? encodeFtBalanceCursor(nextResult) : null;

      const firstResult = results[0];
      const currentCursor = firstResult ? encodeFtBalanceCursor(firstResult) : null;

      // The previous page is the rows strictly before the first result in sort
      // order: a larger balance, or the same balance with an earlier token.
      let prevCursor: string | null = null;
      if (firstResult) {
        const prevPageQuery = await sql<{ balance: string; token: string }[]>`
          SELECT token, balance::text AS balance
          FROM ft_balances
          WHERE ${baseFilter}
            AND (
              balance > ${firstResult.balance}::numeric
              OR (balance = ${firstResult.balance}::numeric AND token < ${firstResult.token})
            )
          ORDER BY balance ASC, token DESC
          LIMIT ${args.limit}
        `;
        if (prevPageQuery.length > 0) {
          prevCursor = encodeFtBalanceCursor(prevPageQuery[prevPageQuery.length - 1]);
        }
      }

      return {
        limit: args.limit,
        next_cursor: nextCursor,
        prev_cursor: prevCursor,
        current_cursor: currentCursor,
        total,
        results: results.map(r => ({ token: r.token, balance: r.balance })),
      };
    });
  }

  /**
   * Gets a principal's balance of a single fungible token via a point lookup on
   * the `ft_balances (address, token)` primary key. Returns a `"0"` balance when
   * the principal does not hold the token.
   * @param args - The arguments for the query.
   * @returns The principal's balance of the given token.
   */
  async getPrincipalFtBalance(args: {
    principal: Principal;
    token: string;
  }): Promise<DbPrincipalFtBalance> {
    return await this.sqlTransaction(async sql => {
      const result = await sql<{ balance: string }[]>`
        SELECT balance::text AS balance
        FROM ft_balances
        WHERE address = ${args.principal} AND token = ${args.token}
        LIMIT 1
      `;
      return {
        token: args.token,
        balance: result.count > 0 ? result[0].balance : '0',
      };
    });
  }

  /**
   * Gets a principal's individually-owned NFT instances, keyset-paginated by
   * `(asset_identifier, value)` (the unique key for an NFT instance), sorted
   * ascending. Backed by the `nft_custody` index on
   * `(recipient, asset_identifier, value)`.
   * @param args - The arguments for the query.
   * @returns The principal's NFT positions.
   */
  async getPrincipalNftBalances(args: {
    principal: Principal;
    limit: number;
    cursor?: NftBalanceCursor;
  }): Promise<DbCursorPaginatedResult<DbPrincipalNftBalance>> {
    return await this.sqlTransaction(async sql => {
      // Position the page strictly after the cursor in `(asset_identifier, value)`
      // ascending order.
      let cursorFilter = sql``;
      if (args.cursor) {
        const cursor = parseNftBalanceCursor(args.cursor);
        // Inclusive on the cursor row: `next_cursor` points at the first row of
        // the next page, which is re-included here as that page's first result.
        cursorFilter = sql`
          AND (
            asset_identifier > ${cursor.asset_identifier}
            OR (asset_identifier = ${cursor.asset_identifier} AND value >= ${cursor.value})
          )
        `;
      }
      const resultQuery = await sql<(DbPrincipalNftBalance & { total: number })[]>`
        SELECT
          asset_identifier,
          value,
          (SELECT COUNT(*)::int FROM nft_custody WHERE recipient = ${args.principal}) AS total
        FROM nft_custody
        WHERE recipient = ${args.principal} ${cursorFilter}
        ORDER BY asset_identifier ASC, value ASC
        LIMIT ${args.limit + 1}
      `;

      const hasNextPage = resultQuery.count > args.limit;
      const results = hasNextPage ? resultQuery.slice(0, args.limit) : resultQuery;
      const total = resultQuery.count > 0 ? resultQuery[0].total : 0;

      const nextResult = resultQuery[resultQuery.length - 1];
      const nextCursor = hasNextPage && nextResult ? encodeNftBalanceCursor(nextResult) : null;

      const firstResult = results[0];
      const currentCursor = firstResult ? encodeNftBalanceCursor(firstResult) : null;

      // The previous page is the rows strictly before the first result in sort order.
      let prevCursor: string | null = null;
      if (firstResult) {
        const prevPageQuery = await sql<{ asset_identifier: string; value: string }[]>`
          SELECT asset_identifier, value
          FROM nft_custody
          WHERE recipient = ${args.principal}
            AND (
              asset_identifier < ${firstResult.asset_identifier}
              OR (asset_identifier = ${firstResult.asset_identifier} AND value < ${firstResult.value})
            )
          ORDER BY asset_identifier DESC, value DESC
          LIMIT ${args.limit}
        `;
        if (prevPageQuery.length > 0) {
          prevCursor = encodeNftBalanceCursor(prevPageQuery[prevPageQuery.length - 1]);
        }
      }

      return {
        limit: args.limit,
        next_cursor: nextCursor,
        prev_cursor: prevCursor,
        current_cursor: currentCursor,
        total,
        results: results.map(r => ({ asset_identifier: r.asset_identifier, value: r.value })),
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
   * Gets the mempool transaction summaries for pending transactions that involve
   * a principal — as the sender, a token-transfer recipient, the deployed
   * contract, or the called contract — keyset-paginated by `(receipt_time, tx_id)`
   * descending. Mirrors {@link getMempoolTransactionSummaries} but scoped to a
   * single principal.
   * @param args - The arguments for the query.
   * @returns The principal's pending mempool transaction summaries.
   */
  async getPrincipalMempoolTransactionSummaries(args: {
    principal: Principal;
    limit: number;
    cursor?: string;
  }): Promise<DbCursorPaginatedResult<DbMempoolTransactionSummary>> {
    return await this.sqlTransaction(async sql => {
      const encodeMempoolTxSummaryCursor = (
        tx: Pick<DbMempoolTransactionSummary, 'receipt_time' | 'tx_id'>
      ) => `${tx.receipt_time}:${tx.tx_id}`;

      // Pending txs that involve the principal in any role.
      const principalFilter = sql`
        AND (
          sender_address = ${args.principal}
          OR token_transfer_recipient_address = ${args.principal}
          OR smart_contract_contract_id = ${args.principal}
          OR contract_call_contract_id = ${args.principal}
        )
      `;

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
          (
            SELECT COUNT(*)::int FROM mempool_txs
            WHERE pruned = false ${principalFilter}
          ) AS total
        FROM mempool_txs
        WHERE pruned = false ${principalFilter} ${cursorFilter}
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
          WHERE pruned = false ${principalFilter}
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
              sender,
              recipient,
              event_index,
              amount,
              NULL as asset_identifier,
              NULL as contract_identifier,
              NULL as topic,
              NULL::bytea as value,
              ${DbEventTypeId.StxAsset}::int as event_type_id,
              asset_event_type_id,
              memo,
              NULL::int as unlock_height
            FROM stx_events
            WHERE ${eventCond}
          )
          UNION ALL
          (
            SELECT
              sender,
              recipient,
              event_index,
              amount,
              asset_identifier,
              NULL as contract_identifier,
              NULL as topic,
              NULL::bytea as value,
              ${DbEventTypeId.FungibleTokenAsset}::int as event_type_id,
              asset_event_type_id,
              NULL::bytea as memo,
              NULL::int as unlock_height
            FROM ft_events
            WHERE ${eventCond}
          )
          UNION ALL
          (
            SELECT
              sender,
              recipient,
              event_index,
              0 as amount,
              asset_identifier,
              NULL as contract_identifier,
              NULL as topic,
              value,
              ${DbEventTypeId.NonFungibleTokenAsset}::int as event_type_id,
              asset_event_type_id,
              NULL::bytea as memo,
              NULL::int as unlock_height
            FROM nft_events
            WHERE ${eventCond}
          )
          UNION ALL
          (
            SELECT
              locked_address as sender,
              NULL as recipient,
              event_index,
              locked_amount as amount,
              NULL as asset_identifier,
              NULL as contract_identifier,
              NULL as topic,
              NULL::bytea as value,
              ${DbEventTypeId.StxLock}::int as event_type_id,
              0 as asset_event_type_id,
              NULL::bytea as memo,
              unlock_height
            FROM stx_lock_events
            WHERE ${eventCond}
          )
          UNION ALL
          (
            SELECT
              NULL as sender,
              NULL as recipient,
              event_index,
              0 as amount,
              NULL as asset_identifier,
              contract_identifier,
              topic,
              value,
              ${DbEventTypeId.SmartContractLog}::int as event_type_id,
              0 as asset_event_type_id,
              NULL::bytea as memo,
              NULL::int as unlock_height
            FROM contract_logs
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

  /**
   * Gets the summaries for all bonds.
   * @param args - The arguments for the query.
   * @returns The summaries for all bonds.
   */
  async getBondSummaries(args: {
    limit: number;
    cursor?: BondCursor;
  }): Promise<DbCursorPaginatedResult<DbBondSummary> & { burn_block_height: number }> {
    return await this.sqlTransaction(async sql => {
      const limit = args.limit;
      const cursorFilter = args.cursor
        ? sql`AND bond_index <= ${parseInt(args.cursor, 10)}`
        : sql``;

      const totalQuery = await sql<{ total: number }[]>`
        SELECT bond_count AS total
        FROM chain_tip
      `;

      const resultQuery = await sql<DbBondSummary[]>`
        SELECT ${sql(BOND_SUMMARY_COLUMNS)}
        FROM bonds
        WHERE canonical = true
          AND microblock_canonical = true
          ${cursorFilter}
        ORDER BY bond_index DESC
        LIMIT ${limit + 1}
      `;

      const hasNextPage = resultQuery.count > limit;
      const results = hasNextPage ? resultQuery.slice(0, limit) : resultQuery;
      const firstResult = results[0];
      const extraResult = hasNextPage ? resultQuery[limit] : null;

      let prevCursor: string | null = null;
      if (firstResult) {
        const prevPageQuery = await sql<Pick<DbBondSummary, 'bond_index'>[]>`
          SELECT bond_index
          FROM bonds
          WHERE canonical = true
            AND microblock_canonical = true
            AND bond_index > ${firstResult.bond_index}
          ORDER BY bond_index ASC
          LIMIT ${limit}
        `;
        prevCursor =
          prevPageQuery.length > 0
            ? prevPageQuery[prevPageQuery.length - 1].bond_index.toString()
            : null;
      }

      const chainTip = await sql<{ burn_block_height: number }[]>`
        SELECT burn_block_height FROM chain_tip LIMIT 1
      `;
      return {
        limit,
        next_cursor: extraResult ? extraResult.bond_index.toString() : null,
        prev_cursor: prevCursor,
        current_cursor: firstResult ? firstResult.bond_index.toString() : null,
        total: totalQuery[0]?.total ?? 0,
        results,
        burn_block_height: chainTip[0]?.burn_block_height ?? 0,
      };
    });
  }

  /**
   * Gets a bond by index.
   * @param args - The arguments for the query.
   * @returns The bond by index.
   */
  async getBond(args: {
    bondIndex: number;
  }): Promise<(DbBond & { burn_block_height: number }) | null> {
    return await this.sqlTransaction(async sql => {
      const chainTip = await sql<{ burn_block_height: number }[]>`
        SELECT burn_block_height FROM chain_tip LIMIT 1
      `;
      const result = await sql<DbBond[]>`
        SELECT ${sql(BOND_COLUMNS)}
        FROM bonds
        WHERE canonical = true
          AND microblock_canonical = true
          AND bond_index = ${args.bondIndex}
        LIMIT 1
      `;
      return result[0]
        ? { ...result[0], burn_block_height: chainTip[0]?.burn_block_height ?? 0 }
        : null;
    });
  }

  /**
   * Gets the allowlist entries for a bond.
   * @param args - The arguments for the query.
   * @returns The allowlist entries for a bond.
   */
  async getBondAllowlistEntries(args: {
    bondIndex: number;
    limit: number;
    cursor?: TransactionCursor;
  }): Promise<DbCursorPaginatedResult<DbBondAllowlistEntry>> {
    return await this.sqlTransaction(async sql => {
      const limit = args.limit;
      let cursorFilter = sql``;
      if (args.cursor) {
        const cursor = await resolveTransactionCursor(args.cursor, async cursor => {
          const exactCursorQuery = await sql<{ exists: boolean }[]>`
            SELECT EXISTS (
              SELECT 1
              FROM bond_allowlist_entries
              WHERE canonical = true
                AND microblock_canonical = true
                AND bond_index = ${args.bondIndex}
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

      const totalQuery = await sql<{ total: number }[]>`
        SELECT allowed_count AS total
        FROM bonds
        WHERE canonical = true
          AND microblock_canonical = true
          AND bond_index = ${args.bondIndex}
        LIMIT 1
      `;

      const resultQuery = await sql<(DbBondAllowlistEntry & DbTransactionCursor)[]>`
        SELECT ${sql(BOND_ALLOWLIST_ENTRY_COLUMNS)}
        FROM bond_allowlist_entries
        WHERE canonical = true
          AND microblock_canonical = true
          AND bond_index = ${args.bondIndex}
          ${cursorFilter}
        ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC
        LIMIT ${limit + 1}
      `;

      const hasNextPage = resultQuery.count > limit;
      const results = hasNextPage ? resultQuery.slice(0, limit) : resultQuery;
      const firstResult = results[0];
      const extraResult = hasNextPage ? resultQuery[limit] : null;

      let prevCursor: string | null = null;
      if (firstResult) {
        const prevPageQuery = await sql<DbTransactionCursor[]>`
          SELECT block_height, microblock_sequence, tx_index
          FROM bond_allowlist_entries
          WHERE canonical = true
            AND microblock_canonical = true
            AND bond_index = ${args.bondIndex}
            AND (block_height, microblock_sequence, tx_index)
                > (
                  ${firstResult.block_height},
                  ${firstResult.microblock_sequence},
                  ${firstResult.tx_index}
                )
          ORDER BY block_height ASC, microblock_sequence ASC, tx_index ASC
          LIMIT ${limit}
        `;
        prevCursor =
          prevPageQuery.length > 0
            ? encodeTransactionCursor(prevPageQuery[prevPageQuery.length - 1])
            : null;
      }

      return {
        limit,
        next_cursor: extraResult ? encodeTransactionCursor(extraResult) : null,
        prev_cursor: prevCursor,
        current_cursor: firstResult ? encodeTransactionCursor(firstResult) : null,
        total: totalQuery[0]?.total ?? 0,
        results,
      };
    });
  }

  /**
   * Gets an allowlist entry for a bond and principal.
   * @param args - The arguments for the query.
   * @returns The allowlist entry for a bond and principal.
   */
  async getBondAllowlistEntry(args: {
    bondIndex: number;
    principal: Principal;
  }): Promise<DbBondAllowlistEntry | null> {
    return await this.sqlTransaction(async sql => {
      const result = await sql<DbBondAllowlistEntry[]>`
        SELECT staker, max_sats
        FROM bond_allowlist_entries
        WHERE canonical = true
          AND microblock_canonical = true
          AND bond_index = ${args.bondIndex}
          AND staker = ${args.principal}
        LIMIT 1
      `;
      return result[0] ?? null;
    });
  }

  /**
   * Gets the registrations for a bond.
   * @param args - The arguments for the query.
   * @returns The registrations for a bond.
   */
  async getBondRegistrationSummaries(args: {
    bondIndex: number;
    limit: number;
    cursor?: TransactionCursor;
  }): Promise<DbCursorPaginatedResult<DbBondRegistrationSummary>> {
    return await this.sqlTransaction(async sql => {
      const limit = args.limit;
      let cursorFilter = sql``;
      if (args.cursor) {
        const cursor = await resolveTransactionCursor(args.cursor, async cursor => {
          const exactCursorQuery = await sql<{ exists: boolean }[]>`
            SELECT EXISTS (
              SELECT 1
              FROM bond_registrations
              WHERE canonical = true
                AND microblock_canonical = true
                AND bond_index = ${args.bondIndex}
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

      const totalQuery = await sql<{ total: number }[]>`
        SELECT registered_count AS total
        FROM bonds
        WHERE canonical = true
          AND microblock_canonical = true
          AND bond_index = ${args.bondIndex}
        LIMIT 1
      `;

      const resultQuery = await sql<(DbBondRegistrationSummary & DbTransactionCursor)[]>`
        SELECT ${sql(BOND_REGISTRATION_SUMMARY_COLUMNS)}, block_height, microblock_sequence, tx_index
        FROM bond_registrations
        WHERE canonical = true
          AND microblock_canonical = true
          AND bond_index = ${args.bondIndex}
          ${cursorFilter}
        ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC
        LIMIT ${limit + 1}
      `;

      const hasNextPage = resultQuery.count > limit;
      const results = hasNextPage ? resultQuery.slice(0, limit) : resultQuery;
      const firstResult = results[0];
      const extraResult = hasNextPage ? resultQuery[limit] : null;

      let prevCursor: string | null = null;
      if (firstResult) {
        const prevPageQuery = await sql<DbTransactionCursor[]>`
          SELECT block_height, microblock_sequence, tx_index
          FROM bond_registrations
          WHERE canonical = true
            AND microblock_canonical = true
            AND bond_index = ${args.bondIndex}
            AND (block_height, microblock_sequence, tx_index)
                > (
                  ${firstResult.block_height},
                  ${firstResult.microblock_sequence},
                  ${firstResult.tx_index}
                )
          ORDER BY block_height ASC, microblock_sequence ASC, tx_index ASC
          LIMIT ${limit}
        `;
        prevCursor =
          prevPageQuery.length > 0
            ? encodeTransactionCursor(prevPageQuery[prevPageQuery.length - 1])
            : null;
      }

      return {
        limit,
        next_cursor: extraResult ? encodeTransactionCursor(extraResult) : null,
        prev_cursor: prevCursor,
        current_cursor: firstResult ? encodeTransactionCursor(firstResult) : null,
        total: totalQuery[0]?.total ?? 0,
        results,
      };
    });
  }

  /**
   * Gets a registration for a bond and principal.
   * @param args - The arguments for the query.
   * @returns The latest registration for a bond and principal.
   */
  async getBondRegistration(args: {
    bondIndex: number;
    principal: Principal;
  }): Promise<DbBondRegistration | null> {
    return await this.sqlTransaction(async sql => {
      const result = await sql<DbBondRegistration[]>`
        SELECT ${sql(BOND_REGISTRATION_COLUMNS)}
        FROM bond_registrations
        WHERE canonical = true
          AND microblock_canonical = true
          AND bond_index = ${args.bondIndex}
          AND staker = ${args.principal}
        LIMIT 1
      `;
      if (!result[0]) {
        return null;
      }
      return { ...result[0], btc_lockup_txs: parseBondLockupTxs(result[0].btc_lockup_txs) };
    });
  }

  /**
   * One-call staking overview for a principal: its (singleton) pox-5 STX-staking
   * position plus aggregate totals across all of its bond positions.
   * @param args - The arguments for the query.
   * @returns The staking summary.
   */
  async getPrincipalStakingSummary(args: {
    principal: Principal;
  }): Promise<DbPrincipalStakingSummary> {
    return await this.sqlTransaction(async sql => {
      // The pox-5 STX staking lock (latest-wins materialized row), resolved
      // against the current burn tip so an expired-but-not-unstaked lock reads
      // as 0 — consistent with `/balances/stx`. pox-5 has no force-unlock
      // height, so only natural expiry applies (forceUnlockHeights = null).
      const [tip] = await sql<{ burn_block_height: number }[]>`
        SELECT burn_block_height FROM chain_tip
      `;
      const [lockRow] = await sql<MaterializedStxLockRow[]>`
        SELECT locked_amount, unlock_burn_height, pox_version, lock_tx_id,
          lock_block_height, burnchain_lock_height
        FROM stx_locked_balances
        WHERE principal = ${args.principal} AND pox_version = 5
        LIMIT 1
      `;
      const resolvedLock = resolveMaterializedStxLock(lockRow, tip?.burn_block_height ?? 0, null);
      // The staking summary is materialized — a single-row lookup, no aggregates.
      const [totals] = await sql<
        {
          stx_accrued_rewards: string;
          stx_claimed_rewards: string;
          bond_count: number;
          bond_btc_locked: string;
          bond_stx_locked: string;
          bond_accrued_rewards: string;
          bond_claimed_rewards: string;
        }[]
      >`
        SELECT stx_accrued_rewards, stx_claimed_rewards, bond_count,
          bond_btc_locked, bond_stx_locked, bond_accrued_rewards, bond_claimed_rewards
        FROM principal_staking_totals
        WHERE principal = ${args.principal}
        LIMIT 1
      `;
      return {
        stx: {
          locked: resolvedLock.locked.toString(),
          accrued_rewards: totals?.stx_accrued_rewards ?? '0',
          claimed_rewards: totals?.stx_claimed_rewards ?? '0',
        },
        bonds: {
          count: totals?.bond_count ?? 0,
          btc_locked: totals?.bond_btc_locked ?? '0',
          stx_locked: totals?.bond_stx_locked ?? '0',
          accrued_rewards: totals?.bond_accrued_rewards ?? '0',
          claimed_rewards: totals?.bond_claimed_rewards ?? '0',
        },
      };
    });
  }

  /**
   * Gets a principal's bond positions, cursor-paginated by `bond_index` ascending.
   * @param args - The arguments for the query.
   * @returns The principal's bond positions.
   */
  async getPrincipalBondPositions(args: {
    principal: Principal;
    limit: number;
    cursor?: BondCursor;
  }): Promise<DbCursorPaginatedResult<DbPrincipalBondPosition>> {
    return await this.sqlTransaction(async sql => {
      // The position count is materialized on `principal_staking_totals` — a
      // single-row lookup rather than a COUNT over `principal_bond_positions`.
      const [totals] = await sql<{ bond_count: number }[]>`
        SELECT bond_count FROM principal_staking_totals WHERE principal = ${args.principal} LIMIT 1
      `;
      const total = totals?.bond_count ?? 0;

      const cursorFilter = args.cursor ? sql`AND bond_index >= ${parseInt(args.cursor)}` : sql``;
      const resultQuery = await sql<DbPrincipalBondPosition[]>`
        SELECT ${sql(prefixedCols(PRINCIPAL_BOND_POSITION_COLUMNS, 'p'))}
        FROM principal_bond_positions p
        WHERE p.canonical = true
          AND p.microblock_canonical = true
          AND p.principal = ${args.principal}
          ${cursorFilter}
        ORDER BY p.bond_index ASC
        LIMIT ${args.limit + 1}
      `;

      const hasNextPage = resultQuery.count > args.limit;
      const results = hasNextPage ? resultQuery.slice(0, args.limit) : resultQuery;

      const nextResult = resultQuery[resultQuery.length - 1];
      const nextCursor = hasNextPage && nextResult ? `${nextResult.bond_index}` : null;
      const firstResult = results[0];
      const currentCursor = firstResult ? `${firstResult.bond_index}` : null;

      let prevCursor: string | null = null;
      if (firstResult) {
        const prevPageQuery = await sql<{ bond_index: number }[]>`
          SELECT bond_index FROM principal_bond_positions
          WHERE canonical = true AND microblock_canonical = true
            AND principal = ${args.principal}
            AND bond_index < ${firstResult.bond_index}
          ORDER BY bond_index DESC
          LIMIT ${args.limit}
        `;
        if (prevPageQuery.length > 0) {
          prevCursor = `${prevPageQuery[prevPageQuery.length - 1].bond_index}`;
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
   * Gets the signer set of the current PoX cycle (the latest canonical cycle with a computed reward
   * set) joined with the signer manager key bindings that were effective when the cycle's reward
   * set was calculated.
   *
   * A manager's key binding lives in the contract's `signers` map, written only by
   * `register-signer`, so a binding is effective for the cycle if its `register-signer` landed
   * strictly before the cycle's anchor block, which encodes the contract rule that key changes made
   * before the prepare phase apply next cycle and later ones the cycle after. Registrations made at
   * or after the anchor surface as pending key updates (effective next cycle). `grant-signer-key` /
   * `revoke-signer-grant` only maintain the `(key, manager)` authorization map — a grant authorizes
   * a future registration but rotates nothing by itself — so live grants are surfaced separately
   * per manager as `granted_keys`.
   *
   * Keyset-paginated by weight descending, then signing key ascending, with the signing key as the
   * cursor.
   * @param args - The arguments for the query.
   * @returns The cycle's signers, or null if no PoX cycle exists yet.
   */
  async getCurrentCycleSigners(args: {
    limit: number;
    cursor?: string;
  }): Promise<(DbCursorPaginatedResult<DbCycleSigner> & { cycle_number: number }) | null> {
    return await this.sqlTransaction(async sql => {
      const [cycle] = await sql<{ cycle_number: number; block_height: number }[]>`
        SELECT cycle_number, block_height
        FROM pox_cycles
        WHERE canonical = TRUE
        ORDER BY cycle_number DESC
        LIMIT 1
      `;
      if (!cycle) return null;
      const cycleNumber = cycle.cycle_number;
      const anchorHeight = cycle.block_height;
      const cursor = args.cursor
        ? has0xPrefix(args.cursor)
          ? args.cursor
          : '0x' + args.cursor
        : undefined;

      // Keyset filter: rows at or after the cursor row in (weight DESC, signing_key ASC) order. An
      // unknown cursor key yields an empty page.
      const cursorFilter = cursor
        ? sql`
          AND (
            ps.weight < (SELECT weight FROM cursor_row)
            OR (ps.weight = (SELECT weight FROM cursor_row) AND ps.signing_key >= ${cursor})
          )`
        : sql``;

      // A manager's binding for the cycle is its latest register-signer strictly before the anchor:
      // registrations overwrite each other (the contract's signers map is keyed by principal) and
      // there is no unregister, so revokes never participate. A post-anchor registration is a
      // pending key update. Grants/revokes only maintain the (key, manager) authorization map: the
      // latest grant/revoke per pair decides whether the grant is live.
      const resultQuery = await sql<(DbCycleSigner & { total: number })[]>`
        WITH effective_bindings AS (
          SELECT DISTINCT ON (signer_manager)
            signer_manager, signer_key, block_height, burn_block_height, tx_id
          FROM signer_key_grants
          WHERE canonical = TRUE AND microblock_canonical = TRUE
            AND block_height < ${anchorHeight}
            AND kind = ${DbSignerKeyGrantKind.Register}
          ORDER BY signer_manager,
            block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
        ), pending_bindings AS (
          SELECT DISTINCT ON (signer_manager)
            signer_manager, signer_key, tx_id
          FROM signer_key_grants
          WHERE canonical = TRUE AND microblock_canonical = TRUE
            AND block_height >= ${anchorHeight}
            AND kind = ${DbSignerKeyGrantKind.Register}
          ORDER BY signer_manager,
            block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
        ), live_grants AS (
          SELECT DISTINCT ON (signer_manager, signer_key)
            signer_manager, signer_key, kind, auth_id::text AS auth_id, tx_id
          FROM signer_key_grants
          WHERE canonical = TRUE AND microblock_canonical = TRUE
            AND kind IN (${DbSignerKeyGrantKind.Grant}, ${DbSignerKeyGrantKind.Revoke})
          ORDER BY signer_manager, signer_key,
            block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
        ), cursor_row AS (
          SELECT weight FROM pox_sets
          WHERE canonical = TRUE
            AND cycle_number = ${cycleNumber}
            AND signing_key = ${cursor ?? null}
          LIMIT 1
        )
        SELECT
          ps.signing_key,
          ps.weight,
          ps.stacked_amount,
          ps.weight_percent,
          ps.stacked_amount_percent,
          (
            SELECT COUNT(*)::int FROM pox_sets
            WHERE canonical = TRUE AND cycle_number = ${cycleNumber}
          ) AS total,
          COALESCE((
            SELECT json_agg(json_build_object(
              'signer_manager', eb.signer_manager,
              'block_height', eb.block_height,
              'burn_block_height', eb.burn_block_height,
              'tx_id', concat('0x', encode(eb.tx_id, 'hex')),
              'granted_keys', COALESCE((
                SELECT json_agg(json_build_object(
                  'signer_key', concat('0x', encode(lg.signer_key, 'hex')),
                  'auth_id', lg.auth_id,
                  'tx_id', concat('0x', encode(lg.tx_id, 'hex'))
                ) ORDER BY lg.signer_key)
                FROM live_grants lg
                WHERE lg.signer_manager = eb.signer_manager
                  AND lg.kind = ${DbSignerKeyGrantKind.Grant}
              ), '[]'::json),
              'pending_signer_key',
                CASE WHEN pb.signer_key IS NOT NULL AND pb.signer_key != ps.signing_key
                  THEN concat('0x', encode(pb.signer_key, 'hex'))
                END,
              'pending_tx_id',
                CASE WHEN pb.signer_key IS NOT NULL AND pb.signer_key != ps.signing_key
                  THEN concat('0x', encode(pb.tx_id, 'hex'))
                END
            ) ORDER BY eb.signer_manager)
            FROM effective_bindings eb
            LEFT JOIN pending_bindings pb ON pb.signer_manager = eb.signer_manager
            WHERE eb.signer_key = ps.signing_key
          ), '[]'::json) AS signer_managers
        FROM pox_sets ps
        WHERE ps.canonical = TRUE AND ps.cycle_number = ${cycleNumber}
          ${cursorFilter}
        ORDER BY ps.weight DESC, ps.signing_key ASC
        LIMIT ${args.limit + 1}
      `;

      const hasNextPage = resultQuery.count > args.limit;
      const results = hasNextPage ? resultQuery.slice(0, args.limit) : [...resultQuery];
      const total = resultQuery.count > 0 ? resultQuery[0].total : 0;

      const nextResult = resultQuery[resultQuery.length - 1];
      const nextCursor = hasNextPage && nextResult ? nextResult.signing_key : null;
      const firstResult = results[0];
      const currentCursor = firstResult ? firstResult.signing_key : null;

      let prevCursor: string | null = null;
      if (firstResult) {
        const prevPageQuery = await sql<{ signing_key: string }[]>`
          SELECT signing_key FROM pox_sets ps
          WHERE ps.canonical = TRUE AND ps.cycle_number = ${cycleNumber}
            AND (
              ps.weight > ${firstResult.weight}
              OR (ps.weight = ${firstResult.weight} AND ps.signing_key < ${firstResult.signing_key})
            )
          ORDER BY ps.weight ASC, ps.signing_key DESC
          LIMIT ${args.limit}
        `;
        if (prevPageQuery.length > 0) {
          prevCursor = prevPageQuery[prevPageQuery.length - 1].signing_key;
        }
      }

      return {
        limit: args.limit,
        next_cursor: nextCursor,
        prev_cursor: prevCursor,
        current_cursor: currentCursor,
        total,
        cycle_number: cycleNumber,
        results: results.map(r => ({
          signing_key: r.signing_key,
          weight: r.weight,
          stacked_amount: r.stacked_amount,
          weight_percent: r.weight_percent,
          stacked_amount_percent: r.stacked_amount_percent,
          signer_managers: r.signer_managers,
        })),
      };
    });
  }

  /**
   * Gets the registered pox-5 staking signers, cursor-paginated by `signer`.
   * @param args - The arguments for the query.
   * @returns The registered signers.
   */
  async getStakingSigners(args: {
    limit: number;
    cursor?: SignerCursor;
  }): Promise<DbCursorPaginatedResult<DbStakingSigner>> {
    return await this.sqlTransaction(async sql => {
      const cursorFilter = args.cursor ? sql`WHERE signer >= ${args.cursor}` : sql``;
      const resultQuery = await sql<(DbStakingSigner & { total: number })[]>`
        SELECT
          ${sql(STAKING_SIGNER_COLUMNS)},
          (SELECT COUNT(*)::int FROM staking_signers) AS total
        FROM staking_signers
        ${cursorFilter}
        ORDER BY signer ASC
        LIMIT ${args.limit + 1}
      `;

      const hasNextPage = resultQuery.count > args.limit;
      const results = hasNextPage ? resultQuery.slice(0, args.limit) : resultQuery;
      const total = resultQuery.count > 0 ? resultQuery[0].total : 0;

      const nextResult = resultQuery[resultQuery.length - 1];
      const nextCursor = hasNextPage && nextResult ? nextResult.signer : null;
      const firstResult = results[0];
      const currentCursor = firstResult ? firstResult.signer : null;

      let prevCursor: string | null = null;
      if (firstResult) {
        const prevPageQuery = await sql<{ signer: string }[]>`
          SELECT signer FROM staking_signers
          WHERE signer < ${firstResult.signer}
          ORDER BY signer DESC
          LIMIT ${args.limit}
        `;
        if (prevPageQuery.length > 0) {
          prevCursor = prevPageQuery[prevPageQuery.length - 1].signer;
        }
      }

      return {
        limit: args.limit,
        next_cursor: nextCursor,
        prev_cursor: prevCursor,
        current_cursor: currentCursor,
        total,
        results: results.map(r => ({
          signer: r.signer,
          signer_key: r.signer_key,
          tx_id: r.tx_id,
          block_height: r.block_height,
          burn_block_height: r.burn_block_height,
        })),
      };
    });
  }

  /**
   * Gets a single registered pox-5 staking signer by its principal, joined with
   * the block position of its registration transaction.
   * @param args - The arguments for the query.
   * @returns The signer, or null if not registered.
   */
  async getStakingSigner(args: { signer: Principal }): Promise<DbStakingSignerDetail | null> {
    return await this.sqlTransaction(async sql => {
      const [result] = await sql<DbStakingSignerDetail[]>`
        SELECT
          ${sql(prefixedCols(STAKING_SIGNER_COLUMNS, 's'))},
          t.block_hash,
          t.index_block_hash,
          t.block_time,
          t.tx_index,
          t.burn_block_time
        FROM staking_signers s
        INNER JOIN txs t
          ON t.tx_id = s.tx_id AND t.canonical = true AND t.microblock_canonical = true
        WHERE s.signer = ${args.signer}
        LIMIT 1
      `;
      return result ?? null;
    });
  }

  /**
   * Lists the stakers that belong to a signer, unioned across pox-5 STX staking
   * (`stx_locked_balances.signer`, active locks) and bond staking (`bond_registrations.signer`),
   * deduplicated by staker with a flag per staking type. Keyset-paginated by staker principal
   * ascending.
   * @param args - The arguments for the query.
   * @returns The signer's stakers.
   */
  async getSignerStakers(args: {
    signer: Principal;
    limit: number;
    cursor?: string;
  }): Promise<DbCursorPaginatedResult<DbSignerStaker>> {
    return await this.sqlTransaction(async sql => {
      // A staker belongs to the signer if it has an active pox-5 STX stake under
      // it (`stx_locked_balances`) or a bond registration under it
      // (`bond_registrations`). A staker may do both, so the flags are OR-ed.
      //
      // `stx_locked_balances.locked_amount` stays positive after a lock naturally
      // expires (expiry is applied on read against the current burn tip — see
      // `resolveMaterializedStxLock`), so the STX half must also exclude expired
      // locks: a lock is active while `unlock_burn_height >= burn tip` (pox-5 has
      // no force-unlock height, so natural expiry is the only condition).
      const [tip] = await sql<{ burn_block_height: number }[]>`
        SELECT burn_block_height FROM chain_tip
      `;
      const burnBlockHeight = tip?.burn_block_height ?? 0;
      const stakerSet = sql`
        SELECT staker, bool_or(is_stx) AS stx, bool_or(is_bond) AS bond
        FROM (
          SELECT principal AS staker, true AS is_stx, false AS is_bond
          FROM stx_locked_balances
          WHERE signer = ${args.signer}
            AND locked_amount > 0
            AND unlock_burn_height >= ${burnBlockHeight}
          UNION ALL
          SELECT staker, false AS is_stx, true AS is_bond
          FROM bond_registrations
          WHERE signer = ${args.signer} AND canonical = true AND microblock_canonical = true
        ) s
        GROUP BY staker
      `;

      const cursorFilter = args.cursor ? sql`WHERE staker >= ${args.cursor}` : sql``;
      const resultQuery = await sql<(DbSignerStaker & { total: number })[]>`
        WITH stakers AS (${stakerSet})
        SELECT staker, stx, bond, (SELECT COUNT(*)::int FROM stakers) AS total
        FROM stakers
        ${cursorFilter}
        ORDER BY staker ASC
        LIMIT ${args.limit + 1}
      `;

      const hasNextPage = resultQuery.count > args.limit;
      const results = hasNextPage ? resultQuery.slice(0, args.limit) : resultQuery;
      const total = resultQuery.count > 0 ? resultQuery[0].total : 0;

      const nextResult = resultQuery[resultQuery.length - 1];
      const nextCursor = hasNextPage && nextResult ? nextResult.staker : null;
      const firstResult = results[0];
      const currentCursor = firstResult ? firstResult.staker : null;

      let prevCursor: string | null = null;
      if (firstResult) {
        const prevPageQuery = await sql<{ staker: string }[]>`
          WITH stakers AS (${stakerSet})
          SELECT staker FROM stakers
          WHERE staker < ${firstResult.staker}
          ORDER BY staker DESC
          LIMIT ${args.limit}
        `;
        if (prevPageQuery.length > 0) {
          prevCursor = prevPageQuery[prevPageQuery.length - 1].staker;
        }
      }

      return {
        limit: args.limit,
        next_cursor: nextCursor,
        prev_cursor: prevCursor,
        current_cursor: currentCursor,
        total,
        results: results.map(r => ({ staker: r.staker, stx: r.stx, bond: r.bond })),
      };
    });
  }
}
