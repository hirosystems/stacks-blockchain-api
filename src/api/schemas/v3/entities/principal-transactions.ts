import { Static, Type } from '@sinclair/typebox';
import { TransactionSummarySchema } from './transaction-summaries.js';

export const PrincipalTransactionSummarySchema = Type.Object({
  transaction: TransactionSummarySchema,
  balance_changes: Type.Object({
    stx: Type.Object({
      sent: Type.String({ description: 'STX sent' }),
      received: Type.String({ description: 'STX received' }),
    }),
  }),
});
export type PrincipalTransactionSummary = Static<typeof PrincipalTransactionSummarySchema>;
