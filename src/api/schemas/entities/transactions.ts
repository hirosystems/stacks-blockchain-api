import { Static, Type } from '@sinclair/typebox';
import { Nullable } from '../util';
import { PostConditionModeSchema, PostConditionSchema } from './post-conditions';
import { TransactionEventSchema } from './transaction-events';

const TransactionType = {
  coinbase: 'coinbase',
  token_transfer: 'token_transfer',
  smart_contract: 'smart_contract',
  contract_call: 'contract_call',
  poison_microblock: 'poison_microblock',
  tenure_change: 'tenure_change',
} as const;
export const TransactionTypeSchema = Type.Enum(TransactionType);

export const BaseTransactionSchemaProperties = {
  tx_id: Type.String({
    description: 'Transaction ID',
  }),
  nonce: Type.Integer({
    description:
      "Used for ordering the transactions originating from and paying from an account. The nonce ensures that a transaction is processed at most once. The nonce counts the number of times an account's owner(s) have authorized a transaction. The first transaction from an account will have a nonce value equal to 0, the second will have a nonce value equal to 1, and so on.",
  }),
  fee_rate: Type.String({
    description: 'Transaction fee as Integer string (64-bit unsigned integer).',
  }),
  sender_address: Type.String({
    description: 'Address of the transaction initiator',
  }),
  sponsor_nonce: Type.Optional(Type.Integer()),
  sponsored: Type.Boolean({
    description: 'Denotes whether the originating account is the same as the paying account',
  }),
  sponsor_address: Type.Optional(Type.String()),
  post_condition_mode: PostConditionModeSchema,
  post_conditions: Type.Array(PostConditionSchema),
  anchor_mode: Type.Union(
    [Type.Literal('on_chain_only'), Type.Literal('off_chain_only'), Type.Literal('any')],
    {
      description:
        '`on_chain_only`: the transaction MUST be included in an anchored block, `off_chain_only`: the transaction MUST be included in a microblock, `any`: the leader can choose where to include the transaction.',
    }
  ),
};

const BaseTransactionSchema = Type.Object(BaseTransactionSchemaProperties, {
  title: 'BaseTransaction',
  description:
    'Transaction properties that are available from a raw serialized transactions. These are available for transactions in the mempool as well as mined transactions.',
});
export type BaseTransaction = Static<typeof BaseTransactionSchema>;

const AbstractTransactionProperties = {
  ...BaseTransactionSchemaProperties,
  block_hash: Type.String({
    description: 'Hash of the blocked this transactions was associated with',
  }),
  block_height: Type.Integer({
    description: 'Height of the block this transactions was associated with',
  }),
  block_time: Type.Number({
    description: 'Unix timestamp (in seconds) indicating when this block was mined.',
  }),
  block_time_iso: Type.String({
    description: 'An ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ) indicating when this block was mined.',
  }),
  burn_block_time: Type.Integer({
    description: 'Unix timestamp (in seconds) indicating when this block was mined.',
  }),
  burn_block_height: Type.Integer({
    description: 'Height of the anchor burn block.',
  }),
  burn_block_time_iso: Type.String({
    description:
      'An ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ) timestamp indicating when this block was mined.',
  }),
  parent_burn_block_time: Type.Integer({
    description: 'Unix timestamp (in seconds) indicating when this parent block was mined',
  }),
  parent_burn_block_time_iso: Type.String({
    description:
      'An ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ) timestamp indicating when this parent block was mined.',
  }),
  canonical: Type.Boolean({
    description: 'Set to `true` if block corresponds to the canonical chain tip',
  }),
  tx_index: Type.Integer({
    description:
      'Index of the transaction, indicating the order. Starts at `0` and increases with each transaction',
  }),
  tx_status: Type.Union(
    [
      Type.Literal('success'),
      Type.Literal('abort_by_response'),
      Type.Literal('abort_by_post_condition'),
    ],
    {
      description: 'Status of the transaction',
    }
  ),
  tx_result: Type.Object(
    {
      hex: Type.String({
        description: 'Hex string representing the value fo the transaction result',
      }),
      repr: Type.String({
        description: 'Readable string of the transaction result',
      }),
    },
    {
      description:
        'Result of the transaction. For contract calls, this will show the value returned by the call. For other transaction types, this will return a boolean indicating the success of the transaction.',
      additionalProperties: false,
    }
  ),
  event_count: Type.Integer({
    description: 'Number of transaction events',
  }),
  parent_block_hash: Type.String({
    description: 'Hash of the previous block.',
  }),
  is_unanchored: Type.Boolean({
    description:
      'True if the transaction is included in a microblock that has not been confirmed by an anchor block.',
  }),
  microblock_hash: Type.String({
    description:
      'The microblock hash that this transaction was streamed in. If the transaction was batched in an anchor block (not included within a microblock) then this value will be an empty string.',
  }),
  microblock_sequence: Type.Integer({
    description:
      'The microblock sequence number that this transaction was streamed in. If the transaction was batched in an anchor block (not included within a microblock) then this value will be 2147483647 (0x7fffffff, the max int32 value), this value preserves logical transaction ordering on (block_height, microblock_sequence, tx_index).',
  }),
  microblock_canonical: Type.Boolean({
    description:
      'Set to `true` if microblock is anchored in the canonical chain tip, `false` if the transaction was orphaned in a micro-fork.',
  }),
  execution_cost_read_count: Type.Integer({
    description: 'Execution cost read count.',
  }),
  execution_cost_read_length: Type.Integer({
    description: 'Execution cost read length.',
  }),
  execution_cost_runtime: Type.Integer({
    description: 'Execution cost runtime.',
  }),
  execution_cost_write_count: Type.Integer({
    description: 'Execution cost write count.',
  }),
  execution_cost_write_length: Type.Integer({
    description: 'Execution cost write length.',
  }),
  vm_error: Nullable(Type.String({ description: 'Clarity VM error produced by this transaction' })),
  events: Type.Array(TransactionEventSchema),
};
const AbstractTransactionSchema = Type.Object({
  ...AbstractTransactionProperties,
});
export type AbstractTransaction = Static<typeof AbstractTransactionSchema>;

