import { ObjectOptions, TSchema, Type } from '@sinclair/typebox';
import { pagingQueryLimits, ResourceType } from '../../pagination.js';
import { Nullable } from '../util.js';

/**
 * Cursor pagination querystring
 * @param resource - Resource type to determine the default limit and max limit
 * @param type - Type of the cursor to paginate by
 * @returns Cursor pagination querystring
 */
export const CursorPaginationQuerystring = <T extends TSchema>(
  resource: ResourceType,
  type: T,
  title?: string,
  description?: string,
  limitOverride?: number
) =>
  Type.Object({
    limit: Type.Optional(
      Type.Integer({
        minimum: 0,
        default: pagingQueryLimits[resource].defaultLimit,
        maximum: limitOverride ?? pagingQueryLimits[resource].maxLimit,
        title: title ?? 'Limit',
        description: description ?? 'Results per page',
      })
    ),
    cursor: Type.Optional(type),
  });

/**
 * Cursor pagination response
 * @param type - Type of the response object
 * @param options - Options for the response
 * @returns Cursor pagination response schema
 */
export const CursorPaginatedResponse = <T extends TSchema>(type: T, options?: ObjectOptions) =>
  Type.Object(
    {
      total: Type.Integer({ examples: [1] }),
      limit: Type.Integer({ examples: [20] }),
      cursor: Type.Object({
        next: Nullable(Type.String({ description: 'Next page cursor' })),
        previous: Nullable(Type.String({ description: 'Previous page cursor' })),
        current: Nullable(Type.String({ description: 'Current page cursor' })),
      }),
      results: Type.Array(type),
    },
    options
  );
