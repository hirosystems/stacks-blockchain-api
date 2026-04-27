import { Static, Type } from '@sinclair/typebox';
import { Nullable } from '../util.js';

const TransactionSenderSchema = Type.Object({
  address: Type.String({
    description: 'Address of the transaction initiator',
  }),
  nonce: Type.Integer({
    description: 'Nonce of the transaction initiator',
  }),
});

const TenureChangeCauseSchema = Type.Union(
  [
    Type.Literal('block_found'),
    Type.Literal('extended'),
    Type.Literal('extended_runtime'),
    Type.Literal('extended_read_count'),
    Type.Literal('extended_read_length'),
    Type.Literal('extended_write_count'),
    Type.Literal('extended_write_length'),
  ],
  {
    description:
      'Cause of change in mining tenure. Depending on cause, tenure can be ended or extended.',
  }
);

const TransactionSummaryStatusSchema = Type.Union(
  [
    Type.Literal('success'),
    Type.Literal('abort_by_response'),
    Type.Literal('abort_by_post_condition'),
  ],
  { description: 'Status of the transaction' }
);
export type TransactionSummaryStatus = Static<typeof TransactionSummaryStatusSchema>;

const BaseTransactionSummarySchema = Type.Object({
  tx_id: Type.String({
    description: 'Transaction ID',
  }),
  sender: TransactionSenderSchema,
  sponsor: Nullable(TransactionSenderSchema),
  fee_rate: Type.String({
    description: 'Transaction fee as Integer string (64-bit unsigned integer).',
  }),
  block: Type.Object({
    height: Type.Integer({
      description: 'Height of the block this transactions was associated with',
    }),
    hash: Type.String({
      description: 'Hash of the blocked this transactions was associated with',
    }),
    index_hash: Type.String({
      description: 'Hash of the index block this transactions was associated with',
    }),
    time: Type.Number({
      description: 'Unix timestamp (in seconds) indicating when this block was mined.',
    }),
    tx_index: Type.Integer({
      description:
        'Index of the transaction, indicating the order. Starts at `0` and increases with each transaction',
    }),
    tenure_height: Type.Integer({
      description: 'Height of the tenure this transactions was associated with',
    }),
  }),
  burn_block: Type.Object({
    height: Type.Integer({
      description: 'Height of the anchor burn block.',
    }),
    time: Type.Number({
      description: 'Unix timestamp (in seconds) indicating when this block was mined.',
    }),
  }),
  canonical: Type.Boolean({
    description: 'Set to `true` if block corresponds to the canonical chain tip',
  }),
  status: TransactionSummaryStatusSchema,
});
export type BaseTransactionSummary = Static<typeof BaseTransactionSummarySchema>;

export const TokenTransferTransactionSummarySchema = Type.Composite(
  [
    BaseTransactionSummarySchema,
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
    title: 'TokenTransferTransactionSummary',
    description: 'Token transfer transaction summary',
  }
);
export type TokenTransferTransactionSummary = Static<typeof TokenTransferTransactionSummarySchema>;

export const SmartContractTransactionSummarySchema = Type.Composite(
  [
    BaseTransactionSummarySchema,
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
    title: 'SmartContractTransactionSummary',
    description: 'Smart contract transaction summary',
  }
);
export type SmartContractTransactionSummary = Static<typeof SmartContractTransactionSummarySchema>;

export const ContractCallTransactionSummarySchema = Type.Composite(
  [
    BaseTransactionSummarySchema,
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
    title: 'ContractCallTransactionSummary',
    description: 'Contract call transaction summary',
  }
);
export type ContractCallTransactionSummary = Static<typeof ContractCallTransactionSummarySchema>;

export const PoisonMicroblockTransactionSummarySchema = Type.Composite(
  [
    BaseTransactionSummarySchema,
    Type.Object({
      type: Type.Literal('poison_microblock'),
    }),
  ],
  {
    title: 'PoisonMicroblockTransactionSummary',
    description: 'Poison microblock transaction summary',
  }
);
export type PoisonMicroblockTransactionSummary = Static<
  typeof PoisonMicroblockTransactionSummarySchema
>;

export const CoinbaseTransactionSummarySchema = Type.Composite(
  [
    BaseTransactionSummarySchema,
    Type.Object({
      type: Type.Literal('coinbase'),
      coinbase: Type.Object({
        alt_recipient: Nullable(
          Type.String({
            description:
              'A principal that will receive the miner rewards for this coinbase transaction. Can be either a standard principal or contract principal. Only specified for `coinbase-to-alt-recipient` transaction types, otherwise null.',
          })
        ),
      }),
    }),
  ],
  {
    title: 'CoinbaseTransactionSummary',
    description: 'Coinbase transaction summary',
  }
);
export type CoinbaseTransactionSummary = Static<typeof CoinbaseTransactionSummarySchema>;

export const TenureChangeTransactionSummarySchema = Type.Composite(
  [
    BaseTransactionSummarySchema,
    Type.Object({
      type: Type.Literal('tenure_change'),
      tenure_change: Type.Object({
        cause: TenureChangeCauseSchema,
      }),
    }),
  ],
  {
    title: 'TenureChangeTransactionSummary',
    description: 'Tenure change transaction summary',
  }
);
export type TenureChangeTransactionSummary = Static<typeof TenureChangeTransactionSummarySchema>;

export const TransactionSummarySchema = Type.Union([
  TokenTransferTransactionSummarySchema,
  SmartContractTransactionSummarySchema,
  ContractCallTransactionSummarySchema,
  PoisonMicroblockTransactionSummarySchema,
  CoinbaseTransactionSummarySchema,
  TenureChangeTransactionSummarySchema,
]);
export type TransactionSummary = Static<typeof TransactionSummarySchema>;