export const TokenTransferTransactionMetadataProperties = {
  tx_type: Type.Literal('token_transfer'),
  token_transfer: Type.Object({
    recipient_address: Type.String(),
    amount: Type.String({
      description: 'Transfer amount as Integer string (64-bit unsigned integer)',
    }),
    memo: Type.String({
      description:
        'Hex encoded arbitrary message, up to 34 bytes length (should try decoding to an ASCII string)',
    }),
  }),
};
const TokenTransferTransactionMetadataSchema = Type.Object(
  TokenTransferTransactionMetadataProperties,
  {
    title: 'TokenTransferTransactionMetadata',
    description: 'Metadata associated with token-transfer type transactions',
  }
);
export type TokenTransferTransactionMetadata = Static<
  typeof TokenTransferTransactionMetadataSchema
>;

export const SmartContractTransactionMetadataProperties = {
  tx_type: Type.Literal('smart_contract'),
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
    source_code: Type.String({
      description: 'Clarity code of the smart contract being deployed',
    }),
  }),
};
const SmartContractTransactionMetadataSchema = Type.Object(
  SmartContractTransactionMetadataProperties,
  {
    title: 'SmartContractTransactionMetadata',
    description:
      'Metadata associated with a contract-deploy type transaction. https://github.com/blockstack/stacks-blockchain/blob/master/sip/sip-005-blocks-and-transactions.md#type-1-instantiating-a-smart-contract',
  }
);
export type SmartContractTransactionMetadata = Static<
  typeof SmartContractTransactionMetadataSchema
>;

export const ContractCallTransactionMetadataProperties = {
  tx_type: Type.Literal('contract_call'),
  contract_call: Type.Object({
    contract_id: Type.String({
      description: 'Contract identifier formatted as `<principaladdress>.<contract_name>`',
    }),
    function_name: Type.String({
      description: 'Name of the Clarity function to be invoked',
    }),
    function_signature: Type.String({
      description:
        'Function definition, including function name and type as well as parameter names and types',
    }),
    function_args: Type.Optional(
      Type.Array(
        Type.Object(
          {
            hex: Type.String(),
            repr: Type.String(),
            name: Type.String(),
            type: Type.String(),
          },
          {
            additionalProperties: false,
            description: 'List of arguments used to invoke the function',
          }
        )
      )
    ),
  }),
};
const ContractCallTransactionMetadataSchema = Type.Object(
  ContractCallTransactionMetadataProperties,
  {
    title: 'ContractCallTransactionMetadata',
    description: 'Metadata associated with a contract-call type transaction',
  }
);
export type ContractCallTransactionMetadata = Static<typeof ContractCallTransactionMetadataSchema>;

