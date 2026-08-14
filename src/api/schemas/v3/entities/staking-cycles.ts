import { Static, Type } from '@sinclair/typebox';
import { Nullable } from '../../v1/util.js';
import { PrincipalSchema, TransactionIdSchema } from './common.js';

/** A signer manager contract whose key binding is effective for the cycle. */
export const CycleSignerManagerSchema = Type.Object(
  {
    signer_manager: PrincipalSchema,
    auth_id: Nullable(
      Type.String({
        description:
          "The grant's auth id as a decimal string; null when the binding came from `register-signer` instead of `grant-signer-key`.",
      })
    ),
    granted_at: Type.Object(
      {
        block_height: Type.Integer({
          description: 'Stacks block height of the binding event',
        }),
        burn_block_height: Type.Integer({
          description: 'Burn block height of the binding event',
        }),
        tx_id: TransactionIdSchema,
      },
      { description: 'The position of the event that bound this key to the manager.' }
    ),
    pending_key_update: Nullable(
      Type.Object(
        {
          signer_key: Type.String({
            description: 'The newly bound signing key, as a `0x`-prefixed hex string',
          }),
          effective_cycle: Type.Integer({
            description: 'The PoX cycle in which the new key takes effect',
          }),
          tx_id: TransactionIdSchema,
        },
        {
          description:
            "The manager's latest key binding made after this cycle's reward set was calculated, when it differs from the cycle's signing key. Takes effect next cycle.",
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
        "The signer manager contracts whose key bindings for this signing key were effective when the cycle's reward set was calculated.",
    }),
  },
  { title: 'CycleSigner' }
);
export type CycleSigner = Static<typeof CycleSignerSchema>;
