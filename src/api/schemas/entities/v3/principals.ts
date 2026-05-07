import { Static, Type } from '@sinclair/typebox';
import { Nullable } from '../../util.js';

export const PrincipalStxBalanceSchema = Type.Object({
  liquid_balance: Type.String(),
  locked_balance: Type.String(),
  total_balance: Type.String(),
  lock: Nullable(
    Type.Object({
      tx_id: Type.String(),
      height: Type.Integer(),
      bitcoin_height: Type.Integer(),
      bitcoin_unlock_height: Type.Integer(),
    })
  ),
  mempool: Type.Optional(
    Type.Object({
      inbound: Type.String(),
      outbound: Type.String(),
      pending_liquid_balance: Type.String(),
    })
  ),
});
export type PrincipalStxBalance = Static<typeof PrincipalStxBalanceSchema>;
