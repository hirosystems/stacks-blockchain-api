import { Static, Type } from '@sinclair/typebox';
import { AmountSchema, AssetIdentifierSchema } from './common.js';

export const FtSupplySchema = Type.Object(
  {
    asset_identifier: AssetIdentifierSchema,
    total: Type.String({
      ...AmountSchema,
      description:
        "Total supply of the token, as a string-quoted integer in the token's own base units.",
      examples: ['5817609278457'],
    }),
  },
  { title: 'FtSupply' }
);
export type FtSupply = Static<typeof FtSupplySchema>;
