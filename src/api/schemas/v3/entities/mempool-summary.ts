import { Static, TSchema, Type } from '@sinclair/typebox';
import { Nullable } from '../../v1/util.js';

/**
 * Percentile buckets for one metric. Every value is a discrete percentile (`percentile_disc`), so
 * it is a value some pending transaction actually has rather than an interpolation between two of
 * them. `null` when the bucket holds no transactions.
 */
const PercentilesSchema = <T extends TSchema>(type: T, description: string) =>
  Type.Object(
    {
      p25: Nullable(type),
      p50: Nullable(type),
      p75: Nullable(type),
      p95: Nullable(type),
    },
    { description }
  );

const FeeRateSchema = Type.String({
  pattern: '^[0-9]+$',
  description: 'Transaction fee as an integer string of micro-STX (µSTX)',
  examples: ['250'],
});

const MempoolMetricsSchema = Type.Object({
  count: Type.Integer({
    description: 'Number of pending transactions in this bucket',
    examples: [1203],
  }),
  fee_rate: PercentilesSchema(
    FeeRateSchema,
    'Transaction fee percentiles, in micro-STX (µSTX). Note that a fee is not a reliable ' +
      'predictor of inclusion on its own, since it does not account for execution cost.'
  ),
  tx_size: PercentilesSchema(
    Type.Integer({ examples: [241] }),
    'Serialized transaction size percentiles, in bytes.'
  ),
  receipt_time: PercentilesSchema(
    Type.Integer({ examples: [1789431980] }),
    'Percentiles of the unix timestamp (in seconds) at which the attached Stacks node received ' +
      'each transaction. Subtract from the current time for an age. Note the direction: the ' +
      'oldest pending transactions are at `p25`, not `p95`. These timings differ between API ' +
      'instances, since they reflect p2p propagation to the attached node rather than consensus.'
  ),
  receipt_block_height: PercentilesSchema(
    Type.Integer({ examples: [214500] }),
    'Percentiles of the Stacks block height that was the chain tip when the attached Stacks node ' +
      'received each transaction. Subtract from the current chain tip for an age in blocks. As ' +
      'with `receipt_time`, the oldest pending transactions are at `p25`.'
  ),
});
export type MempoolMetrics = Static<typeof MempoolMetricsSchema>;

export const MempoolSummarySchema = Type.Object(
  {
    count: MempoolMetricsSchema.properties.count,
    fee_rate: MempoolMetricsSchema.properties.fee_rate,
    tx_size: MempoolMetricsSchema.properties.tx_size,
    receipt_time: MempoolMetricsSchema.properties.receipt_time,
    receipt_block_height: MempoolMetricsSchema.properties.receipt_block_height,
    by_type: Type.Object(
      {
        token_transfer: MempoolMetricsSchema,
        smart_contract: MempoolMetricsSchema,
        contract_call: MempoolMetricsSchema,
      },
      {
        description:
          'The same metrics broken down by transaction type. Only the types that can enter the ' +
          'mempool are reported: coinbase, tenure-change, and poison-microblock transactions are ' +
          'never broadcast by clients. Versioned smart-contract transactions are counted as ' +
          '`smart_contract`.',
      }
    ),
  },
  {
    title: 'MempoolSummary',
    description:
      'A summary of the pending transactions currently in the mempool. Top-level metrics cover ' +
      'the whole mempool; `by_type` breaks them down by transaction type.',
  }
);
export type MempoolSummary = Static<typeof MempoolSummarySchema>;
