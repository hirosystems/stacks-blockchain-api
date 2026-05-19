import { Static, Type } from '@sinclair/typebox';
import { BaseTransactionSummarySchema, TenureChangeCauseSchema } from './transaction-summaries.js';
import { PostConditionSchema } from './post-conditions.js';
import { Nullable } from '../../v1/util.js';
import { DecodedClarityValueSchema, ExecutionCostSchema } from './common.js';

const BaseTransactionSchema = Type.Composite([
  BaseTransactionSummarySchema,
  Type.Object({
    parent_block: Type.Object({
      hash: Type.String({
        description: 'Hash of the parent block',
      }),
      index_hash: Type.String({
        description: 'Index block hash of the parent block',
      }),
    }),
    post_conditions: Type.Array(PostConditionSchema),
    event_count: Type.Integer({
      description: 'Number of events in the transaction',
    }),
    execution_cost: ExecutionCostSchema,
    vm_error: Nullable(
      Type.String({
        description: 'VM error of the transaction',
      })
    ),
  }),
]);
export type BaseTransaction = Static<typeof BaseTransactionSchema>;

const TokenTransferTransactionSchema = Type.Composite([
  BaseTransactionSchema,
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
export type TokenTransferTransaction = Static<typeof TokenTransferTransactionSchema>;

const SmartContractTransactionSchema = Type.Composite([
  BaseTransactionSchema,
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
      source_code: Type.String({
        description: 'Source code of the smart contract',
      }),
    }),
  }),
]);
export type SmartContractTransaction = Static<typeof SmartContractTransactionSchema>;

const ContractCallTransactionSchema = Type.Composite([
  BaseTransactionSchema,
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
          description: 'List of arguments used to invoke the function',
        })
      ),
    }),
  }),
]);
export type ContractCallTransaction = Static<typeof ContractCallTransactionSchema>;

const PoisonMicroblockTransactionSchema = Type.Composite([
  BaseTransactionSchema,
  Type.Object({
    type: Type.Literal('poison_microblock'),
  }),
]);
export type PoisonMicroblockTransaction = Static<typeof PoisonMicroblockTransactionSchema>;

const TenureChangeTransactionSchema = Type.Composite([
  BaseTransactionSchema,
  Type.Object({
    type: Type.Literal('tenure_change'),
    tenure_change: Type.Object({
      tenure_consensus_hash: Type.String({
        description:
          'Consensus hash of this tenure. Corresponds to the sortition in which the miner of this block was chosen.',
      }),
      prev_tenure_consensus_hash: Type.String({
        description:
          'Consensus hash of the previous tenure. Corresponds to the sortition of the previous winning block-commit.',
      }),
      burn_view_consensus_hash: Type.String({
        description:
          'Current consensus hash on the underlying burnchain. Corresponds to the last-seen sortition.',
      }),
      previous_tenure_end: Type.String({
        description: '(Hex string) Stacks Block hash',
      }),
      previous_tenure_blocks: Type.Integer({
        description: 'The number of blocks produced in the previous tenure.',
      }),
      cause: TenureChangeCauseSchema,
      pubkey_hash: Type.String({
        description: '(Hex string) The ECDSA public key hash of the current tenure.',
      }),
    }),
  }),
]);
export type TenureChangeTransaction = Static<typeof TenureChangeTransactionSchema>;

const CoinbaseTransactionSchema = Type.Composite([
  BaseTransactionSchema,
  Type.Object({
    type: Type.Literal('coinbase'),
    coinbase: Type.Object({
      payload: Type.String({
        description: 'Payload of the coinbase transaction',
      }),
      alt_recipient: Nullable(
        Type.String({
          description: 'Alt recipient of the coinbase transaction',
        })
      ),
      vrf_proof: Nullable(
        Type.String({
          description: 'VRF proof of the coinbase transaction',
        })
      ),
    }),
  }),
]);
export type CoinbaseTransaction = Static<typeof CoinbaseTransactionSchema>;

export const TransactionSchema = Type.Union([
  TokenTransferTransactionSchema,
  SmartContractTransactionSchema,
  ContractCallTransactionSchema,
  PoisonMicroblockTransactionSchema,
  TenureChangeTransactionSchema,
  CoinbaseTransactionSchema,
]);
export type Transaction = Static<typeof TransactionSchema>;
