import { Static, Type } from '@sinclair/typebox';
import { TransactionSchema } from './transactions';
import { TransactionEventAssetTypeSchema } from './transaction-events';
import { Nullable } from '../util';
import { FtBalanceSchema, NftBalanceSchema, StxBalanceSchema } from './balances';

export const AddressNoncesSchema = Type.Object(
  {
    last_mempool_tx_nonce: Nullable(
      Type.Integer({
        description:
          'The latest nonce found within mempool transactions sent by this address. Will be null if there are no current mempool transactions for this address.',
      })
    ),
    last_executed_tx_nonce: Nullable(
      Type.Integer({
        description:
          'The latest nonce found within transactions sent by this address, including unanchored microblock transactions. Will be null if there are no current transactions for this address.',
      })
    ),
    possible_next_nonce: Type.Integer({
      description:
        "The likely nonce required for creating the next transaction, based on the last nonces seen by the API. This can be incorrect if the API's mempool or transactions aren't fully synchronized, even by a small amount, or if a previous transaction is still propagating through the Stacks blockchain network when this endpoint is called.",
    }),
    detected_missing_nonces: Type.Array(Type.Integer(), {
      description:
        'Nonces that appear to be missing and likely causing a mempool transaction to be stuck.',
    }),
    detected_mempool_nonces: Type.Array(Type.Integer(), {
      description: 'Nonces currently in mempool for this address.',
    }),
  },
  {
    title: 'AddressNonces',
    description:
      'The latest nonce values used by an account by inspecting the mempool, microblock transactions, and anchored transactions',
  }
);
export type AddressNonces = Static<typeof AddressNoncesSchema>;

const AddressUnlockScheduleSchema = Type.Object(
  {
    amount: Type.String({
      description: 'Micro-STX amount locked at this block height.',
    }),
    block_height: Type.Integer(),
  },
  { title: 'AddressUnlockSchedule', description: 'Unlock schedule amount and block height' }
);

const AddressTokenOfferingLockedSchema = Type.Object(
  {
    total_locked: Type.String({
      description: 'Micro-STX amount still locked at current block height.',
    }),
    total_unlocked: Type.String({
      description: 'Micro-STX amount unlocked at current block height.',
    }),
    unlock_schedule: Type.Array(AddressUnlockScheduleSchema),
  },
  { title: 'AddressTokenOfferingLocked', description: 'Token Offering Locked' }
);
export type AddressTokenOfferingLocked = Static<typeof AddressTokenOfferingLockedSchema>;

export const AddressTransactionSchema = Type.Object(
  {
    tx: TransactionSchema,
    stx_sent: Type.String({
      description:
        'Total sent from the given address, including the tx fee, in micro-STX as an integer string.',
    }),
    stx_received: Type.String({
      description: 'Total received by the given address in micro-STX as an integer string.',
    }),
    events: Type.Object({
      stx: Type.Object({
        transfer: Type.Integer(),
        mint: Type.Integer(),
        burn: Type.Integer(),
      }),
      ft: Type.Object({
        transfer: Type.Integer(),
        mint: Type.Integer(),
        burn: Type.Integer(),
      }),
      nft: Type.Object({
        transfer: Type.Integer(),
        mint: Type.Integer(),
        burn: Type.Integer(),
      }),
    }),
  },
  {
    title: 'AddressTransaction',
    description: 'Address transaction with STX, FT and NFT transfer summaries',
  }
);
export type AddressTransaction = Static<typeof AddressTransactionSchema>;

export const AddressTransactionWithTransfersSchema = Type.Object(
  {
    tx: TransactionSchema,
    stx_sent: Type.String({
      description:
        'Total sent from the given address, including the tx fee, in micro-STX as an integer string.',
    }),
    stx_received: Type.String({
      description: 'Total received by the given address in micro-STX as an integer string.',
    }),
    stx_transfers: Type.Array(
      Type.Object({
        amount: Type.String({
          description: 'Amount transferred in micro-STX as an integer string.',
        }),
        sender: Type.Optional(
          Type.String({
            description: 'Principal that sent STX. This is unspecified if the STX were minted.',
          })
        ),
        recipient: Type.Optional(
          Type.String({
            description: 'Principal that received STX. This is unspecified if the STX were burned.',
          })
        ),
      })
    ),
    ft_transfers: Type.Optional(
      Type.Array(
        Type.Object({
          amount: Type.String({
            description:
              'Amount transferred as an integer string. This balance does not factor in possible SIP-010 decimals.',
          }),
          asset_identifier: Type.String({
            description: 'Fungible Token asset identifier.',
          }),
          sender: Type.Optional(
            Type.String({
              description: 'Principal that sent the asset.',
            })
          ),
          recipient: Type.Optional(
            Type.String({
              description: 'Principal that received the asset.',
            })
          ),
        })
      )
    ),
    nft_transfers: Type.Optional(
      Type.Array(
        Type.Object({
          value: Type.Object(
            {
              hex: Type.String(),
              repr: Type.String(),
            },
            { description: 'Non Fungible Token asset value.' }
          ),
          asset_identifier: Type.String({
            description: 'Non Fungible Token asset identifier.',
          }),
          sender: Type.Optional(
            Type.String({
              description: 'Principal that sent the asset.',
            })
          ),
          recipient: Type.Optional(
            Type.String({
              description: 'Principal that received the asset.',
            })
          ),
        })
      )
    ),
  },
  {
    title: 'AddressTransactionWithTransfers',
    description: 'Transaction with STX transfers for a given address',
  }
);
export type AddressTransactionWithTransfers = Static<typeof AddressTransactionWithTransfersSchema>;

