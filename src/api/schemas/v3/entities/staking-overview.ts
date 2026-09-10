import { Static, Type } from '@sinclair/typebox';
import { AmountSchema } from './common.js';

/** Network-wide pox-5 locked-asset totals, as of the current chain tip. */
export const StakingLockedTotalsSchema = Type.Object(
  {
    stx: Type.Object({
      individual_staked_amount: Type.String({
        ...AmountSchema,
        description:
          'Total STX currently locked in STX-only staking (the `stake` path), as a ' +
          'string-quoted integer of micro-STX (µSTX).',
        examples: ['88231000000000'],
      }),
      bond_staked_amount: Type.String({
        ...AmountSchema,
        description:
          'Total STX currently locked across all bonds, as a string-quoted integer of ' +
          'micro-STX (µSTX).',
        examples: ['3570465300381'],
      }),
      total_amount: Type.String({
        ...AmountSchema,
        description:
          'Sum of `individual_staked_amount` and `bond_staked_amount`: all STX currently ' +
          'locked by staking, as a string-quoted integer of micro-STX (µSTX).',
        examples: ['91801465300381'],
      }),
    }),
    btc: Type.Object({
      bond_staked_amount: Type.String({
        ...AmountSchema,
        description:
          'Total BTC currently locked across all bonds, in satoshis, covering both ' +
          'proven Bitcoin L1 lockups and sBTC lockups.',
        examples: ['23017662628'],
      }),
    }),
  },
  { title: 'StakingLockedTotals' }
);
export type StakingLockedTotals = Static<typeof StakingLockedTotalsSchema>;

/**
 * Network-wide staking overview: the network analogue of a principal's
 * `/principals/:principal/staking` summary. `locked` holds the asset totals currently locked by
 * staking; further overview sections are added as siblings.
 */
export const StakingOverviewSchema = Type.Object(
  {
    locked: StakingLockedTotalsSchema,
  },
  { title: 'StakingOverview' }
);
export type StakingOverview = Static<typeof StakingOverviewSchema>;
