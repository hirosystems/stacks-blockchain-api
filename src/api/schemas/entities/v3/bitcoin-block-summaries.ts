import { Static, Type } from '@sinclair/typebox';

export const BitcoinBlockSummarySchema = Type.Object({
  height: Type.Integer({ description: 'Height of the bitcoin block' }),
  hash: Type.String({ description: 'Hash of the bitcoin block' }),
  time: Type.Integer({
    description: 'Unix timestamp (in seconds) indicating when this block was mined.',
  }),
  blocks_total: Type.Integer({ description: 'Total number of stacks blocks in the bitcoin block' }),
  transactions_total: Type.Integer({
    description:
      'Total number of transactions in the Stacks blocks associated with this bitcoin block',
  }),
});
export type BitcoinBlockSummary = Static<typeof BitcoinBlockSummarySchema>;
