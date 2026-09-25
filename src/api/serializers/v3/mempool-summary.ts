import { DbTxTypeId } from '../../../datastore/common.js';
import { DbMempoolSummaryRow } from '../../../datastore/v3/types.js';
import { MempoolMetrics, MempoolSummary } from '../../schemas/v3/entities/mempool-summary.js';

/** The transaction types clients can broadcast, and so the only ones that reach the mempool. */
const MEMPOOL_TX_TYPES = {
  token_transfer: DbTxTypeId.TokenTransfer,
  smart_contract: DbTxTypeId.SmartContract,
  contract_call: DbTxTypeId.ContractCall,
} as const;

/** An empty bucket: a type with nothing pending still reports a zero count and null percentiles. */
const emptyMetrics = (): MempoolMetrics => ({
  count: 0,
  fee_rate: { p25: null, p50: null, p75: null, p95: null },
  tx_size: { p25: null, p50: null, p75: null, p95: null },
  receipt_time: { p25: null, p50: null, p75: null, p95: null },
  receipt_block_height: { p25: null, p50: null, p75: null, p95: null },
});

const toMetrics = (row: DbMempoolSummaryRow): MempoolMetrics => ({
  count: row.count,
  fee_rate: {
    p25: row.fee_rate_p25,
    p50: row.fee_rate_p50,
    p75: row.fee_rate_p75,
    p95: row.fee_rate_p95,
  },
  tx_size: {
    p25: row.tx_size_p25,
    p50: row.tx_size_p50,
    p75: row.tx_size_p75,
    p95: row.tx_size_p95,
  },
  receipt_time: {
    p25: row.receipt_time_p25,
    p50: row.receipt_time_p50,
    p75: row.receipt_time_p75,
    p95: row.receipt_time_p95,
  },
  receipt_block_height: {
    p25: row.receipt_height_p25,
    p50: row.receipt_height_p50,
    p75: row.receipt_height_p75,
    p95: row.receipt_height_p95,
  },
});

/**
 * Shapes the mempool summary aggregate into its API response.
 *
 * The query returns one row per transaction type plus a grand-total row (`type_id === null`) from
 * its empty grouping set. An entirely empty mempool still produces that total row, so the response
 * shape does not depend on there being anything pending.
 * @param rows - The aggregate rows, as returned by `getMempoolSummary`.
 * @returns The mempool summary response.
 */
export function serializeMempoolSummary(rows: DbMempoolSummaryRow[]): MempoolSummary {
  const total = rows.find(r => r.type_id === null);
  const overall = total ? toMetrics(total) : emptyMetrics();
  const byType = Object.fromEntries(
    Object.entries(MEMPOOL_TX_TYPES).map(([name, typeId]) => {
      const row = rows.find(r => r.type_id === typeId);
      return [name, row ? toMetrics(row) : emptyMetrics()];
    })
  ) as MempoolSummary['by_type'];
  return {
    count: overall.count,
    fee_rate: overall.fee_rate,
    tx_size: overall.tx_size,
    receipt_time: overall.receipt_time,
    receipt_block_height: overall.receipt_block_height,
    by_type: byType,
  };
}
