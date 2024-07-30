import { Static, Type } from '@sinclair/typebox';
import { OptionalNullable } from '../util';
import { MempoolStatsSchema } from '../entities/mempool-transactions';

export const ErrorResponseSchema = Type.Object(
  {
    error: Type.String(),
  },
  { title: 'Error Response' }
);

export const ServerStatusResponseSchema = Type.Object(
  {
    server_version: Type.String({
      description: 'the server version that is currently running',
    }),
    status: Type.String({
      description: 'the current server status',
    }),
    pox_v1_unlock_height: OptionalNullable(Type.Integer()),
    pox_v2_unlock_height: OptionalNullable(Type.Integer()),
    pox_v3_unlock_height: OptionalNullable(Type.Integer()),
    chain_tip: OptionalNullable(
      Type.Object({
        block_height: Type.Integer({
          description: 'the current block height',
        }),
        block_hash: Type.String({
          description: 'the current block hash',
        }),
        index_block_hash: Type.String({
          description: 'the current index block hash',
        }),
        microblock_hash: Type.Optional(
          Type.String({
            description: 'the current microblock hash',
          })
        ),
        microblock_sequence: Type.Optional(
          Type.Integer({
            description: 'the current microblock sequence number',
          })
        ),
        burn_block_height: Type.Integer({
          description: 'the current burn chain block height',
        }),
      })
    ),
  },
  { title: 'Api Status Response' }
);
export type ServerStatusResponse = Static<typeof ServerStatusResponseSchema>;

export const MempoolStatsResponseSchema = Type.Object(
  {
    tx_type_counts: Type.Record(Type.String(), Type.Integer(), {
      additionalProperties: false,
      description: 'Number of tranasction in the mempool, broken down by transaction type.',
    }),
    tx_simple_fee_averages: Type.Record(Type.String(), MempoolStatsSchema, {
      description:
        'The simple mean (average) transaction fee, broken down by transaction type. Note that this does not factor in actual execution costs. The average fee is not a reliable metric for calculating a fee for a new transaction.',
    }),
    tx_ages: Type.Record(Type.String(), MempoolStatsSchema, {
      description:
        'The average time (in blocks) that transactions have lived in the mempool. The start block height is simply the current chain-tip of when the attached Stacks node receives the transaction. This timing can be different across Stacks nodes / API instances due to propagation timing differences in the p2p network.',
    }),
    tx_byte_sizes: Type.Record(Type.String(), MempoolStatsSchema, {
      description:
        'The average byte size of transactions in the mempool, broken down by transaction type.',
    }),
  },
  {
    title: 'MempoolTransactionStatsResponse',
    description: 'GET request that returns stats on mempool transactions',
  }
);

export const RawTransactionResponseSchema = Type.Object(
  {
    raw_tx: Type.String(),
  },
  { title: 'GetRawTransactionResult', description: 'GET raw transaction' }
);
