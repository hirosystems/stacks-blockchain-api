import { Static, Type } from '@sinclair/typebox';
import { Nullable, OptionalNullable, PaginatedCursorResponse, PaginatedResponse } from '../util';
import { MempoolStatsSchema } from '../entities/mempool-transactions';
import { MempoolTransactionSchema, TransactionSchema } from '../entities/transactions';
import { MicroblockSchema } from '../entities/microblock';
import {
  AddressTransactionWithTransfersSchema,
  InboundStxTransferSchema,
} from '../entities/addresses';
import { TransactionEventSchema } from '../entities/transaction-events';
import {
  BurnchainRewardSchema,
  BurnchainRewardSlotHolderSchema,
} from '../entities/burnchain-rewards';
import { NakamotoBlockSchema, SignerSignatureSchema } from '../entities/block';

export const ErrorResponseSchema = Type.Object(
  {
    error: Type.String(),
    message: Type.Optional(Type.String()),
  },
  { title: 'Error Response', additionalProperties: true }
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

export const TransactionResultsSchema = PaginatedResponse(TransactionSchema, {
  description: 'List of transactions',
});
export type TransactionResults = Static<typeof TransactionResultsSchema>;

export const MempoolTransactionListResponse = PaginatedResponse(MempoolTransactionSchema, {
  description: 'List of mempool transactions',
});
export type MempoolTransactionListResponse = Static<typeof MempoolTransactionListResponse>;

export const MicroblockListResponseSchema = PaginatedResponse(MicroblockSchema, {
  title: 'MicroblockListResponse',
  description: 'GET request that returns microblocks',
});
export type MicroblockListResponse = Static<typeof MicroblockListResponseSchema>;

export const AddressTransactionsWithTransfersListResponseSchema = PaginatedResponse(
  AddressTransactionWithTransfersSchema,
  {
    title: 'AddressTransactionsWithTransfersListResponse',
  }
);
export type AddressTransactionsWithTransfersListResponse = Static<
  typeof AddressTransactionsWithTransfersListResponseSchema
>;

export const AddressTransactionsListResponseSchema = PaginatedResponse(TransactionSchema, {
  title: 'AddressTransactionsListResponse',
  description: 'GET request that returns account transactions',
});
export type AddressTransactionsListResponse = Static<typeof AddressTransactionsListResponseSchema>;

export const AddressStxInboundListResponseSchema = PaginatedResponse(InboundStxTransferSchema, {
  title: 'AddressStxInboundListResponse',
});
export type AddressStxInboundListResponse = Static<typeof AddressStxInboundListResponseSchema>;

export const TransactionEventsResponseSchema = Type.Object(
  {
    limit: Type.Integer({ examples: [20] }),
    offset: Type.Integer({ examples: [0] }),
    events: Type.Array(TransactionEventSchema),
  },
  { title: 'List of events' }
);
export type TransactionEventsResponse = Static<typeof TransactionEventsResponseSchema>;

export const BurnchainRewardSlotHolderListResponseSchema = PaginatedResponse(
  BurnchainRewardSlotHolderSchema,
  {
    title: 'BurnchainRewardSlotHolderListResponse',
    description: 'List of burnchain reward recipients and amounts',
  }
);
export type BurnchainRewardSlotHolderListResponse = Static<
  typeof BurnchainRewardSlotHolderListResponseSchema
>;

export const BurnchainRewardListResponseSchema = Type.Object(
  {
    limit: Type.Integer(),
    offset: Type.Integer(),
    results: Type.Array(BurnchainRewardSchema),
  },
  {
    description: 'List of burnchain reward recipients and amounts',
  }
);
export type BurnchainRewardListResponse = Static<typeof BurnchainRewardListResponseSchema>;

export const RunFaucetResponseSchema = Type.Object(
  {
    success: Type.Literal(true, {
      description: 'Indicates if the faucet call was successful',
    }),
    txId: Type.String({ description: 'The transaction ID for the faucet call' }),
    txRaw: Type.String({ description: 'Raw transaction in hex string representation' }),
  },
  {
    title: 'RunFaucetResponse',
    description: 'POST request that initiates a transfer of tokens to a specified testnet address',
  }
);
export type RunFaucetResponse = Static<typeof RunFaucetResponseSchema>;

export const BlockListV2ResponseSchema = PaginatedCursorResponse(NakamotoBlockSchema);
export type BlockListV2Response = Static<typeof BlockListV2ResponseSchema>;

export const BlockSignerSignatureResponseSchema = PaginatedResponse(SignerSignatureSchema);
export type BlockSignerSignatureResponse = Static<typeof BlockSignerSignatureResponseSchema>;
