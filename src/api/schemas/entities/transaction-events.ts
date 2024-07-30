import { Static, Type } from '@sinclair/typebox';
import { CommaStringList } from '../util';

export const TransactionEventAssetTypeSchema = Type.Enum({
  transfer: 'transfer',
  mint: 'mint',
  burn: 'burn',
});

export const TransactionEventType = {
  smart_contract_log: 'smart_contract_log',
  stx_lock: 'stx_lock',
  stx_asset: 'stx_asset',
  fungible_token_asset: 'fungible_token_asset',
  non_fungible_token_asset: 'non_fungible_token_asset',
};
export const TransactionEventTypeSchema = Type.Enum(TransactionEventType);
export const TransactionEventTypeCommaListSchema = CommaStringList(TransactionEventType, {
  description: 'Comma separated list of transaction event types',
  examples: ['smart_contract_log,stx_lock,stx_asset'],
});

export const AbstractTransactionEventSchema = Type.Object(
  {
    event_index: Type.Integer(),
  },
  {
    title: 'AbstractTransactionEvent',
  }
);
export type AbstractTransactionEvent = Static<typeof AbstractTransactionEventSchema>;

export const SmartContractLogTransactionEventSchema = Type.Intersect(
  [
    AbstractTransactionEventSchema,
    Type.Object({
      event_type: Type.Literal('smart_contract_log'),
      tx_id: Type.String(),
      contract_log: Type.Object({
        contract_id: Type.String(),
        topic: Type.String(),
        value: Type.Object({
          hex: Type.String(),
          repr: Type.String(),
        }),
      }),
    }),
  ],
  {
    title: 'SmartContractLogTransactionEvent',
    description: 'Only present in `smart_contract` and `contract_call` tx types.',
  }
);
export type SmartContractLogTransactionEvent = Static<
  typeof SmartContractLogTransactionEventSchema
>;

export const StxLockTransactionEventSchema = Type.Intersect(
  [
    AbstractTransactionEventSchema,
    Type.Object({
      event_type: Type.Literal('stx_lock'),
      tx_id: Type.String(),
      stx_lock_event: Type.Object({
        locked_amount: Type.String(),
        unlock_height: Type.Integer(),
        locked_address: Type.String(),
      }),
    }),
  ],
  {
    title: 'StxLockTransactionEvent',
    description: 'Only present in `smart_contract` and `contract_call` tx types.',
  }
);
export type StxLockTransactionEvent = Static<typeof StxLockTransactionEventSchema>;

export const StxAssetTransactionEventSchema = Type.Intersect(
  [
    AbstractTransactionEventSchema,
    Type.Object({
      event_type: Type.Literal('stx_asset'),
      tx_id: Type.String(),
      asset: Type.Object({
        asset_event_type: TransactionEventAssetTypeSchema,
        sender: Type.String(),
        recipient: Type.String(),
        amount: Type.String(),
        memo: Type.Optional(Type.String()),
      }),
    }),
  ],
  {
    title: 'StxAssetTransactionEvent',
    description: 'Only present in `smart_contract` and `contract_call` tx types.',
  }
);
export type StxAssetTransactionEvent = Static<typeof StxAssetTransactionEventSchema>;

export const FungibleTokenAssetTransactionEventSchema = Type.Intersect(
  [
    AbstractTransactionEventSchema,
    Type.Object({
      event_type: Type.Literal('fungible_token_asset'),
      tx_id: Type.String(),
      asset: Type.Object({
        asset_event_type: TransactionEventAssetTypeSchema,
        asset_id: Type.String(),
        sender: Type.String(),
        recipient: Type.String(),
        amount: Type.String(),
      }),
    }),
  ],
  {
    title: 'FungibleTokenAssetTransactionEvent',
  }
);
export type FungibleTokenAssetTransactionEvent = Static<
  typeof FungibleTokenAssetTransactionEventSchema
>;

export const NonFungibleTokenAssetTransactionEventSchema = Type.Intersect(
  [
    AbstractTransactionEventSchema,
    Type.Object({
      event_type: Type.Literal('non_fungible_token_asset'),
      tx_id: Type.String(),
      asset: Type.Object({
        asset_event_type: TransactionEventAssetTypeSchema,
        asset_id: Type.String(),
        sender: Type.String(),
        recipient: Type.String(),
        value: Type.Object({
          hex: Type.String(),
          repr: Type.String(),
        }),
      }),
    }),
  ],
  {
    title: 'NonFungibleTokenAssetTransactionEvent',
  }
);
export type NonFungibleTokenAssetTransactionEvent = Static<
  typeof NonFungibleTokenAssetTransactionEventSchema
>;

export const TransactionEventSchema = Type.Union([
  SmartContractLogTransactionEventSchema,
  StxLockTransactionEventSchema,
  StxAssetTransactionEventSchema,
  FungibleTokenAssetTransactionEventSchema,
  NonFungibleTokenAssetTransactionEventSchema,
]);
export type TransactionEvent = Static<typeof TransactionEventSchema>;
