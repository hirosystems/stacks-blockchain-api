import { Static, Type } from '@sinclair/typebox';
import { AmountSchema, PrincipalSchema } from './common.js';

export const FtHolderSchema = Type.Object(
  {
    principal: PrincipalSchema,
    balance: Type.String({
      ...AmountSchema,
      description: "The holder's balance, as a string-quoted integer in the token's own base units",
      examples: ['174823763'],
    }),
  },
  { title: 'FtHolder' }
);
export type FtHolder = Static<typeof FtHolderSchema>;
