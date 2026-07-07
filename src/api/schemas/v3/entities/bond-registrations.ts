import { Static, Type } from '@sinclair/typebox';
import { BondRegistrationSummarySchema } from './bond-registration-summaries.js';
import { TransactionIdSchema } from './common.js';

export const BondRegistrationBtcLockupTransactionSchema = Type.Object({
  tx_id: TransactionIdSchema,
  output_index: Type.Integer({ description: 'The output index of the proven L1 lockup' }),
});
export type BondRegistrationBtcLockupTransaction = Static<
  typeof BondRegistrationBtcLockupTransactionSchema
>;

export const BondRegistrationBtcLockupSchema = Type.Composite([
  BondRegistrationSummarySchema,
  Type.Object({
    l1_lockup: Type.Object({
      transactions: Type.Array(BondRegistrationBtcLockupTransactionSchema, {
        description: 'The proven L1 lockup transactions',
      }),
    }),
  }),
]);
export type BondRegistrationBtcLockup = Static<typeof BondRegistrationBtcLockupSchema>;

export const BondRegistrationSbtcLockupSchema = Type.Composite([
  BondRegistrationSummarySchema,
  Type.Object({
    l2_lockup: Type.Object({
      tx_id: TransactionIdSchema,
    }),
  }),
]);
export type BondRegistrationSbtcLockup = Static<typeof BondRegistrationSbtcLockupSchema>;

export const BondRegistrationSchema = Type.Union([
  BondRegistrationBtcLockupSchema,
  BondRegistrationSbtcLockupSchema,
]);
export type BondRegistration = Static<typeof BondRegistrationSchema>;
