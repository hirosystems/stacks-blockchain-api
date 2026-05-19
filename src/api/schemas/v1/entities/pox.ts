import { Static, Type } from '@sinclair/typebox';

export const PoolDelegationSchema = Type.Object({
  stacker: Type.String({
    description: 'The principal of the pool member that issued the delegation',
  }),
  pox_addr: Type.Optional(
    Type.String({
      description: 'The pox-addr value specified by the stacker in the delegation operation',
    })
  ),
  amount_ustx: Type.String({
    description: 'The amount of uSTX delegated by the stacker',
  }),
  burn_block_unlock_height: Type.Optional(
    Type.Integer({
      description: 'The optional burnchain block unlock height that the stacker may have specified',
    })
  ),
  block_height: Type.Integer({
    description: 'The block height at which the stacker delegation transaction was mined at',
  }),
  tx_id: Type.String({
    description: 'The tx_id of the stacker delegation operation',
  }),
});
export type PoolDelegation = Static<typeof PoolDelegationSchema>;

export const PoxCycleSchema = Type.Object({
  block_height: Type.Integer(),
  index_block_hash: Type.String(),
  cycle_number: Type.Integer(),
  total_weight: Type.Integer(),
  total_stacked_amount: Type.String(),
  total_signers: Type.Integer(),
});
export type PoxCycle = Static<typeof PoxCycleSchema>;

export const PoxSignerSchema = Type.Object({
  signing_key: Type.String(),
  signer_address: Type.String({ description: 'The Stacks address derived from the signing_key.' }),
  weight: Type.Integer(),
  stacked_amount: Type.String(),
  weight_percent: Type.Number(),
  stacked_amount_percent: Type.Number(),
  solo_stacker_count: Type.Integer({
    description: 'The number of solo stackers associated with this signer.',
  }),
  pooled_stacker_count: Type.Integer({
    description: 'The number of pooled stackers associated with this signer.',
  }),
});
export type PoxSigner = Static<typeof PoxSignerSchema>;

export const PoxStackerSchema = Type.Object({
  stacker_address: Type.String(),
  stacked_amount: Type.String(),
  pox_address: Type.String(),
  stacker_type: Type.Enum({ solo: 'solo', pooled: 'pooled' }),
});
export type PoxStacker = Static<typeof PoxStackerSchema>;
