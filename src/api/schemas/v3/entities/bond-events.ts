import { Static, TSchema, Type } from '@sinclair/typebox';
import {
  AmountSchema,
  BitcoinBlockPositionSchema,
  BlockPositionSchema,
  BondIndexSchema,
  TransactionPositionSchema,
} from './common.js';
import { BondParametersSchema, BondScheduleSchema } from './bonds.js';
import { BondAllowlistSchema } from './bond-allowlist-entries.js';
import { BondRegistrationSummarySchema } from './bond-registration-summaries.js';

/**
 * Bond event payloads are curated into the same vocabulary as the bond, allowlist, and registration
 * entities (grouped `{ btc, stx }` amounts as strings, integer heights and cycles) rather than
 * passing the raw synthetic event fields through. Payloads carry only what the event uniquely
 * records; details that live on a resource endpoint (e.g. a registration's proven L1 lockup
 * outputs) are not repeated here.
 */

const BtcAmount = (description: string) => Type.Object({ btc: AmountSchema }, { description });

/**
 * Common envelope for a bond-scoped pox-5 event: the event name discriminant, the bond it belongs
 * to, its chain position, and the event's payload.
 */
const BondEventBase = <TName extends string, TData extends TSchema>(
  name: TName,
  data: TData,
  title: string
) =>
  Type.Object(
    {
      name: Type.Literal(name),
      bond_index: BondIndexSchema,
      transaction: TransactionPositionSchema,
      block: BlockPositionSchema,
      bitcoin_block: BitcoinBlockPositionSchema,
      data,
    },
    { title }
  );

export const BondSetupEventSchema = BondEventBase(
  'setup-bond',
  Type.Object({
    // The bond's capacity is summed from its allowlist afterwards, so the setup
    // event carries the configured parameters without `btc_capacity`.
    parameters: Type.Omit(BondParametersSchema, ['btc_capacity']),
    early_unlock_bytes: Type.String({
      description:
        'Hex string of the Bitcoin script subscript guarding the early-exit branch of the L1 lockup',
    }),
    schedule: BondScheduleSchema,
  }),
  'BondSetupEvent'
);

export const BondAddToAllowlistEventSchema = BondEventBase(
  'add-to-allowlist',
  BondAllowlistSchema,
  'BondAddToAllowlistEvent'
);

// Registration events carry the same summary shape as the bond registrations list endpoint; the
// registration's full details (proven L1 lockup outputs, unlock schedule) are available on the
// per-principal bond registration endpoint.
export const BondRegisterEventSchema = BondEventBase(
  'register-for-bond',
  BondRegistrationSummarySchema,
  'BondRegisterEvent'
);

export const BondUpdateRegistrationEventSchema = BondEventBase(
  'update-bond-registration',
  Type.Composite([
    BondRegistrationSummarySchema,
    Type.Object({
      // The registration row only keeps the current signer, so the event is the only record of who
      // the staker switched away from.
      old_signer: Type.String({
        description: 'The previous signer of the registration',
      }),
    }),
  ]),
  'BondUpdateRegistrationEvent'
);

export const BondAnnounceL1EarlyExitEventSchema = BondEventBase(
  'announce-l1-early-exit',
  Type.Object({
    staker: Type.String({ description: 'The staker exiting the bond early' }),
    signer: Type.String({ description: 'The signer the staker was staked under' }),
    released: BtcAmount('The sats released by the early exit'),
  }),
  'BondAnnounceL1EarlyExitEvent'
);

export const BondUnstakeSbtcEventSchema = BondEventBase(
  'unstake-sbtc',
  Type.Object({
    staker: Type.String({ description: 'The staker withdrawing sBTC from the bond' }),
    signer: Type.String({ description: 'The signer the staker was staked under' }),
    withdrawn: BtcAmount('The sats withdrawn'),
    remaining: BtcAmount(
      'The sBTC shares remaining after the withdrawal; 0 indicates a full early exit'
    ),
  }),
  'BondUnstakeSbtcEvent'
);

export const BondDistributionEventSchema = BondEventBase(
  'bond-distribution',
  Type.Object({
    target_yield: Type.String({
      pattern: '^[0-9]+$',
      description: "The bond's target reward for this calculation, in sats",
    }),
    rewards: BtcAmount('The rewards earned by this bond this calculation'),
    staked: BtcAmount('The sats staked in the bond at calculation time'),
    accrued_rewards_per_sat: Type.String({
      pattern: '^[0-9]+$',
      description: 'The per-sat rewards accrued this calculation, as a 1e18 fixed-point integer',
    }),
    cumulative_rewards_per_sat: Type.String({
      pattern: '^[0-9]+$',
      description:
        'The running per-sat reward total for the bond after this calculation, as a 1e18 ' +
        'fixed-point integer',
    }),
  }),
  'BondDistributionEvent'
);

export const BondClaimStakerRewardsEventSchema = BondEventBase(
  'claim-staker-rewards-for-signer',
  Type.Object({
    signer_manager: Type.String({
      description: 'The signer manager that claimed on behalf of the staker',
    }),
    staker: Type.String({ description: 'The staker the rewards were claimed for' }),
    reward_cycle: Type.Integer({ description: 'The PoX reward cycle claimed' }),
    claimed: BtcAmount('The sats claimed'),
  }),
  'BondClaimStakerRewardsEvent'
);

export const BondEventSchema = Type.Union(
  [
    BondSetupEventSchema,
    BondAddToAllowlistEventSchema,
    BondRegisterEventSchema,
    BondUpdateRegistrationEventSchema,
    BondAnnounceL1EarlyExitEventSchema,
    BondUnstakeSbtcEventSchema,
    BondDistributionEventSchema,
    BondClaimStakerRewardsEventSchema,
  ],
  { title: 'BondEvent' }
);
export type BondEvent = Static<typeof BondEventSchema>;
