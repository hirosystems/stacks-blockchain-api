import { Static, Type } from '@sinclair/typebox';

export const BlockSummarySchema = Type.Object({
  height: Type.Integer({
    description: 'Height of the block',
  }),
  hash: Type.String({
    description: 'Hash of the block',
  }),
  index_hash: Type.String({
    description: 'Index block hash of the block',
  }),
  time: Type.Number({
    description: 'Unix timestamp (in seconds) indicating when this block was mined.',
  }),
  canonical: Type.Boolean({
    description: 'Set to `true` if block corresponds to the canonical chain tip',
  }),
  tenure_height: Type.Integer({
    description: 'The tenure height (AKA coinbase height) of this block',
  }),
  bitcoin_block: Type.Object({
    height: Type.Integer({
      description: 'Height of the bitcoin block',
    }),
    hash: Type.String({
      description: 'Hash of the bitcoin block',
    }),
    time: Type.Number({
      description: 'Unix timestamp (in seconds) indicating when this bitcoin block was mined.',
    }),
  }),
  transactions_total: Type.Integer({
    description: 'Number of transactions in the block',
  }),
});
export type BlockSummary = Static<typeof BlockSummarySchema>;
