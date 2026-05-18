import { Static, Type } from '@sinclair/typebox';
import { TransactionSenderSchema } from './transaction-summaries.js';
import { Nullable } from '../../util.js';

const MempoolTransactionStatusSchema = Type.Union(
  [
    Type.Literal('pending'),
    Type.Literal('dropped_replace_by_fee'),
    Type.Literal('dropped_replace_across_fork'),
    Type.Literal('dropped_too_expensive'),
    Type.Literal('dropped_stale_garbage_collect'),
    Type.Literal('dropped_problematic'),
  ],
  { description: 'Status of the mempool transaction' }
);
export type MempoolTransactionStatus = Static<typeof MempoolTransactionStatusSchema>;

export const BaseMempoolTransactionSummarySchema = Type.Object({
  tx_id: Type.String({
    description: 'Transaction ID',
  }),
  sender: TransactionSenderSchema,
  sponsor: Nullable(TransactionSenderSchema),
  fee_rate: Type.String({
    description: 'Transaction fee as Integer string (64-bit unsigned integer).',
  }),
  receipt_time: Type.Integer({
    description:
      'A unix timestamp (in seconds) indicating when the transaction broadcast was received by the node.',
  }),
  receipt_block_height: Type.Integer({
    description: 'Height of the block this transaction was received by the node',
  }),
  status: MempoolTransactionStatusSchema,
});
export type BaseMempoolTransactionSummary = Static<typeof BaseMempoolTransactionSummarySchema>;

export const TokenTransferMempoolTransactionSummarySchema = Type.Composite(
  [
    BaseMempoolTransactionSummarySchema,
    Type.Object({
      type: Type.Literal('token_transfer'),
      token_transfer: Type.Object({
        recipient: Type.String(),
        amount: Type.String({
          description: 'Transfer amount as Integer string (64-bit unsigned integer)',
        }),
        memo: Nullable(
          Type.String({
            description:
              'Hex encoded arbitrary message, up to 34 bytes length (should try decoding to an ASCII string)',
          })
        ),
      }),
    }),
  ],
  {
    title: 'TokenTransferMempoolTransactionSummary',
    description: 'Token transfer mempool transaction summary',
  }
);
export type TokenTransferMempoolTransactionSummary = Static<
  typeof TokenTransferMempoolTransactionSummarySchema
>;

export const SmartContractMempoolTransactionSummarySchema = Type.Composite(
  [
    BaseMempoolTransactionSummarySchema,
    Type.Object({
      type: Type.Literal('smart_contract'),
      smart_contract: Type.Object({
        clarity_version: Nullable(
          Type.Number({
            description:
              'The Clarity version of the contract, only specified for versioned contract transactions, otherwise null',
          })
        ),
        contract_id: Type.String({
          description: 'Contract identifier formatted as `<principaladdress>.<contract_name>`',
        }),
      }),
    }),
  ],
  {
    title: 'SmartContractMempoolTransactionSummary',
    description: 'Smart contract mempool transaction summary',
  }
);
export type SmartContractMempoolTransactionSummary = Static<
  typeof SmartContractMempoolTransactionSummarySchema
>;

export const ContractCallMempoolTransactionSummarySchema = Type.Composite(
  [
    BaseMempoolTransactionSummarySchema,
    Type.Object({
      type: Type.Literal('contract_call'),
      contract_call: Type.Object({
        contract_id: Type.String({
          description: 'Contract identifier formatted as `<principaladdress>.<contract_name>`',
        }),
        function_name: Type.String({
          description: 'Name of the Clarity function to be invoked',
        }),
      }),
    }),
  ],
  {
    title: 'ContractCallMempoolTransactionSummary',
    description: 'Contract call mempool transaction summary',
  }
);
export type ContractCallMempoolTransactionSummary = Static<
  typeof ContractCallMempoolTransactionSummarySchema
>;

// Included for completeness, but not used in the mempool.
export const PoisonMicroblockMempoolTransactionSummarySchema = Type.Composite(
  [
    BaseMempoolTransactionSummarySchema,
    Type.Object({
      type: Type.Literal('poison_microblock'),
    }),
  ],
  {
    title: 'PoisonMicroblockMempoolTransactionSummary',
    description: 'Poison microblock mempool transaction summary',
  }
);
export type PoisonMicroblockMempoolTransactionSummary = Static<
  typeof PoisonMicroblockMempoolTransactionSummarySchema
>;

// Included for completeness, but not used in the mempool.
export const CoinbaseMempoolTransactionSummarySchema = Type.Composite(
  [
    BaseMempoolTransactionSummarySchema,
    Type.Object({
      type: Type.Literal('coinbase'),
    }),
  ],
  {
    title: 'CoinbaseMempoolTransactionSummary',
    description: 'Coinbase mempool transaction summary',
  }
);
export type CoinbaseMempoolTransactionSummary = Static<
  typeof CoinbaseMempoolTransactionSummarySchema
>;

// Included for completeness, but not used in the mempool.
export const TenureChangeMempoolTransactionSummarySchema = Type.Composite(
  [
    BaseMempoolTransactionSummarySchema,
    Type.Object({
      type: Type.Literal('tenure_change'),
    }),
  ],
  {
    title: 'TenureChangeMempoolTransactionSummary',
    description: 'Tenure change mempool transaction summary',
  }
);
export type TenureChangeMempoolTransactionSummary = Static<
  typeof TenureChangeMempoolTransactionSummarySchema
>;

export const MempoolTransactionSummarySchema = Type.Union([
  TokenTransferMempoolTransactionSummarySchema,
  SmartContractMempoolTransactionSummarySchema,
  ContractCallMempoolTransactionSummarySchema,
  PoisonMicroblockMempoolTransactionSummarySchema,
  CoinbaseMempoolTransactionSummarySchema,
  TenureChangeMempoolTransactionSummarySchema,
]);
export type MempoolTransactionSummary = Static<typeof MempoolTransactionSummarySchema>;
