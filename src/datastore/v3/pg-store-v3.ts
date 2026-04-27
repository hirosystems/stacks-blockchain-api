import { BasePgStoreModule } from '@stacks/api-toolkit';
import { DbCursorPaginatedResult } from '../common.js';
import { DbTransactionSummary } from './types.js';
import { InvalidRequestError, InvalidRequestErrorType } from '../../errors.js';

type TransactionSummaryQueryResult = DbTransactionSummary & {
  microblock_sequence: number;
  total: number;
};

export class PgStoreV3 extends BasePgStoreModule {
  async getTransactionSummaries(args: {
    limit: number;
    cursor?: string;
  }): Promise<DbCursorPaginatedResult<DbTransactionSummary>> {
    return await this.sqlTransaction(async sql => {
      let cursorFilter = sql``;
      if (args.cursor) {
        const parts = args.cursor.split(':');
        if (parts.length !== 3) {
          throw new InvalidRequestError(
            'Invalid cursor format',
            InvalidRequestErrorType.invalid_param
          );
        }
        const [blockHeightStr, microblockSequenceStr, txIndexStr] = parts;
        const blockHeight = parseInt(blockHeightStr, 10);
        const microblockSequence = parseInt(microblockSequenceStr, 10);
        const txIndex = parseInt(txIndexStr, 10);
        if (isNaN(blockHeight) || isNaN(microblockSequence) || isNaN(txIndex)) {
          throw new InvalidRequestError(
            'Invalid cursor format',
            InvalidRequestErrorType.invalid_param
          );
        }

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
          tx_id, sender_address, sponsor_address, sponsor_nonce, nonce, fee_rate,
          block_height, block_hash, index_block_hash, block_time, tx_index, tenure_height,
          microblock_sequence, burn_block_height, burn_block_time, canonical, status, type_id,
          token_transfer_recipient_address, token_transfer_amount, token_transfer_memo,
          smart_contract_clarity_version, smart_contract_contract_id, contract_call_contract_id,
          contract_call_function_name, coinbase_alt_recipient, tenure_change_cause,
          (SELECT total FROM total)::int AS total
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

      const lastResult = resultQuery[resultQuery.length - 1];
      const prevCursor =
        hasNextPage && lastResult
          ? `${lastResult.block_height}:${lastResult.microblock_sequence}:${lastResult.tx_index}`
          : null;

      const firstResult = results[0];
      const currentCursor = firstResult
        ? `${firstResult.block_height}:${firstResult.microblock_sequence}:${firstResult.tx_index}`
        : null;

      let nextCursor: string | null = null;
      if (firstResult) {
        const prevQuery = await sql<
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
        if (prevQuery.length > 0) {
          const prev = prevQuery[0];
          nextCursor = `${prev.block_height}:${prev.microblock_sequence}:${prev.tx_index}`;
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
