import { BasePgStoreModule } from '@stacks/api-toolkit';
import { DbCursorPaginatedResult } from '../common.js';
import { DbTransactionSummary } from './types.js';

export class PgStoreV3 extends BasePgStoreModule {
  async getTransactionSummaries(args: {
    limit: number;
    cursor?: string;
  }): Promise<DbCursorPaginatedResult<DbTransactionSummary>> {
    const results = await this.sql<(DbTransactionSummary & { total: number })[]>`
      WITH total AS (
        SELECT tx_count FROM chain_tip
      )
      SELECT
        tx_id, sender_address, sponsor_address, sponsor_nonce, nonce, fee_rate,
        block_height, block_hash, index_block_hash, block_time, tx_index, tenure_height,
        burn_block_height, burn_block_time, canonical, status, type_id,
        token_transfer_recipient_address, token_transfer_amount, token_transfer_memo,
        smart_contract_clarity_version, smart_contract_contract_id, contract_call_contract_id,
        contract_call_function_name, coinbase_alt_recipient, tenure_change_cause,
        (SELECT total FROM total)::int AS total
      FROM txs
      WHERE canonical = true
      ORDER BY block_height DESC, microblock_sequence DESC, tx_index DESC
      LIMIT ${args.limit}
    `;
    return {
      limit: args.limit,
      offset: 0,
      next_cursor: null,
      prev_cursor: null,
      current_cursor: null,
      total: results[0]?.total ?? 0,
      results: results,
    };
  }
}
