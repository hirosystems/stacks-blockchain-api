import { Static, Type } from '@sinclair/typebox';
import { Nullable } from '../../v1/util.js';
import { AmountSchema, BondIndexSchema, PrincipalSchema, TransactionIdSchema } from './common.js';

/** A live `grant-signer-key` authorization held by a signer manager. */
export const SignerKeyGrantSchema = Type.Object(
  {
    signer_key: Type.String({
      description: 'The granted signing key, as a `0x`-prefixed hex string',
    }),
    auth_id: Type.String({
      description: "The grant's auth id as a decimal string",
    }),
    tx_id: TransactionIdSchema,
  },
  { title: 'SignerKeyGrant' }
);
export type SignerKeyGrant = Static<typeof SignerKeyGrantSchema>;

/** A signer manager contract whose registered key is effective for the cycle. */
export const CycleSignerManagerSchema = Type.Object(
  {
    signer_manager: PrincipalSchema,
    registered_at: Type.Object(
      {
        block_height: Type.Integer({
          description: 'Stacks block height of the `register-signer` event',
        }),
        bitcoin_block_height: Type.Integer({
          description: 'Bitcoin block height of the `register-signer` event',
        }),
        tx_id: TransactionIdSchema,
      },
      {
        description:
          'The position of the `register-signer` event that bound this key to the manager.',
      }
    ),
    granted_keys: Type.Array(SignerKeyGrantSchema, {
      description:
        "The manager's live `grant-signer-key` authorizations (granted and not revoked). A grant authorizes a future `register-signer` for that key but does not rotate the key by itself.",
    }),
    grant_active: Type.Boolean({
      description:
        'Whether a live `grant-signer-key` authorization currently exists for the registered key.',
    }),
    pending_key_update: Nullable(
      Type.Object(
        {
          signer_key: Type.String({
            description: 'The newly registered signing key, as a `0x`-prefixed hex string',
          }),
          effective_cycle: Type.Integer({
            description: 'The PoX cycle in which the new key takes effect',
          }),
          tx_id: TransactionIdSchema,
        },
        {
          description:
            "The manager's latest key registered after this cycle's reward set was calculated, when it differs from the cycle's signing key. Takes effect next cycle.",
        }
      )
    ),
  },
  { title: 'CycleSignerManager' }
);
export type CycleSignerManager = Static<typeof CycleSignerManagerSchema>;

/** A reward-set signer for a PoX cycle, with its effective signer manager bindings. */
export const CycleSignerSchema = Type.Object(
  {
    signing_key: Type.String({
      description: "The signing key in the cycle's reward set, as a `0x`-prefixed hex string",
      examples: ['0x038e3c4529395611be9abf6fa3b6987e81d402385e3d605a073f42f407565a4a3d'],
    }),
    weight: Type.Object(
      {
        amount: Type.Integer(),
        percent: Type.Number({
          description: "Percentage of the cycle's total signer weight",
        }),
      },
      { description: "The signer's voting weight in the cycle" }
    ),
    staked_stx: Type.Object(
      {
        amount: Type.String(),
        percent: Type.Number({
          description: "Percentage of the cycle's total staked STX",
        }),
      },
      { description: 'The uSTX staked behind this signer in the cycle' }
    ),
    signer_managers: Type.Array(CycleSignerManagerSchema, {
      description:
        "The signer manager contracts whose registered signing key (via `register-signer`) was this key when the cycle's reward set was calculated.",
    }),
  },
  { title: 'CycleSigner' }
);
export type CycleSigner = Static<typeof CycleSignerSchema>;

/** Where a PoX cycle stands relative to the current Bitcoin tip. */
export const StakingCycleStatusSchema = Type.Union(
  [
    Type.Literal('upcoming'),
    Type.Literal('reward_phase'),
    Type.Literal('prepare_phase'),
    Type.Literal('finished'),
  ],
  {
    description: 'Where the cycle stands relative to the current Bitcoin tip.',
  }
);
export type StakingCycleStatus = Static<typeof StakingCycleStatusSchema>;

/** A point on a cycle's timeline. */
export const CycleSchedulePointSchema = Type.Object({
  bitcoin_height: Type.Integer({ description: 'The Bitcoin height of this point' }),
});

