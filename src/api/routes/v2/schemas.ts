import { Type, Static, TSchema } from '@sinclair/typebox';
import { TypeCompiler } from '@sinclair/typebox/compiler';
import { ResourceType, pagingQueryLimits } from '../../../api/pagination';
import { Request, Response } from 'express';
import * as Ajv from 'ajv';

const ajv = new Ajv({ coerceTypes: true });

/**
 * Validate request query parameters with a TypeBox compiled schema
 * @param req - Request
 * @param res - Response
 * @param compiledType - Ajv compiled schema
 * @returns boolean
 */
export function validRequestQuery(
  req: Request,
  res: Response,
  compiledType: Ajv.ValidateFunction
): boolean {
  if (!compiledType(req.query)) {
    // TODO: Return a more user-friendly error
    res.status(400).json({ errors: compiledType.errors });
    return false;
  }
  return true;
}

/**
 * Validate request path parameters with a TypeBox compiled schema
 * @param req - Request
 * @param res - Response
 * @param compiledType - Ajv compiled schema
 * @returns boolean
 */
export function validRequestParams(
  req: Request,
  res: Response,
  compiledType: Ajv.ValidateFunction
): boolean {
  if (!compiledType(req.params)) {
    // TODO: Return a more user-friendly error
    res.status(400).json({ errors: compiledType.errors });
    return false;
  }
  return true;
}

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

export const TransactionLimitParamSchema = Type.Integer({
  minimum: 1,
  maximum: pagingQueryLimits[ResourceType.Tx].maxLimit,
  default: pagingQueryLimits[ResourceType.Tx].defaultLimit,
  title: 'Transaction limit',
  description: 'Transactions per page',
});

const BurnBlockHashParamSchema = Type.RegExp(/^(0x)?[a-fA-F0-9]{64}$/i, {
  title: 'Burn block hash',
  description: 'Burn block hash',
  examples: ['0000000000000000000452773967cdd62297137cdaf79950c5e8bb0c62075133'],
});
export const CompiledBurnBlockHashParam = ajv.compile(BurnBlockHashParamSchema);

const BurnBlockHeightParamSchema = Type.RegExp(/^[0-9]+$/, {
  title: 'Burn block height',
  description: 'Burn block height',
  examples: ['777678'],
});

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
export const CompiledBlockPaginationQueryParams = ajv.compile(BlockPaginationQueryParamsSchema);

const TransactionPaginationQueryParamsSchema = PaginationQueryParamsSchema(
  TransactionLimitParamSchema
);
export type TransactionPaginationQueryParams = Static<
  typeof TransactionPaginationQueryParamsSchema
>;
export const CompiledTransactionPaginationQueryParams = ajv.compile(
  TransactionPaginationQueryParamsSchema
);

const BlockParamsSchema = Type.Object(
  {
    height_or_hash: Type.Union([
      Type.Literal('latest'),
      BurnBlockHashParamSchema,
      BurnBlockHeightParamSchema,
    ]),
  },
  { additionalProperties: false }
);
export type BlockParams = Static<typeof BlockParamsSchema>;
export const CompiledBlockParams = ajv.compile(BlockParamsSchema);