export const AddressTransactionEventSchema = Type.Union(
  [
    Type.Object({
      type: Type.Literal('stx'),
      event_index: Type.Integer(),
      data: Type.Object({
        type: TransactionEventAssetTypeSchema,
        amount: Type.String({
          description: 'Amount transferred in micro-STX as an integer string.',
        }),
        sender: Type.Optional(
          Type.String({
            description: 'Principal that sent STX. This is unspecified if the STX were minted.',
          })
        ),
        recipient: Type.Optional(
          Type.String({
            description: 'Principal that received STX. This is unspecified if the STX were burned.',
          })
        ),
      }),
    }),
    Type.Object({
      type: Type.Literal('ft'),
      event_index: Type.Integer(),
      data: Type.Object({
        type: TransactionEventAssetTypeSchema,
        amount: Type.String({
          description:
            'Amount transferred as an integer string. This balance does not factor in possible SIP-010 decimals.',
        }),
        asset_identifier: Type.String({
          description: 'Fungible Token asset identifier.',
        }),
        sender: Type.Optional(
          Type.String({
            description: 'Principal that sent the asset.',
          })
        ),
        recipient: Type.Optional(
          Type.String({
            description: 'Principal that received the asset.',
          })
        ),
      }),
    }),
    Type.Object({
      type: Type.Literal('nft'),
      event_index: Type.Integer(),
      data: Type.Object({
        type: TransactionEventAssetTypeSchema,
        asset_identifier: Type.String({
          description: 'Non Fungible Token asset identifier.',
        }),
        value: Type.Object({
          hex: Type.String(),
          repr: Type.String(),
        }),
        sender: Type.Optional(
          Type.String({
            description: 'Principal that sent the asset.',
          })
        ),
        recipient: Type.Optional(
          Type.String({
            description: 'Principal that received the asset.',
          })
        ),
      }),
    }),
  ],
  { title: 'AddressTransactionEvent', description: 'Address Transaction Event' }
);
export type AddressTransactionEvent = Static<typeof AddressTransactionEventSchema>;

export const AddressBalanceSchema = Type.Object(
  {
    stx: StxBalanceSchema,
    fungible_tokens: Type.Record(Type.String(), FtBalanceSchema),
    non_fungible_tokens: Type.Record(Type.String(), NftBalanceSchema),
    token_offering_locked: Type.Optional(AddressTokenOfferingLockedSchema),
  },
  { title: 'AddressBalanceResponse', description: 'GET request that returns address balances' }
);
export type AddressBalance = Static<typeof AddressBalanceSchema>;

enum InboundStxTransferType {
  bulkSend = 'bulk-send',
  stxTransfer = 'stx-transfer',
  stxTransferMemo = 'stx-transfer-memo',
}

export const InboundStxTransferSchema = Type.Object(
  {
    sender: Type.String({
      description: 'Principal that sent this transfer',
    }),
    amount: Type.String({
      description: 'Transfer amount in micro-STX as integer string',
    }),
    memo: Type.String({
      description: 'Hex encoded memo bytes associated with the transfer',
    }),
    block_height: Type.Integer({
      description: 'Block height at which this transfer occurred',
    }),
    tx_id: Type.String({
      description: 'The transaction ID in which this transfer occurred',
    }),
    transfer_type: Type.Enum(InboundStxTransferType, {
      description:
        'Indicates if the transfer is from a stx-transfer transaction or a contract-call transaction',
    }),
    tx_index: Type.Integer({
      description: 'Index of the transaction within a block',
    }),
  },
  { title: 'InboundStxTransfer' }
);
export type InboundStxTransfer = Static<typeof InboundStxTransferSchema>;

export const AddressStxBalanceSchema = Type.Intersect(
  [
    StxBalanceSchema,
    Type.Object({
      token_offering_locked: Type.Optional(AddressTokenOfferingLockedSchema),
    }),
  ],
  {
    title: 'AddressStxBalance',
    description: 'GET request that returns address balances',
  }
);
export type AddressStxBalance = Static<typeof AddressStxBalanceSchema>;
