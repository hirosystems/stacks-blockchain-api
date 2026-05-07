import { Static, Type } from '@sinclair/typebox';

export const BondSummarySchema = Type.Object({
  tx_id: Type.String(),
  index: Type.Integer(),
  yield_rate: Type.Integer({ description: 'The target yield rate (APY) in basis points' }),
  stx_value_ratio: Type.Integer({
    description:
      'This is a representation of the STXBTC price. The value represents "uSTX per 100 sats"',
  }),
  minimum_stx_ratio: Type.Integer({
    description:
      'The amount of STX that must be locked relative to BTC, in equal-valued terms (ie in USD terms). This value is represented in basis points.',
  }),
});
export type BondSummary = Static<typeof BondSummarySchema>;

export const BondAllowlistSchema = Type.Object({
  staker: Type.String(),
  max_sats: Type.String(),
});
export type BondAllowlist = Static<typeof BondAllowlistSchema>;

export const BondSchema = Type.Composite([
  BondSummarySchema,
  Type.Object({
    early_unlock_signers: Type.String(),
  }),
]);
export type Bond = Static<typeof BondSchema>;
