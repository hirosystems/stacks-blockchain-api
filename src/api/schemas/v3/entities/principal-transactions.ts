import { Static, Type } from '@sinclair/typebox';
import { TransactionSummarySchema } from './transaction-summaries.js';
import { BalanceChangeSchema } from './principal-balance-changes.js';

export const PrincipalTransactionSummarySchema = Type.Object({
  transaction: TransactionSummarySchema,
  involvement: Type.Union(
    [Type.Literal('sender'), Type.Literal('sponsor'), Type.Literal('affected')],
    {
      description: 'How the principal is involved in the transaction.',
    }
  ),
  balance_changes: Type.Object({
    stx: BalanceChangeSchema,
  }),
  affected_asset_types: Type.Object({
    stx: Type.Boolean({
      description: "Whether the principal's STX balance was affected by the transaction",
    }),
    ft: Type.Boolean({
      description: "Whether the principal's FT balance was affected by the transaction",
    }),
    nft: Type.Boolean({
      description: "Whether the principal's NFT balance was affected by the transaction",
    }),
  }),
});
export type PrincipalTransactionSummary = Static<typeof PrincipalTransactionSummarySchema>;
