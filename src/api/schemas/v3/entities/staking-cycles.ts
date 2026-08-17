import { Static, Type } from '@sinclair/typebox';
import { Nullable } from '../../v1/util.js';
import { PrincipalSchema, TransactionIdSchema } from './common.js';

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
