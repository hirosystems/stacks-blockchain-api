import { ObjectOptions, Static, TSchema, Type } from '@sinclair/typebox';
import { pagingQueryLimits, ResourceType } from '../../pagination.js';
import { Nullable } from '../v1/util.js';

/**
 * Resource limit querystring parameter
 * @param resource - Resource type to determine the default limit and max limit
 * @returns Resource limit querystring parameter
 */
export const ResourceLimitQuerystringParam = (resource: ResourceType) =>
  Type.Integer({
    minimum: 1,
    default: pagingQueryLimits[resource].defaultLimit,
    maximum: pagingQueryLimits[resource].maxLimit,
    description: `Number of results per page`,
  });

/**
 * Cursor pagination querystring
 * @param resource - Resource type to determine the default limit and max limit
 * @param type - Type of the cursor to paginate by
 * @returns Cursor pagination querystring
 */
export const CursorPaginationQuerystring = <T extends TSchema>(type: T, resource: ResourceType) =>
  Type.Object({
    limit: Type.Optional(ResourceLimitQuerystringParam(resource)),
    cursor: Type.Optional(type),
  });

/**
 * Cursor pagination response
 * @param resultType - Type of the response object
 * @param options - Options for the response
 * @returns Cursor pagination response schema
 */
export const CursorPaginatedResponse = <TResult extends TSchema, TCursor extends TSchema>(
  resultType: TResult,
  cursorType: TCursor,
  resource: ResourceType,
  options?: ObjectOptions
) =>
  Type.Object(
    {
      total: Type.Integer({ examples: [1] }),
      limit: ResourceLimitQuerystringParam(resource),
      cursor: Type.Object({
        next: Nullable(cursorType),
        previous: Nullable(cursorType),
        current: Nullable(cursorType),
      }),
      results: Type.Array(resultType),
    },
    options
  );

export const TransactionCursorSchema = Type.String({
  description:
    'Cursor for paginating transactions. Format: block_height:microblock_sequence:tx_index',
  pattern: '^[0-9]+:[0-9]+:[0-9]+$',
});
export type TransactionCursor = Static<typeof TransactionCursorSchema>;

export const MempoolTransactionCursorSchema = Type.String({
  pattern: '^\\d+:(0x)?[a-fA-F0-9]{64}$',
  description: 'Cursor for paginating mempool transactions. Format: receipt_time:tx_id',
});
export type MempoolTransactionCursor = Static<typeof MempoolTransactionCursorSchema>;

export const TransactionEventCursorSchema = Type.String({
  pattern: '^[0-9]+$',
  description: 'Cursor for paginating transaction events. Format: event_index',
});
export type TransactionEventCursor = Static<typeof TransactionEventCursorSchema>;
