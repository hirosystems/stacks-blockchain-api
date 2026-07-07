import { Static, Type } from '@sinclair/typebox';
import { BitcoinBlockPositionSchema, BlockPositionSchema, BondIndexSchema } from './common.js';

export const BondStatusSchema = Type.Union([
  Type.Literal('upcoming'),
  Type.Literal('active'),
  Type.Literal('unlocked'),
]);
export type BondStatus = Static<typeof BondStatusSchema>;

export const BondBalancesSchema = Type.Object({
  locked: Type.Object({
    btc: Type.String({
      description: 'The total amount of BTC that is locked up for this bond',
    }),
    stx: Type.String({
      description: 'The total amount of STX that is locked up for this bond',
    }),
  }),
  paid_out: Type.Object({
    btc: Type.String({
      description: 'The total amount of BTC that has been paid out for this bond',
    }),
  }),
});
export type BondBalances = Static<typeof BondBalancesSchema>;

export const BondSummarySchema = Type.Object({
  index: BondIndexSchema,
  pox_version: Type.Literal('pox5'),
  status: BondStatusSchema,
  parameters: Type.Object({
    target_rate_bps: Type.Integer({ description: 'The target yield rate (APY) in basis points' }),
    stx_value_ratio: Type.Integer({
      description:
        'This is a representation of the STXBTC price. The value represents "uSTX per 100 sats"',
    }),
    minimum_stx_ratio: Type.Integer({
      description:
        'The amount of STX that must be locked relative to BTC, in equal-valued terms (ie in USD terms). This value is represented in basis points.',
    }),
    btc_capacity: Type.String({
      description: 'The total capacity of BTC that can be locked up for this bond',
    }),
  }),
  registrations: Type.Object({
    allowed_count: Type.Integer({
      description: 'The number of entries in the allowlist for this bond',
    }),
    registered_count: Type.Integer({
      description: 'The number of registrations for this bond',
    }),
  }),
  schedule: Type.Object({
    activation: Type.Object({
      bitcoin_height: Type.Integer({
        description: 'The height at which the bond was activated',
      }),
      pox_cycle: Type.Integer({
        description: 'The POX cycle at which the bond was activated',
      }),
    }),
    unlock: Type.Object({
      bitcoin_height: Type.Integer({
        description: 'The height at which the bond can be unlocked',
      }),
      pox_cycle: Type.Integer({
        description: 'The POX cycle at which the bond can be unlocked',
      }),
    }),
  }),
  balances: BondBalancesSchema,
});
export type BondSummary = Static<typeof BondSummarySchema>;

export const BondSchema = Type.Composite([
  BondSummarySchema,
  Type.Object({
    transaction: Type.Object({
      tx_id: Type.String({ description: 'The transaction ID that created the bond' }),
      block: BlockPositionSchema,
      bitcoin_block: BitcoinBlockPositionSchema,
    }),
  }),
]);
export type Bond = Static<typeof BondSchema>;
