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
