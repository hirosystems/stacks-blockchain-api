import { Static, Type } from '@sinclair/typebox';
import { BaseMempoolTransactionSummarySchema } from './mempool-transaction-summaries.js';
import { PostConditionSchema } from './post-conditions.js';
import { Nullable } from '../../v1/util.js';
import { DecodedClarityValueSchema } from './common.js';

const BaseMempoolTransactionSchema = Type.Composite([
  BaseMempoolTransactionSummarySchema,
  Type.Object({
    post_conditions: Type.Optional(
      Type.Array(PostConditionSchema, {
        description: 'Only present when requested via the `include=post_conditions` query param.',
      })
    ),
    replaced_by_tx_id: Nullable(
      Type.String({
        description: 'ID of another transaction which replaced this one',
      })
    ),
  }),
]);
export type BaseMempoolTransaction = Static<typeof BaseMempoolTransactionSchema>;

const TokenTransferMempoolTransactionSchema = Type.Composite([
  BaseMempoolTransactionSchema,
  Type.Object({
    type: Type.Literal('token_transfer'),
    token_transfer: Type.Object({
      recipient: Type.String({
        description: 'Recipient of the token transfer',
      }),
      amount: Type.String({
        description: 'Amount of the token transfer',
      }),
      memo: Nullable(
        Type.String({
          description: 'Memo of the token transfer',
        })
      ),
    }),
  }),
]);
export type TokenTransferMempoolTransaction = Static<typeof TokenTransferMempoolTransactionSchema>;

const SmartContractMempoolTransactionSchema = Type.Composite([
  BaseMempoolTransactionSchema,
  Type.Object({
    type: Type.Literal('smart_contract'),
    smart_contract: Type.Object({
      contract_id: Type.String({
        description: 'Contract ID of the smart contract',
      }),
      clarity_version: Nullable(
        Type.Number({
          description: 'Clarity version of the smart contract',
        })
      ),
      source_code: Type.Optional(
        Type.String({
          description:
            'Source code of the smart contract. Only present when requested via the ' +
            '`include=source_code` query param.',
        })
      ),
    }),
  }),
]);
export type SmartContractMempoolTransaction = Static<typeof SmartContractMempoolTransactionSchema>;

const ContractCallMempoolTransactionSchema = Type.Composite([
  BaseMempoolTransactionSchema,
  Type.Object({
    type: Type.Literal('contract_call'),
    contract_call: Type.Object({
      contract_id: Type.String({
        description: 'Contract ID of the contract call',
      }),
      function_name: Type.String({
        description: 'Function name of the contract call',
      }),
      function_args: Type.Optional(
        Type.Array(DecodedClarityValueSchema, {
          description:
            'List of arguments used to invoke the function. Only present when requested ' +
            'via the `include=function_args` query param.',
        })
      ),
    }),
  }),
]);
export type ContractCallMempoolTransaction = Static<typeof ContractCallMempoolTransactionSchema>;

// Included for completeness, but not used in the mempool.
const PoisonMicroblockMempoolTransactionSchema = Type.Composite([
  BaseMempoolTransactionSchema,
  Type.Object({
    type: Type.Literal('poison_microblock'),
  }),
]);
export type PoisonMicroblockMempoolTransaction = Static<
  typeof PoisonMicroblockMempoolTransactionSchema
>;

// Included for completeness, but not used in the mempool.
const TenureChangeMempoolTransactionSchema = Type.Composite([
  BaseMempoolTransactionSchema,
  Type.Object({
    type: Type.Literal('tenure_change'),
  }),
]);
export type TenureChangeMempoolTransaction = Static<typeof TenureChangeMempoolTransactionSchema>;

// Included for completeness, but not used in the mempool.
const CoinbaseMempoolTransactionSchema = Type.Composite([
  BaseMempoolTransactionSchema,
  Type.Object({
    type: Type.Literal('coinbase'),
  }),
]);
export type CoinbaseMempoolTransaction = Static<typeof CoinbaseMempoolTransactionSchema>;

export const MempoolTransactionSchema = Type.Union([
  TokenTransferMempoolTransactionSchema,
  SmartContractMempoolTransactionSchema,
  ContractCallMempoolTransactionSchema,
  PoisonMicroblockMempoolTransactionSchema,
  TenureChangeMempoolTransactionSchema,
  CoinbaseMempoolTransactionSchema,
]);
export type MempoolTransaction = Static<typeof MempoolTransactionSchema>;
