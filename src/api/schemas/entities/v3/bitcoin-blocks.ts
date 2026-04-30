import { Static, Type } from '@sinclair/typebox';
import { BitcoinBlockSummarySchema } from './bitcoin-block-summaries.js';

export const BitcoinBlockSchema = Type.Composite([
  BitcoinBlockSummarySchema,
  Type.Object({
    avg_block_time_seconds: Type.Integer({
      description: 'Average time between blocks in seconds.',
    }),
  }),
]);
export type BitcoinBlock = Static<typeof BitcoinBlockSchema>;
