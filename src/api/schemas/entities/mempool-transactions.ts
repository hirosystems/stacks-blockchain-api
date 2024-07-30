import { Static, Type } from '@sinclair/typebox';
import {
  BaseTransactionSchema,
  CoinbaseTransactionMetadataSchema,
  ContractCallTransactionMetadataSchema,
  PoisonMicroblockTransactionMetadataSchema,
  SmartContractTransactionMetadataSchema,
  TenureChangeTransactionMetadataSchema,
  TokenTransferTransactionMetadataSchema,
} from './transactions';
import { Nullable } from '../util';

const AbstractMempoolTransactionSchema = Type.Intersect([
  BaseTransactionSchema,
  Type.Object(
    {
      tx_status: Type.Union(
        [
          Type.Literal('pending'),
          Type.Literal('dropped_replace_by_fee'),
          Type.Literal('dropped_replace_across_fork'),
          Type.Literal('dropped_too_expensive'),
          Type.Literal('dropped_stale_garbage_collect'),
          Type.Literal('dropped_problematic'),
        ],
        {
          description: 'Status of the transaction',
        }
      ),
      receipt_time: Type.Number({
        description:
          'A unix timestamp (in seconds) indicating when the transaction broadcast was received by the node.',
      }),
      receipt_time_iso: Type.String({
        description:
          'An ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ) timestamp indicating when the transaction broadcast was received by the node.',
      }),
    },
    {
      title: 'AbstractMempoolTransaction',
      description:
        'Abstract transaction. This schema makes up all properties common between all Stacks 2.0 transaction types',
    }
  ),
]);
export type AbstractMempoolTransaction = Static<typeof AbstractMempoolTransactionSchema>;

export const TokenTransferMempoolTransactionSchema = Type.Intersect([
  AbstractMempoolTransactionSchema,
  TokenTransferTransactionMetadataSchema,
]);
export type TokenTransferMempoolTransaction = Static<typeof TokenTransferMempoolTransactionSchema>;

export const SmartContractMempoolTransactionSchema = Type.Intersect([
  AbstractMempoolTransactionSchema,
  SmartContractTransactionMetadataSchema,
]);
export type SmartContractMempoolTransaction = Static<typeof SmartContractMempoolTransactionSchema>;

export const ContractCallMempoolTransactionSchema = Type.Intersect([
  AbstractMempoolTransactionSchema,
  ContractCallTransactionMetadataSchema,
]);
export type ContractCallMempoolTransaction = Static<typeof ContractCallMempoolTransactionSchema>;

export const PoisonMicroblockMempoolTransactionSchema = Type.Intersect([
  AbstractMempoolTransactionSchema,
  PoisonMicroblockTransactionMetadataSchema,
]);
export type PoisonMicroblockMempoolTransaction = Static<
  typeof PoisonMicroblockMempoolTransactionSchema
>;

export const CoinbaseMempoolTransactionSchema = Type.Intersect([
  AbstractMempoolTransactionSchema,
  CoinbaseTransactionMetadataSchema,
]);
export type CoinbaseMempoolTransaction = Static<typeof CoinbaseMempoolTransactionSchema>;

export const TenureChangeMempoolTransactionSchema = Type.Intersect([
  AbstractMempoolTransactionSchema,
  TenureChangeTransactionMetadataSchema,
]);
export type TenureChangeMempoolTransaction = Static<typeof TenureChangeMempoolTransactionSchema>;

export const MempoolTransactionSchema = Type.Union([
  TokenTransferMempoolTransactionSchema,
  SmartContractMempoolTransactionSchema,
  ContractCallMempoolTransactionSchema,
  PoisonMicroblockMempoolTransactionSchema,
  CoinbaseMempoolTransactionSchema,
  TenureChangeMempoolTransactionSchema,
]);
export type MempoolTransaction = Static<typeof MempoolTransactionSchema>;

export const MempoolStatsSchema = Type.Object(
  {
    p25: Nullable(Type.Number()),
    p50: Nullable(Type.Number()),
    p75: Nullable(Type.Number()),
    p95: Nullable(Type.Number()),
  },
  { additionalProperties: true }
);
