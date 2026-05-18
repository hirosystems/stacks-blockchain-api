import { Static, Type } from '@sinclair/typebox';
import { TransactionSummarySchema } from './transaction-summaries.js';

export const PrincipalTransactionSummarySchema = Type.Object({
  transaction: TransactionSummarySchema,
  involvement: Type.Union(
    [Type.Literal('sender'), Type.Literal('sponsor'), Type.Literal('affected')],
    {
      description: 'How the principal is involved in the transaction.',
    }
  ),
  balance_changes: Type.Object({
    stx: Type.Object({
      sent: Type.String({
        description:
          'Total sent from the given address, including the tx fee, in micro-STX as an integer string.',
      }),
      received: Type.String({
        description: 'Total received by the given address in micro-STX as an integer string.',
      }),
      net: Type.String({
        description: "Net change in the principal's STX balance in micro-STX as an integer string.",
      }),
    }),
  }),
  affected_balances: Type.Object({
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
