import { Static, Type } from '@sinclair/typebox';
import { Nullable } from '../../v1/util.js';
import {
  BlockHashSchema,
  BlockSummarySchema,
  ExecutionCostSchema,
  TimeIsoSchema,
} from './common.js';

export const BlockSchema = Type.Composite(
  [
    BlockSummarySchema,
    Type.Object({
      parent_block: Type.Object({
        hash: BlockHashSchema,
        index_hash: Type.String({
          description: 'Index block hash of the parent block',
        }),
      }),
      tenure_height: Nullable(
        Type.Integer({
          description:
            'The tenure height (AKA coinbase height) of this block. Before Nakamoto every block ' +
            'was its own tenure, so this is the block height. `null` for a Nakamoto block indexed ' +
            'before tenure heights were recorded.',
        })
      ),
      bitcoin_block: Type.Object({
        height: Type.Integer({
          description: 'Height of the Bitcoin block this block is anchored to',
        }),
        hash: Type.String({
          description: 'Hash of the Bitcoin block this block is anchored to',
        }),
        time: Type.Integer({
          description: 'Unix timestamp (in seconds) of the Bitcoin block header.',
        }),
        time_iso: TimeIsoSchema,
      }),
      tx_count: Type.Integer({
        description: 'Number of transactions included in the block',
      }),
      size: Nullable(
        Type.Integer({
          description:
            'Total size of the transactions in the block, in bytes. `null` for a block indexed ' +
            'before sizes were recorded.',
        })
      ),
      execution_cost: ExecutionCostSchema,
    }),
  ],
  { title: 'Block' }
);
export type Block = Static<typeof BlockSchema>;
