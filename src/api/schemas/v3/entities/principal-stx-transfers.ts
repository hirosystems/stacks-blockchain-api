import { Static, Type } from '@sinclair/typebox';
import {
  AmountSchema,
  BlockPositionSchema,
  DecodedStxTransferMemoSchema,
  PrincipalSchema,
  TransactionPositionSchema,
} from './common.js';
import { Nullable } from '../../v1/util.js';

export const PrincipalStxTransferSchema = Type.Object(
  {
    sender: Nullable(PrincipalSchema),
    recipient: Nullable(PrincipalSchema),
    amount: AmountSchema,
    memo: Nullable(DecodedStxTransferMemoSchema),
    transaction: TransactionPositionSchema,
    block: BlockPositionSchema,
  },
  { title: 'PrincipalStxTransfer' }
);
export type PrincipalStxTransfer = Static<typeof PrincipalStxTransferSchema>;
