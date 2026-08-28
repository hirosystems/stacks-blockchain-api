import { Static, Type } from '@sinclair/typebox';
import {
  BlockPositionSchema,
  DecodedClarityValueSchema,
  PrincipalSchema,
  TransactionPositionSchema,
} from './common.js';
import { Nullable } from '../../v1/util.js';

export const NftHistoryEventSchema = Type.Object(
  {
    sender: Nullable(PrincipalSchema),
    recipient: Nullable(PrincipalSchema),
    transaction: TransactionPositionSchema,
    block: BlockPositionSchema,
  },
  { title: 'NftHistoryEvent' }
);
export type NftHistoryEvent = Static<typeof NftHistoryEventSchema>;

export const NftMintSchema = Type.Object(
  {
    recipient: Nullable(PrincipalSchema),
    value: DecodedClarityValueSchema,
    transaction: TransactionPositionSchema,
    block: BlockPositionSchema,
  },
  { title: 'NftMint' }
);
export type NftMint = Static<typeof NftMintSchema>;