export const PoisonMicroblockTransactionMetadataProperties = {
  tx_type: Type.Literal('poison_microblock'),
  poison_microblock: Type.Object({
    microblock_header_1: Type.String({
      description: 'Hex encoded microblock header',
    }),
    microblock_header_2: Type.String({
      description: 'Hex encoded microblock header',
    }),
  }),
};
const PoisonMicroblockTransactionMetadataSchema = Type.Object(
  PoisonMicroblockTransactionMetadataProperties,
  {
    title: 'PoisonMicroblockTransactionMetadata',
    description: 'Metadata associated with a poison-microblock type transaction',
  }
);
export type PoisonMicroblockTransactionMetadata = Static<
  typeof PoisonMicroblockTransactionMetadataSchema
>;

export const CoinbaseTransactionMetadataProperties = {
  tx_type: Type.Literal('coinbase'),
  coinbase_payload: Type.Object({
    data: Type.String({
      type: 'string',
      description: "Hex encoded 32-byte scratch space for block leader's use",
    }),
    alt_recipient: Type.Optional(
      Nullable(
        Type.String({
          description:
            'A principal that will receive the miner rewards for this coinbase transaction. Can be either a standard principal or contract principal. Only specified for `coinbase-to-alt-recipient` transaction types, otherwise null.',
        })
      )
    ),
    vrf_proof: Type.Optional(
      Nullable(
        Type.String({
          description: 'Hex encoded 80-byte VRF proof',
        })
      )
    ),
  }),
};
const CoinbaseTransactionMetadataSchema = Type.Object(CoinbaseTransactionMetadataProperties, {
  title: 'CoinbaseTransaction',
  description: 'Metadata associated with a coinbase type transaction',
});
export type CoinbaseTransactionMetadata = Static<typeof CoinbaseTransactionMetadataSchema>;

export const TenureChangeTransactionMetadataProperties = {
  tx_type: Type.Literal('tenure_change'),
  tenure_change_payload: Type.Object({
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
    cause: Type.Union(
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
    ),
    pubkey_hash: Type.String({
      description: '(Hex string) The ECDSA public key hash of the current tenure.',
    }),
  }),
};
const TenureChangeTransactionMetadataSchema = Type.Object(
  TenureChangeTransactionMetadataProperties,
  {
    title: 'TenureChangeTransaction',
    description: 'Describes representation of a Type 7 Stacks transaction: Tenure Change',
  }
);
export type TenureChangeTransactionMetadata = Static<typeof TenureChangeTransactionMetadataSchema>;

const TokenTransferTransactionSchema = Type.Object(
  {
    ...AbstractTransactionProperties,
    ...TokenTransferTransactionMetadataProperties,
  },
  { title: 'TokenTransferTransaction' }
);

const SmartContractTransactionSchema = Type.Object(
  {
    ...AbstractTransactionProperties,
    ...SmartContractTransactionMetadataProperties,
  },
  { title: 'SmartContractTransaction' }
);
export type SmartContractTransaction = Static<typeof SmartContractTransactionSchema>;

const ContractCallTransactionSchema = Type.Object(
  {
    ...AbstractTransactionProperties,
    ...ContractCallTransactionMetadataProperties,
  },
  { title: 'ContractCallTransaction' }
);
export type ContractCallTransaction = Static<typeof ContractCallTransactionSchema>;

const PoisonMicroblockTransactionSchema = Type.Object(
  {
    ...AbstractTransactionProperties,
    ...PoisonMicroblockTransactionMetadataProperties,
  },
  { title: 'PoisonMicroblockTransaction' }
);

const CoinbaseTransactionSchema = Type.Object(
  {
    ...AbstractTransactionProperties,
    ...CoinbaseTransactionMetadataProperties,
  },
  { title: 'CoinbaseTransaction' }
);
export type CoinbaseTransaction = Static<typeof CoinbaseTransactionSchema>;

const TenureChangeTransactionSchema = Type.Object(
  {
    ...AbstractTransactionProperties,
    ...TenureChangeTransactionMetadataProperties,
  },
  { title: 'TenureChangeTransaction' }
);
type TenureChangeTransaction = Static<typeof TenureChangeTransactionSchema>;

const TransactionMetadataSchema = Type.Union([
  TokenTransferTransactionMetadataSchema,
  SmartContractTransactionMetadataSchema,
  ContractCallTransactionMetadataSchema,
  PoisonMicroblockTransactionMetadataSchema,
  CoinbaseTransactionMetadataSchema,
  TenureChangeTransactionMetadataSchema,
]);
export type TransactionMetadata = Static<typeof TransactionMetadataSchema>;

