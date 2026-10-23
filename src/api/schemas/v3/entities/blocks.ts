import { Static, Type } from '@sinclair/typebox';
import { Nullable } from '../../v1/util.js';
import {
  BlockHashSchema,
  BlockSummarySchema,
  ExecutionCostSchema,
  TimeIsoSchema,
} from './common.js';

export const BlockSchema = Type.Object(
  {
    ...BlockSummarySchema.properties,
    // The summary's anchor, with its time.
    bitcoin_block: Type.Object({
      ...BlockSummarySchema.properties.bitcoin_block.properties,
      time: Type.Integer({
        description: 'Unix timestamp (in seconds) of the Bitcoin block header.',
      }),
      time_iso: TimeIsoSchema,
    }),
    parent_block: Type.Object({
      hash: BlockHashSchema,
      index_hash: Type.String({
        description: 'Index block hash of the parent block',
      }),
    }),
    size: Nullable(
      Type.Integer({
        description:
          'Total size of the transactions in the block, in bytes. `null` for a block indexed ' +
          'before sizes were recorded.',
      })
    ),
    execution_cost: ExecutionCostSchema,
  },
  { title: 'Block' }
);
export type Block = Static<typeof BlockSchema>;
