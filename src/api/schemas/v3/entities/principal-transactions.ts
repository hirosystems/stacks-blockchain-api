import { Static, Type } from '@sinclair/typebox';
import { TransactionSummarySchema } from './transaction-summaries.js';

export const PrincipalTransactionSummarySchema = Type.Object({
  transaction: TransactionSummarySchema,
  stx_balance_change: Type.Object({
    sent: Type.String({
      description:
        'STX sent by the principal, including any fees paid, in micro-STX as an integer string',
    }),
    received: Type.String({
      description: 'STX received by the principal, in micro-STX as an integer string',
    }),
    net: Type.String({
      description: 'Net STX balance change for the principal, in micro-STX as an integer string',
    }),
  }),
  affected_asset_balances: Type.Object({
    stx: Type.Boolean({
      description: 'Whether the STX balance was affected by the transaction',
    }),
    ft: Type.Boolean({
      description: 'Whether the FT balance was affected by the transaction',
    }),
    nft: Type.Boolean({
      description: 'Whether the NFT balance was affected by the transaction',
    }),
  }),
});
export type PrincipalTransactionSummary = Static<typeof PrincipalTransactionSummarySchema>;
