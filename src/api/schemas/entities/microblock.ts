import { Static, Type } from '@sinclair/typebox';
import { Nullable } from '../util';

export const MicroblockSchema = Type.Object(
  {
    canonical: Type.Boolean({
      description: 'Set to `true` if the microblock corresponds to the canonical chain tip.',
    }),
    microblock_canonical: Type.Boolean({
      description:
        'Set to `true` if the microblock was not orphaned in a following anchor block. Defaults to `true` if the following anchor block has not yet been created.',
    }),
    microblock_hash: Type.String({
      description: 'The SHA512/256 hash of this microblock.',
    }),
    microblock_sequence: Type.Integer({
      description: 'A hint to describe how to order a set of microblocks. Starts at 0.',
    }),
    microblock_parent_hash: Type.String({
      description: 'The SHA512/256 hash of the previous signed microblock in this stream.',
    }),
    block_height: Type.Integer({
      description: 'The anchor block height that confirmed this microblock.',
    }),
    parent_block_height: Type.Integer({
      description: 'The height of the anchor block that preceded this microblock.',
    }),
    parent_block_hash: Type.String({
      description: 'The hash of the anchor block that preceded this microblock.',
    }),
    parent_burn_block_hash: Type.String({
      description: 'The hash of the Bitcoin block that preceded this microblock.',
    }),
    parent_burn_block_time: Type.Integer({
      description: 'The block timestamp of the Bitcoin block that preceded this microblock.',
    }),
    parent_burn_block_time_iso: Type.String({
      description:
        'The ISO 8601 (YYYY-MM-DDTHH:mm:ss.sssZ) formatted block time of the bitcoin block that preceded this microblock.',
    }),
    parent_burn_block_height: Type.Integer({
      description: 'The height of the Bitcoin block that preceded this microblock.',
    }),
    block_hash: Nullable(
      Type.String({
        description:
          'The hash of the anchor block that confirmed this microblock. This wil be empty for unanchored microblocks',
      })
    ),
    txs: Type.Array(Type.String(), {
      description: 'List of transactions included in the microblock',
    }),
  },
  { title: 'Microblock', description: 'A microblock' }
);
export type Microblock = Static<typeof MicroblockSchema>;
