import { Static, Type } from '@sinclair/typebox';

export const BurnchainRewardsTotalSchema = Type.Object(
  {
    reward_recipient: Type.String({
      description:
        'The recipient address that received the burnchain rewards, in the format native to the burnchain (e.g. B58 encoded for Bitcoin)',
    }),
    reward_amount: Type.String({
      description:
        'The total amount of burnchain tokens rewarded to the recipient, in the smallest unit (e.g. satoshis for Bitcoin)',
    }),
  },
  { title: 'BurnchainRewardsTotal', description: 'Total burnchain rewards made to a recipient' }
);
export type BurnchainRewardsTotal = Static<typeof BurnchainRewardsTotalSchema>;

export const BurnchainRewardSchema = Type.Object(
  {
    canonical: Type.Boolean({
      description: 'Set to `true` if block corresponds to the canonical burchchain tip',
    }),
    burn_block_hash: Type.String({
      description: 'The hash representing the burnchain block',
    }),
    burn_block_height: Type.Integer({
      description: 'Height of the burnchain block',
    }),
    burn_amount: Type.String({
      description:
        'The total amount of burnchain tokens burned for this burnchain block, in the smallest unit (e.g. satoshis for Bitcoin)',
    }),
    reward_recipient: Type.String({
      description:
        'The recipient address that received the burnchain rewards, in the format native to the burnchain (e.g. B58 encoded for Bitcoin)',
    }),
    reward_amount: Type.String({
      description:
        'The amount of burnchain tokens rewarded to the recipient, in the smallest unit (e.g. satoshis for Bitcoin)',
    }),
    reward_index: Type.Integer({
      description:
        "The index position of the reward entry, useful for ordering when there's more than one recipient per burnchain block",
    }),
  },
  {
    title: 'BurnchainReward',
    description: 'Reward payment made on the burnchain',
  }
);
export type BurnchainReward = Static<typeof BurnchainRewardSchema>;

export const BurnchainRewardSlotHolderSchema = Type.Object(
  {
    canonical: Type.Boolean({
      description: 'Set to `true` if block corresponds to the canonical burchchain tip',
    }),
    burn_block_hash: Type.String({
      description: 'The hash representing the burnchain block',
    }),
    burn_block_height: Type.Integer({
      description: 'Height of the burnchain block',
    }),
    address: Type.String({
      description:
        'The recipient address that validly received PoX commitments, in the format native to the burnchain (e.g. B58 encoded for Bitcoin)',
    }),
    slot_index: Type.Integer({
      description:
        "The index position of the reward entry, useful for ordering when there's more than one slot per burnchain block",
    }),
  },
  { title: 'BurnchainRewardSlotHolder', description: 'Reward slot holder on the burnchain' }
);
export type BurnchainRewardSlotHolder = Static<typeof BurnchainRewardSlotHolderSchema>;
