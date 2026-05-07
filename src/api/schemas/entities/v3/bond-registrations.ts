import { Static, Type } from '@sinclair/typebox';

export const BondRegistrationSchema = Type.Object({
  bond_index: Type.Integer(),
  pox_address: Type.Optional(
    Type.String({
      description:
        'Where they want to receive BTC rewards. If this is none, rewards are received as sBTC.',
    })
  ),
  signer_manager: Type.String(),
  btc_lockup: Type.Union([
    Type.Object({
      type: Type.Literal('outputs'),
      outputs: Type.Object({
        amount: Type.String(),
        tx_id: Type.String(),
        output_index: Type.Integer(),
      }),
      unlock_bytes: Type.String(),
    }),
    Type.Object({
      type: Type.Literal('sbtc'),
      amount: Type.String(),
    }),
  ]),
  signer_calldata: Type.Optional(Type.String()),
});
export type BondRegistration = Static<typeof BondRegistrationSchema>;
