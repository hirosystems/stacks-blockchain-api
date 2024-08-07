import { Static, Type } from '@sinclair/typebox';
import {
  AbstractMempoolTransactionProperties,
  BaseTransactionSchemaProperties,
  CoinbaseTransactionMetadataProperties,
  ContractCallTransactionMetadataProperties,
  PoisonMicroblockTransactionMetadataProperties,
  SmartContractTransactionMetadataProperties,
  TenureChangeTransactionMetadataProperties,
  TokenTransferTransactionMetadataProperties,
} from './transactions';
import { Nullable } from '../util';

export const MempoolStatsSchema = Type.Object(
  {
    p25: Nullable(Type.Number()),
    p50: Nullable(Type.Number()),
    p75: Nullable(Type.Number()),
    p95: Nullable(Type.Number()),
  },
  { additionalProperties: true }
);
