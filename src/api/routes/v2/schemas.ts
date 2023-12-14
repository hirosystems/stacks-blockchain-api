import { Type, Static } from '@sinclair/typebox';
import { TypeCompiler } from '@sinclair/typebox/compiler';
import { ResourceType, pagingQueryLimits } from '../../../api/pagination';

// ==========================
// Parameters
// ==========================

const OffsetParam = Type.Integer({
  minimum: 0,
  title: 'Offset',
  description: 'Result offset',
});

export const BlockLimitParam = Type.Integer({
  minimum: 1,
  maximum: pagingQueryLimits[ResourceType.Block].maxLimit,
  default: pagingQueryLimits[ResourceType.Block].defaultLimit,
  title: 'Block limit',
  description: 'Blocks per page',
});

const BurnBlockHashParam = Type.RegExp(/^[0]{8}[a-fA-F0-9]{56}$/, {
  title: 'Burn block hash',
  description: 'Burn block hash',
  examples: ['0000000000000000000452773967cdd62297137cdaf79950c5e8bb0c62075133'],
});

const BurnBlockHeightParam = Type.RegExp(/^[0-9]+$/, {
  title: 'Burn block height',
  description: 'Burn block height',
  examples: ['777678'],
});

// ==========================
// Query params
// TODO: Migrate these to each endpoint after switching from Express to Fastify
// ==========================

const PaginationParamsSchema = Type.Object(
  {
    limit: Type.Optional(BlockLimitParam),
    offset: Type.Optional(OffsetParam),
  },
  { additionalProperties: false }
);

const BlocksQueryParamsSchema = Type.Union([
  PaginationParamsSchema,
  Type.Composite(
    [
      Type.Object({
        burn_block_hash: Type.Union([Type.Literal('latest'), BurnBlockHashParam]),
      }),
      PaginationParamsSchema,
    ],
    { additionalProperties: false }
  ),
  Type.Composite(
    [
      Type.Object({
        burn_block_height: Type.Union([Type.Literal('latest'), BurnBlockHeightParam]),
      }),
      PaginationParamsSchema,
    ],
    { additionalProperties: false }
  ),
]);
export type BlocksQueryParams = Static<typeof BlocksQueryParamsSchema>;
export const CompiledBlocksQueryParams = TypeCompiler.Compile(BlocksQueryParamsSchema);
