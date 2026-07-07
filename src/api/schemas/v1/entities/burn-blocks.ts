import { Static, Type } from '@sinclair/typebox';

export const BurnBlockSchema = Type.Object({
  burn_block_time: Type.Integer({
    description: 'Unix timestamp (in seconds) indicating when this block was mined.',
  }),
  burn_block_time_iso: Type.String({
    description: 'An ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ) indicating when this block was mined.',
  }),
  burn_block_hash: Type.String({ description: 'Hash of the anchor chain block' }),
  burn_block_height: Type.Integer({ description: 'Height of the anchor chain block' }),
  stacks_blocks: Type.Array(Type.String(), {
    description: 'Hashes of the Stacks blocks included in the burn block',
  }),
  avg_block_time: Type.Integer({
    description:
      'Average time between blocks in seconds. Returns 0 if there is only one block in the burn block.',
  }),
  total_tx_count: Type.Integer({
    description:
      'Total number of transactions in the Stacks blocks associated with this burn block',
  }),
});
export type BurnBlock = Static<typeof BurnBlockSchema>;