export const TransactionSchema = Type.Union([
  TokenTransferTransactionSchema,
  SmartContractTransactionSchema,
  ContractCallTransactionSchema,
  PoisonMicroblockTransactionSchema,
  CoinbaseTransactionSchema,
  TenureChangeTransactionSchema,
]);
export type Transaction = Static<typeof TransactionSchema>;

export const AbstractMempoolTransactionProperties = {
  ...BaseTransactionSchemaProperties,
  tx_status: Type.Union(
    [
      Type.Literal('pending'),
      Type.Literal('dropped_replace_by_fee'),
      Type.Literal('dropped_replace_across_fork'),
      Type.Literal('dropped_too_expensive'),
      Type.Literal('dropped_stale_garbage_collect'),
      Type.Literal('dropped_problematic'),
    ],
    {
      description: 'Status of the transaction',
    }
  ),
  replaced_by_tx_id: Nullable(
    Type.String({
      description: 'ID of another transaction which replaced this one',
    })
  ),
  receipt_time: Type.Integer({
    description:
      'A unix timestamp (in seconds) indicating when the transaction broadcast was received by the node.',
  }),
  receipt_time_iso: Type.String({
    description:
      'An ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ) timestamp indicating when the transaction broadcast was received by the node.',
  }),
};

const AbstractMempoolTransactionSchema = Type.Object({
  ...AbstractMempoolTransactionProperties,
});
export type AbstractMempoolTransaction = Static<typeof AbstractMempoolTransactionSchema>;

const TokenTransferMempoolTransactionSchema = Type.Object(
  {
    ...AbstractMempoolTransactionProperties,
    ...TokenTransferTransactionMetadataProperties,
  },
  { title: 'TokenTransferMempoolTransaction' }
);

const SmartContractMempoolTransactionSchema = Type.Object(
  {
    ...AbstractMempoolTransactionProperties,
    ...SmartContractTransactionMetadataProperties,
  },
  { title: 'SmartContractMempoolTransaction' }
);

const ContractCallMempoolTransactionSchema = Type.Object(
  {
    ...AbstractMempoolTransactionProperties,
    ...ContractCallTransactionMetadataProperties,
  },
  { title: 'ContractCallMempoolTransaction' }
);

const PoisonMicroblockMempoolTransactionSchema = Type.Object(
  {
    ...AbstractMempoolTransactionProperties,
    ...PoisonMicroblockTransactionMetadataProperties,
  },
  { title: 'PoisonMicroblockMempoolTransaction' }
);

const CoinbaseMempoolTransactionSchema = Type.Object(
  {
    ...AbstractMempoolTransactionProperties,
    ...CoinbaseTransactionMetadataProperties,
  },
  { title: 'CoinbaseMempoolTransaction' }
);

const TenureChangeMempoolTransactionSchema = Type.Object(
  {
    ...AbstractMempoolTransactionProperties,
    ...TenureChangeTransactionMetadataProperties,
  },
  { title: 'TenureChangeMempoolTransaction' }
);

export const MempoolTransactionSchema = Type.Union([
  TokenTransferMempoolTransactionSchema,
  SmartContractMempoolTransactionSchema,
  ContractCallMempoolTransactionSchema,
  PoisonMicroblockMempoolTransactionSchema,
  CoinbaseMempoolTransactionSchema,
  TenureChangeMempoolTransactionSchema,
]);
export type MempoolTransaction = Static<typeof MempoolTransactionSchema>;

const TransactionFoundSchema = Type.Object(
  {
    found: Type.Literal(true),
    result: Type.Union([TransactionSchema, MempoolTransactionSchema]),
  },
  {
    title: 'TransactionFound',
    description: 'This object returns transaction for found true',
  }
);
export type TransactionFound = Static<typeof TransactionFoundSchema>;

const TransactionNotFoundSchema = Type.Object(
  {
    found: Type.Literal(false),
    result: Type.Object({
      tx_id: Type.String(),
    }),
  },
  {
    title: 'TransactionNotFound',
    description: 'This object returns the id for not found transaction',
  }
);
export type TransactionNotFound = Static<typeof TransactionNotFoundSchema>;

const TransactionSearchResultSchema = Type.Union([
  TransactionFoundSchema,
  TransactionNotFoundSchema,
]);

export const TransactionSearchResponseSchema = Type.Record(
  Type.String(),
  TransactionSearchResultSchema
);
export type TransactionSearchResponse = Static<typeof TransactionSearchResponseSchema>;
