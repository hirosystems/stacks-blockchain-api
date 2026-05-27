import { Static, Type } from '@sinclair/typebox';
import { TransactionIdSchema } from './common.js';

export const BalanceChangeSchema = Type.Object({
  sent: Type.String({
    description: 'Amount sent by the principal',
  }),
  received: Type.String({
    description: 'Amount received by the principal',
  }),
  net: Type.String({
    description: 'Net balance change for the principal',
  }),
});
export type BalanceChange = Static<typeof BalanceChangeSchema>;

export const PrincipalTransactionBalanceChangeSchema = Type.Object({
  asset: Type.Union([
    Type.Object({
      type: Type.Literal('stx'),
    }),
    Type.Object({
      type: Type.Union([Type.Literal('ft'), Type.Literal('nft')], {
        description: 'The asset type that was affected by the balance change.',
      }),
      identifier: Type.String({
        description: 'The identifier of the asset that was affected by the balance change.',
      }),
    }),
  ]),
  balance_change: BalanceChangeSchema,
});
export type PrincipalTransactionBalanceChange = Static<
  typeof PrincipalTransactionBalanceChangeSchema
>;

export const PrincipalBalanceChangeSchema = Type.Composite([
  Type.Object({
    tx_id: TransactionIdSchema,
  }),
  PrincipalTransactionBalanceChangeSchema,
]);
export type PrincipalBalanceChange = Static<typeof PrincipalBalanceChangeSchema>;
