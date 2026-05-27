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
    stx_asset: Type.Union([
      Type.Object({
        type: Type.Literal('transfer'),
        sender: PrincipalSchema,
        recipient: PrincipalSchema,
        amount: AmountSchema,
        memo: Nullable(DecodedClarityValueSchema),
      }),
      Type.Object({
        type: Type.Literal('mint'),
        recipient: PrincipalSchema,
        amount: AmountSchema,
      }),
      Type.Object({
        type: Type.Literal('burn'),
        sender: PrincipalSchema,
        amount: AmountSchema,
      }),
    ]),
  }),
]);
export type StxTransactionEvent = Static<typeof StxTransactionEventSchema>;

export const FtTransactionEventSchema = Type.Composite([
  BaseTransactionEventSchema,
  Type.Object({
    type: Type.Literal('ft_asset'),
    ft_asset: Type.Union([
      Type.Object({
        type: Type.Literal('transfer'),
        asset_identifier: AssetIdentifierSchema,
        sender: PrincipalSchema,
        recipient: PrincipalSchema,
        amount: AmountSchema,
      }),
      Type.Object({
        type: Type.Literal('mint'),
        recipient: PrincipalSchema,
        asset_identifier: AssetIdentifierSchema,
        amount: AmountSchema,
      }),
      Type.Object({
        type: Type.Literal('burn'),
        sender: PrincipalSchema,
        asset_identifier: AssetIdentifierSchema,
        amount: AmountSchema,
      }),
    ]),
  }),
]);
export type FtTransactionEvent = Static<typeof FtTransactionEventSchema>;

export const NftTransactionEventSchema = Type.Composite([
  BaseTransactionEventSchema,
  Type.Object({
    type: Type.Literal('nft_asset'),
    nft_asset: Type.Union([
      Type.Object({
        type: Type.Literal('transfer'),
        asset_identifier: AssetIdentifierSchema,
        sender: PrincipalSchema,
        recipient: PrincipalSchema,
        value: DecodedClarityValueSchema,
      }),
      Type.Object({
        type: Type.Literal('mint'),
        recipient: PrincipalSchema,
        asset_identifier: AssetIdentifierSchema,
        value: DecodedClarityValueSchema,
      }),
      Type.Object({
        type: Type.Literal('burn'),
        sender: PrincipalSchema,
        asset_identifier: AssetIdentifierSchema,
        value: DecodedClarityValueSchema,
      }),
    ]),
  }),
]);
export type NftTransactionEvent = Static<typeof NftTransactionEventSchema>;

export const TransactionEventSchema = Type.Union([
  ContractLogTransactionEventSchema,
  StxLockTransactionEventSchema,
  StxTransactionEventSchema,
  FtTransactionEventSchema,
  NftTransactionEventSchema,
]);
export type TransactionEvent = Static<typeof TransactionEventSchema>;
