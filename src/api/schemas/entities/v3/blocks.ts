import { Static, Type } from '@sinclair/typebox';
import { BlockSummarySchema } from './block-summaries.js';
import { ExecutionCostSchema } from './common.js';

export const BlockSchema = Type.Composite([
  BlockSummarySchema,
  Type.Object({
    parent_block: Type.Object({
      hash: Type.String({
        description: 'Hash of the parent block',
      }),
      index_hash: Type.String({
        description: 'Index block hash of the parent block',
      }),
    }),
    bitcoin_tx_id: Type.String({
      description: 'Bitcoin transaction ID that anchors this block',
    }),
    execution_cost: ExecutionCostSchema,
  }),
]);
export type BlockSummary = Static<typeof BlockSummarySchema>;
