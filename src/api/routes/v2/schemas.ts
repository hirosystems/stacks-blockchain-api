import { Type, Static, TSchema } from '@sinclair/typebox';
import { TypeCompiler } from '@sinclair/typebox/compiler';
import { ResourceType, pagingQueryLimits } from '../../../api/pagination';

// ==========================
// Parameters
// ==========================

const OffsetParamSchema = Type.Integer({
  minimum: 0,
  title: 'Offset',
  description: 'Result offset',
});

export const BlockLimitParamSchema = Type.Integer({
  minimum: 1,
  maximum: pagingQueryLimits[ResourceType.Block].maxLimit,
  default: pagingQueryLimits[ResourceType.Block].defaultLimit,
  title: 'Block limit',
  description: 'Blocks per page',
});

const BurnBlockHashParamSchema = Type.RegExp(/^(0x)?[a-fA-F0-9]{64}$/i, {
  title: 'Burn block hash',
  description: 'Burn block hash',
  examples: ['0000000000000000000452773967cdd62297137cdaf79950c5e8bb0c62075133'],
});
export type BurnBlockHashParam = Static<typeof BurnBlockHashParamSchema>;
export const CompiledBurnBlockHashParam = TypeCompiler.Compile(BurnBlockHashParamSchema);

const BurnBlockHeightParamSchema = Type.RegExp(/^[0-9]+$/, {
  title: 'Burn block height',
  description: 'Burn block height',
  examples: ['777678'],
});
export type BurnBlockHeightParam = Static<typeof BurnBlockHeightParamSchema>;
export const CompiledBurnBlockHeightParam = TypeCompiler.Compile(BurnBlockHeightParamSchema);

// ==========================
// Query and path params
// TODO: Migrate these to each endpoint after switching from Express to Fastify
// ==========================

const PaginationQueryParamsSchema = <T extends TSchema>(t: T) =>
  Type.Object(
    {
      limit: Type.Optional(t),
      offset: Type.Optional(OffsetParamSchema),
    },
    { additionalProperties: false }
  );

const BlockPaginationQueryParamsSchema = PaginationQueryParamsSchema(BlockLimitParamSchema);
export type BlockPaginationQueryParams = Static<typeof BlockPaginationQueryParamsSchema>;
export const CompiledBlockPaginationParams = TypeCompiler.Compile(BlockPaginationQueryParamsSchema);

const BlocksQueryParamsSchema = Type.Union([
  BlockPaginationQueryParamsSchema,
  Type.Composite(
    [
      Type.Object({
        burn_block_hash: Type.Union([Type.Literal('latest'), BurnBlockHashParamSchema]),
      }),
      BlockPaginationQueryParamsSchema,
    ],
    { additionalProperties: false }
  ),
  Type.Composite(
    [
      Type.Object({
        burn_block_height: Type.Union([Type.Literal('latest'), BurnBlockHeightParamSchema]),
      }),
      BlockPaginationQueryParamsSchema,
    ],
    { additionalProperties: false }
  ),
]);
export type BlocksQueryParams = Static<typeof BlocksQueryParamsSchema>;
export const CompiledBlocksQueryParams = TypeCompiler.Compile(BlocksQueryParamsSchema);

const BurnBlockParamsSchema = Type.Object(
  {
    height_or_hash: Type.Union([
      Type.Literal('latest'),
      BurnBlockHashParamSchema,
      BurnBlockHeightParamSchema,
    ]),
  },
  { additionalProperties: false }
);
export type BurnBlockParams = Static<typeof BurnBlockParamsSchema>;
export const CompiledBurnBlockParams = TypeCompiler.Compile(BurnBlockParamsSchema);
