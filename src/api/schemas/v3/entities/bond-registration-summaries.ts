import { Static, Type } from '@sinclair/typebox';
import { AmountSchema } from './common.js';

export const BondRegistrationTypeSchema = Type.Union([Type.Literal('l1'), Type.Literal('l2')]);
export type BondRegistrationType = Static<typeof BondRegistrationTypeSchema>;

/**
 * A bond registration without the full list of L1 lockup transactions. Used by
 * the bond registrations list endpoint; the proven L1 outputs are available on
 * the per-principal registration endpoint.
 */
export const BondRegistrationSummarySchema = Type.Object({
  staker: Type.String(),
  signer: Type.String(),
  type: BondRegistrationTypeSchema,
  balances: Type.Object({
    btc: AmountSchema,
    stx: AmountSchema,
  }),
});
export type BondRegistrationSummary = Static<typeof BondRegistrationSummarySchema>;
