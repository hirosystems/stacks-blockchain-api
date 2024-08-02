import { Static, Type } from '@sinclair/typebox';

export const BlockSchema = Type.Object(
  {
    canonical: Type.Boolean({
      description: 'Set to `true` if block corresponds to the canonical chain tip',
    }),
    height: Type.Integer({
      description: 'Height of the block',
    }),
    hash: Type.String({
      description: 'Hash representing the block',
    }),
    block_time: Type.Number({
      description: 'Unix timestamp (in seconds) indicating when this block was mined.',
    }),
    block_time_iso: Type.String({
      description: 'An ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ) indicating when this block was mined.',
    }),
    index_block_hash: Type.String({
      description:
        'The only hash that can uniquely identify an anchored block or an unconfirmed state trie',
    }),
    parent_block_hash: Type.String({
      description: 'Hash of the parent block',
    }),
    burn_block_time: Type.Number({
      description: 'Unix timestamp (in seconds) indicating when this block was mined.',
    }),
    burn_block_time_iso: Type.String({
      description: 'An ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ) indicating when this block was mined.',
    }),
    burn_block_hash: Type.String({
      description: 'Hash of the anchor chain block',
    }),
    burn_block_height: Type.Integer({
      description: 'Height of the anchor chain block',
    }),
    miner_txid: Type.String({
      description: 'Anchor chain transaction ID',
    }),
    execution_cost_read_count: Type.Integer({
      description: 'Execution cost read count.',
    }),
    execution_cost_read_length: Type.Integer({
      description: 'Execution cost read length.',
    }),
    execution_cost_runtime: Type.Integer({
      description: 'Execution cost runtime.',
    }),
    execution_cost_write_count: Type.Integer({
      description: 'Execution cost write count.',
    }),
    execution_cost_write_length: Type.Integer({
      description: 'Execution cost write length.',
    }),
    txs: Type.Array(Type.String({ description: 'Transaction ID' }), {
      description: 'List of transactions included in the block',
    }),
    parent_microblock_hash: Type.String({
      description:
        'The hash of the last streamed block that precedes this block to which this block is to be appended. Not every anchored block will have a parent microblock stream. An anchored block that does not have a parent microblock stream has the parent microblock hash set to an empty string, and the parent microblock sequence number set to -1.',
    }),
    parent_microblock_sequence: Type.Integer({
      description:
        'The hash of the last streamed block that precedes this block to which this block is to be appended. Not every anchored block will have a parent microblock stream. An anchored block that does not have a parent microblock stream has the parent microblock hash set to an empty string, and the parent microblock sequence number set to -1.',
    }),
    microblocks_accepted: Type.Array(Type.String({ description: 'Microblock hash' }), {
      description:
        'List of microblocks that were accepted in this anchor block. Not every anchored block will have a accepted all (or any) of the previously streamed microblocks. Microblocks that were orphaned are not included in this list.',
    }),
    microblocks_streamed: Type.Array(Type.String({ description: 'Microblock hash' }), {
      description:
        "List of microblocks that were streamed/produced by this anchor block's miner. This list only includes microblocks that were accepted in the following anchor block. Microblocks that were orphaned are not included in this list.",
    }),
    microblock_tx_count: Type.Record(Type.String(), Type.Integer(), {
      description: 'List of txs counts in each accepted microblock',
    }),
  },
  { title: 'Block', description: 'A block' }
);
export type Block = Static<typeof BlockSchema>;

export const NakamotoBlockSchema = Type.Object({
  canonical: Type.Boolean({
    description: 'Set to `true` if block corresponds to the canonical chain tip',
  }),
  height: Type.Integer({ description: 'Height of the block' }),
  hash: Type.String({ description: 'Hash representing the block' }),
  block_time: Type.Integer({
    description: 'Unix timestamp (in seconds) indicating when this block was mined.',
  }),
  block_time_iso: Type.String({
    description: 'An ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ) indicating when this block was mined.',
  }),
  index_block_hash: Type.String({
    description:
      'The only hash that can uniquely identify an anchored block or an unconfirmed state trie',
  }),
  parent_block_hash: Type.String({ description: 'Hash of the parent block' }),
  parent_index_block_hash: Type.String({ description: 'Index block hash of the parent block' }),
  burn_block_time: Type.Integer({
    description: 'Unix timestamp (in seconds) indicating when this block was mined.',
  }),
  burn_block_time_iso: Type.String({
    description: 'An ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ) indicating when this block was mined.',
  }),
  burn_block_hash: Type.String({ description: 'Hash of the anchor chain block' }),
  burn_block_height: Type.Integer({ description: 'Height of the anchor chain block' }),
  miner_txid: Type.String({ description: 'Anchor chain transaction ID' }),
  tx_count: Type.Integer({ description: 'Number of transactions included in the block' }),
  execution_cost_read_count: Type.Integer({ description: 'Execution cost read count.' }),
  execution_cost_read_length: Type.Integer({ description: 'Execution cost read length.' }),
  execution_cost_runtime: Type.Integer({ description: 'Execution cost runtime.' }),
  execution_cost_write_count: Type.Integer({ description: 'Execution cost write count.' }),
  execution_cost_write_length: Type.Integer({ description: 'Execution cost write length.' }),
});
export type NakamotoBlock = Static<typeof NakamotoBlockSchema>;
