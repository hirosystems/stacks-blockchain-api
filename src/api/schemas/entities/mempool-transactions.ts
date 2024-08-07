import { Static, Type } from '@sinclair/typebox';
import {
  BaseTransactionSchemaProperties,
  CoinbaseTransactionMetadataProperties,
  ContractCallTransactionMetadataProperties,
  PoisonMicroblockTransactionMetadataProperties,
  SmartContractTransactionMetadataProperties,
  TenureChangeTransactionMetadataProperties,
  TokenTransferTransactionMetadataProperties,
} from './transactions';
import { Nullable } from '../util';

const AbstractMempoolTransactionProperties = {
  ...BaseTransactionSchemaProperties,
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
};

const AbstractMempoolTransactionSchema = Type.Object({
  ...AbstractMempoolTransactionProperties,
});
export type AbstractMempoolTransaction = Static<typeof AbstractMempoolTransactionSchema>;

export const TokenTransferMempoolTransactionSchema = Type.Object(
  {
    ...AbstractMempoolTransactionProperties,
    ...TokenTransferTransactionMetadataProperties,
  },
  { title: 'TokenTransferMempoolTransaction' }
);

export const SmartContractMempoolTransactionSchema = Type.Object(
  {
    ...AbstractMempoolTransactionProperties,
    ...SmartContractTransactionMetadataProperties,
  },
  { title: 'SmartContractMempoolTransaction' }
);

export const ContractCallMempoolTransactionSchema = Type.Object(
  {
    ...AbstractMempoolTransactionProperties,
    ...ContractCallTransactionMetadataProperties,
  },
  { title: 'ContractCallMempoolTransaction' }
);

export const PoisonMicroblockMempoolTransactionSchema = Type.Object(
  {
    ...AbstractMempoolTransactionProperties,
    ...PoisonMicroblockTransactionMetadataProperties,
  },
  { title: 'PoisonMicroblockMempoolTransaction' }
);

export const CoinbaseMempoolTransactionSchema = Type.Object(
  {
    ...AbstractMempoolTransactionProperties,
    ...CoinbaseTransactionMetadataProperties,
  },
  { title: 'CoinbaseMempoolTransaction' }
);

export const TenureChangeMempoolTransactionSchema = Type.Object(
  {
    ...AbstractMempoolTransactionProperties,
    ...TenureChangeTransactionMetadataProperties,
  },
  { title: 'TenureChangeMempoolTransaction' }
);

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
