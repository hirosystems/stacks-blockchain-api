import { Static, Type } from '@sinclair/typebox';
import { Nullable } from '../../v1/util.js';
import { TransactionIdSchema } from './common.js';

export const StxLockSchema = Type.Object(
  {
    amount: Type.String({ description: 'The amount of locked micro-STX' }),
    pox_version: Type.Integer({
      description: 'The PoX contract version that created the lock (e.g. 4, 5)',
    }),
    lock_tx_id: TransactionIdSchema,
    stacks_lock_height: Type.Integer({
      description: 'The Stacks block height at which the lock was created',
    }),
    burn_lock_height: Type.Integer({
      description: 'The burnchain block height at which the lock was created',
    }),
    burn_unlock_height: Type.Integer({
      description: 'The burnchain block height at which the locked STX unlocks',
    }),
  },
  { title: 'StxLock' }
);
export type StxLock = Static<typeof StxLockSchema>;

export const StxMempoolBalanceSchema = Type.Object(
  {
    estimated_balance: Type.String({
      description: 'Estimated spendable micro-STX balance once pending mempool txs confirm',
    }),
    inbound: Type.String({ description: 'Pending inbound micro-STX from the mempool' }),
    outbound: Type.String({
      description: 'Pending outbound micro-STX from the mempool (transfers plus fees)',
    }),
  },
  { title: 'StxMempoolBalance' }
);
export type StxMempoolBalance = Static<typeof StxMempoolBalanceSchema>;

export const PrincipalStxBalanceSchema = Type.Object(
  {
    balance: Type.String({ description: 'Total micro-STX balance (available plus locked)' }),
    available: Type.String({
      description: 'Spendable micro-STX balance (balance minus locked)',
    }),
    locked: Nullable(StxLockSchema),
    mempool: Nullable(StxMempoolBalanceSchema),
  },
  { title: 'PrincipalStxBalance' }
);
export type PrincipalStxBalance = Static<typeof PrincipalStxBalanceSchema>;

export const PrincipalFtPositionSchema = Type.Object(
  {
    asset_identifier: Type.String({
      description: 'Fungible token asset identifier',
      examples: ['SM3VDXK3WZZSA84XXFKAFAF15NNZX32CTSG82JFQ4.sbtc-token::sbtc-token'],
    }),
    balance: Type.String({
      description:
        "The principal's balance of this token, as a string-quoted integer in base units",
    }),
  },
  { title: 'PrincipalFtPosition' }
);
export type PrincipalFtPosition = Static<typeof PrincipalFtPositionSchema>;

export const PrincipalNftPositionSchema = Type.Object(
  {
    asset_identifier: Type.String({
      description: 'Non-fungible token asset identifier',
      examples: ['SP2X0TZ59D5SZ8ACQ6YMCHHNR2ZN51Z32E2CJ173.the-explorer-guild::The-Explorer-Guild'],
    }),
    value: Type.Object(
      {
        hex: Type.String(),
        repr: Type.String(),
      },
      { description: 'The NFT instance identifier, as a Clarity value' }
    ),
  },
  { title: 'PrincipalNftPosition' }
);
export type PrincipalNftPosition = Static<typeof PrincipalNftPositionSchema>;