/** A per-cycle summary of pox-5 staking: what is locked, who participates, and the rewards. */
export const StakingCycleSchema = Type.Object(
  {
    number: Type.Integer({ description: 'The PoX reward cycle number', examples: [143] }),
    status: StakingCycleStatusSchema,
    schedule: Type.Object(
      {
        start: CycleSchedulePointSchema,
        prepare_phase_start: CycleSchedulePointSchema,
        end: CycleSchedulePointSchema,
      },
      {
        description:
          'The Bitcoin heights delimiting the cycle, inclusive: its first block, the first block ' +
          'of its prepare phase, and its last block.',
      }
    ),
    locked: Type.Object(
      {
        stx: Type.Object({
          stx_only: Type.String({
            ...AmountSchema,
            description:
              'STX locked in STX-only staking that counts for this cycle, in µSTX. A stake made ' +
              'during a cycle takes effect from the next one, so an in-progress cycle only counts ' +
              'locks that began before it (and, once its first reward calculation has run, the ' +
              "pox-5 contract's own figure for the cycle). Finished cycles use the contract's " +
              'figure; an upcoming cycle counts every live lock that outlasts its start.',
          }),
          bonds: Type.String({
            ...AmountSchema,
            description:
              'STX locked across the bonds covering this cycle, in µSTX. When the cycle has a ' +
              "reward set this is the reward set's total staked STX minus the STX-only figure; " +
              'otherwise the running locked totals of the bonds covering the cycle.',
          }),
          total: Type.String({
            ...AmountSchema,
            description: 'Sum of `stx_only` and `bonds`, in µSTX.',
          }),
        }),
        btc: Type.Object({
          total: Type.String({
            ...AmountSchema,
            description:
              'Sum of `stx_only` and `bonds`, in µSTX. For a cycle with a reward set this is ' +
              "the node's total staked STX for the cycle, fixed when the set was selected.",
          }),
          native: Type.String({
            ...AmountSchema,
            description: 'Of `total`, the satoshis locked through proven Bitcoin L1 lockups.',
          }),
          sbtc: Type.String({
            ...AmountSchema,
            description: 'Of `total`, the satoshis locked through sBTC lockups.',
          }),
        }),
      },
      { description: 'The assets locked by staking for this cycle' }
    ),
    participants: Type.Object(
      {
        stakers: Type.Object({
          stx_only: Type.Integer({
            description:
              'Principals with an STX-only stake that counts for this cycle (stakes made during ' +
              'a cycle count from the next one). For a finished cycle, the principals credited ' +
              'STX-staking rewards for it.',
          }),
          bonds: Type.Integer({
            description:
              'Principals holding a position in a bond covering this cycle, as of the current ' +
              'tip (positions rolled over into another bond or stake are excluded).',
          }),
        }),
        signers: Nullable(
          Type.Integer({
            description:
              "Signers in the cycle's reward set. `null` until the node has emitted the reward " +
              "set, which happens during the previous cycle's prepare phase.",
          })
        ),
      },
      { description: 'Who participates in the cycle' }
    ),
    bonds: Type.Object(
      {
        total: Type.Integer({ description: 'Bonds whose term covers this cycle' }),
        indexes: Type.Array(BondIndexSchema, { description: 'Their bond indexes, ascending' }),
      },
      { description: 'The pox-5 bonds active during this cycle' }
    ),
    rewards: Type.Object(
      {
        btc: Type.Object({
          total: Type.String({
            ...AmountSchema,
            description:
              'sBTC rewards booked to this cycle by the pox-5 reward distributions run so far, in ' +
              'satoshis. Distributions run periodically within a cycle, so this grows while the ' +
              'cycle is active; it equals the sum of the `waterfall` entries.',
          }),
          waterfall: Type.Object(
            {
              bonds: Type.String({
                ...AmountSchema,
                description: 'The share paid to bond participants, in satoshis.',
              }),
              stx_only: Type.String({
                ...AmountSchema,
                description: 'The share paid to STX-only stakers, in satoshis.',
              }),
              reserve_deposit: Type.String({
                ...AmountSchema,
                description: 'The share deposited into the protocol reserve, in satoshis.',
              }),
            },
            { description: 'How the accrued rewards were split, in payout order' }
          ),
          claimed: Type.String({
            ...AmountSchema,
            description:
              'sBTC claimed from the pox-5 contract by signer managers for this cycle so far, in ' +
              'satoshis. Claims trail distributions and can keep growing after the cycle ends.',
          }),
        }),
      },
      { description: 'The rewards generated by this cycle' }
    ),
  },
  { title: 'StakingCycle' }
);
export type StakingCycle = Static<typeof StakingCycleSchema>;
