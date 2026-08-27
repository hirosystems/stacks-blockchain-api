import { Static, Type } from '@sinclair/typebox';
import {
  AmountSchema,
  BlockPositionSchema,
  PrincipalSchema,
  TransactionPositionSchema,
} from './common.js';
import { Nullable } from '../../v1/util.js';

export const PrincipalFtTransferSchema = Type.Object(
  {
    sender: Nullable(PrincipalSchema),
    recipient: Nullable(PrincipalSchema),
    amount: Type.String({
      ...AmountSchema,
      description: "Transfer amount, in the token's own base units",
    }),
    transaction: TransactionPositionSchema,
    block: BlockPositionSchema,
  },
  { title: 'PrincipalFtTransfer' }
);
export type PrincipalFtTransfer = Static<typeof PrincipalFtTransferSchema>;
