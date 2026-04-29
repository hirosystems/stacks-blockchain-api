import { BasePgStoreModule } from '@stacks/api-toolkit';
import { DbCursorPaginatedResult, DbEventTypeId } from '../common.js';
import {
  DbMempoolTransaction,
  DbMempoolTransactionSummary,
  DbTransaction,
  DbTransactionEvent,
  DbTransactionSummary,
} from './types.js';
import { InvalidRequestError, InvalidRequestErrorType } from '../../errors.js';
import { TransactionLimitParamSchema } from 'src/api/routes/v2/schemas.js';

type TransactionSummaryQueryResult = DbTransactionSummary & {
  microblock_sequence: number;
  total: number;
};

const TX_SUMMARY_COLUMNS = [
  'tx_id',
  'sender_address',
  'sponsor_address',
  'sponsor_nonce',
  'nonce',
  'fee_rate',
  'block_height',
  'block_hash',
  'index_block_hash',
  'block_time',
  'tx_index',
  'microblock_sequence',
  'burn_block_height',
  'burn_block_time',
  'canonical',
  'status',
  'type_id',
  'token_transfer_recipient_address',
  'token_transfer_amount',
  'token_transfer_memo',
  'smart_contract_clarity_version',
  'smart_contract_contract_id',
  'contract_call_contract_id',
  'contract_call_function_name',
  'coinbase_alt_recipient',
  'tenure_change_cause',
];

const TX_COLUMNS = [
  ...TX_SUMMARY_COLUMNS,
  'parent_block_hash',
  'parent_index_block_hash',
  'post_conditions',
  'event_count',
  'execution_cost_read_count',
  'execution_cost_read_length',
  'execution_cost_runtime',
  'execution_cost_write_count',
  'execution_cost_write_length',
  'vm_error',
  'smart_contract_source_code',
  'contract_call_function_args',
  'coinbase_payload',
  'coinbase_vrf_proof',
  'tenure_change_tenure_consensus_hash',
  'tenure_change_prev_tenure_consensus_hash',
  'tenure_change_burn_view_consensus_hash',
  'tenure_change_previous_tenure_end',
  'tenure_change_previous_tenure_blocks',
  'tenure_change_pubkey_hash',
];

const MEMPOOL_TX_SUMMARY_COLUMNS = [
  'tx_id',
  'type_id',
  'status',
  'sender_address',
  'nonce',
  'sponsor_address',
  'sponsor_nonce',
  'fee_rate',
  'receipt_time',
  'receipt_block_height',
  'token_transfer_recipient_address',
  'token_transfer_amount',
  'token_transfer_memo',
  'smart_contract_clarity_version',
  'smart_contract_contract_id',
  'contract_call_contract_id',
  'contract_call_function_name',
  'coinbase_alt_recipient',
  'tenure_change_cause',
];

const MEMPOOL_TX_COLUMNS = [
  ...MEMPOOL_TX_SUMMARY_COLUMNS,
  'replaced_by_tx_id',
  'post_conditions',
  'smart_contract_source_code',
  'contract_call_function_args',
  'coinbase_payload',
  'coinbase_vrf_proof',
  'tenure_change_tenure_consensus_hash',
  'tenure_change_prev_tenure_consensus_hash',
  'tenure_change_burn_view_consensus_hash',
  'tenure_change_previous_tenure_end',
  'tenure_change_previous_tenure_blocks',
  'tenure_change_pubkey_hash',
];

function encodeMempoolTxSummaryCursor(
  tx: Pick<DbMempoolTransactionSummary, 'receipt_time' | 'tx_id'>
) {
  return `${tx.receipt_time}:${tx.tx_id}`;
}

export class PgStoreV3 extends BasePgStoreModule {
  async getTransactionSummaryList(args: {
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

      const resultQuery = await sql<TransactionSummaryQueryResult[]>`
        WITH total AS (
          SELECT tx_count FROM chain_tip
        )
        SELECT
          ${sql(TX_SUMMARY_COLUMNS)},
          (SELECT tx_count FROM total)::int AS total
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

  async getMempoolTransactionSummaryList(args: {
    limit: number;
    cursor?: string;
  }): Promise<DbCursorPaginatedResult<DbMempoolTransactionSummary>> {
    return await this.sqlTransaction(async sql => {
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

  async getTransaction(args: {
    txId: string;
  }): Promise<DbTransaction | DbMempoolTransaction | null> {
    return await this.sqlTransaction(async sql => {
      const result = await this.sql<DbTransaction[]>`
        SELECT ${this.sql(TX_COLUMNS)}
        FROM txs
        WHERE tx_id = ${args.txId} AND canonical = true AND microblock_canonical = true
      `;
      if (result.count > 0) {
        return result[0];
      }
      const mempoolResult = await sql<DbMempoolTransaction[]>`
        SELECT ${this.sql(MEMPOOL_TX_COLUMNS)}
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
    cursor?: string;
  }): Promise<DbCursorPaginatedResult<DbTransactionEvent>> {
    return await this.sqlTransaction(async sql => {
      const limit = args.limit ?? TransactionLimitParamSchema.default;
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
