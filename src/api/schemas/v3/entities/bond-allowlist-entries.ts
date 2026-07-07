import { Static, Type } from '@sinclair/typebox';

export const BondAllowlistSchema = Type.Object({
  staker: Type.String(),
  max_sats: Type.String(),
});
export type BondAllowlist = Static<typeof BondAllowlistSchema>;
