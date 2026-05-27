import { Static, Type } from '@sinclair/typebox';
import {
  AssetIdentifierSchema,
  DecodedClarityValueSchema,
  PrincipalSchema,
  SmartContractIdSchema,
  BlockHeightSchema,
  AmountSchema,
} from './common.js';
import { Nullable } from '../../v1/util.js';

export const TokenTransactionEventTypeSchema = Type.Union([
  Type.Literal('transfer'),
  Type.Literal('mint'),
  Type.Literal('burn'),
]);
export type TokenTransactionEventType = Static<typeof TokenTransactionEventTypeSchema>;

const BaseTransactionEventSchema = Type.Object({
  event_index: Type.Integer(),
});

export const ContractLogTransactionEventSchema = Type.Composite([
  BaseTransactionEventSchema,
  Type.Object({
    type: Type.Literal('contract_log'),
    contract_log: Type.Object({
      contract_id: SmartContractIdSchema,
      topic: Type.Literal('print'),
      value: DecodedClarityValueSchema,
    }),
  }),
]);
export type ContractLogTransactionEvent = Static<typeof ContractLogTransactionEventSchema>;

const StxLockTransactionEventSchema = Type.Composite([
  BaseTransactionEventSchema,
  Type.Object({
    type: Type.Literal('stx_lock'),
    stx_lock: Type.Object({
      amount: AmountSchema,
      unlock_bitcoin_height: BlockHeightSchema,
      address: PrincipalSchema,
    }),
  }),
]);
export type StxLockTransactionEvent = Static<typeof StxLockTransactionEventSchema>;

const StxTransactionEventSchema = Type.Composite([
  BaseTransactionEventSchema,
  Type.Object({
    type: Type.Literal('stx_asset'),
    stx_asset: Type.Object({
      type: TokenTransactionEventTypeSchema,
      sender: PrincipalSchema,
      recipient: PrincipalSchema,
      amount: AmountSchema,
      memo: Nullable(DecodedClarityValueSchema),
    }),
  }),
]);
export type StxTransactionEvent = Static<typeof StxTransactionEventSchema>;

export const FtTransactionEventSchema = Type.Composite(
  [
    BaseTransactionEventSchema,
    Type.Object({
      type: Type.Literal('ft_asset'),
      ft_asset: Type.Object({
        type: TokenTransactionEventTypeSchema,
        asset_identifier: AssetIdentifierSchema,
        sender: PrincipalSchema,
        recipient: PrincipalSchema,
        amount: AmountSchema,
      }),
    }),
  ],
  {
    title: 'FtTransactionEvent',
  }
);
export type FtTransactionEvent = Static<typeof FtTransactionEventSchema>;

export const NftTransactionEventSchema = Type.Composite(
  [
    BaseTransactionEventSchema,
    Type.Object({
      type: Type.Literal('nft_asset'),
      nft_asset: Type.Object({
        type: TokenTransactionEventTypeSchema,
        asset_identifier: AssetIdentifierSchema,
        sender: PrincipalSchema,
        recipient: PrincipalSchema,
        value: DecodedClarityValueSchema,
      }),
    }),
  ],
  {
    title: 'NftTransactionEvent',
  }
);
export type NftTransactionEvent = Static<typeof NftTransactionEventSchema>;

export const TransactionEventSchema = Type.Union([
  ContractLogTransactionEventSchema,
  StxLockTransactionEventSchema,
  StxTransactionEventSchema,
  FtTransactionEventSchema,
  NftTransactionEventSchema,
]);
export type TransactionEvent = Static<typeof TransactionEventSchema>;
