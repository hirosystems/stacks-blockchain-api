import { Static, Type } from '@sinclair/typebox';

export const FtBalanceSchema = Type.Object(
  {
    balance: Type.String(),
    total_sent: Type.String(),
    total_received: Type.String(),
  },
  { title: 'FtBalance' }
);

export const NftBalanceSchema = Type.Object(
  {
    count: Type.String(),
    total_sent: Type.String(),
    total_received: Type.String(),
  },
  { title: 'NftBalance' }
);

export const StxBalanceSchema = Type.Object(
  {
    balance: Type.String(),
    estimated_balance: Type.Optional(
      Type.String({
        description: 'Total STX balance considering pending mempool transactions',
      })
    ),
    pending_balance_inbound: Type.Optional(
      Type.String({
        description: 'Inbound STX balance from pending mempool transactions',
      })
    ),
    pending_balance_outbound: Type.Optional(
      Type.String({
        description: 'Outbound STX balance from pending mempool transactions',
      })
    ),
    total_sent: Type.String(),
    total_received: Type.String(),
    total_fees_sent: Type.String(),
    total_miner_rewards_received: Type.String(),
    lock_tx_id: Type.String({
      description: 'The transaction where the lock event occurred. Empty if no tokens are locked.',
    }),
    locked: Type.String({
      description:
        'The amount of locked STX, as string quoted micro-STX. Zero if no tokens are locked.',
    }),
    lock_height: Type.Integer({
      description:
        'The STX chain block height of when the lock event occurred. Zero if no tokens are locked.',
    }),
    burnchain_lock_height: Type.Integer({
      description:
        'The burnchain block height of when the lock event occurred. Zero if no tokens are locked.',
    }),
    burnchain_unlock_height: Type.Integer({
      description:
        'The burnchain block height of when the tokens unlock. Zero if no tokens are locked.',
    }),
  },
  { title: 'StxBalance' }
);
