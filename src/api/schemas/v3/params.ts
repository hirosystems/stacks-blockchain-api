import { ObjectOptions, TSchema, Type } from '@sinclair/typebox';
import { getPagingQueryLimit, pagingQueryLimits, ResourceType } from '../../pagination.js';
import { Nullable } from '../v1/util.js';
import { TransactionIdSchema } from './entities/common.js';

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

export const TransactionCursorSchema = Type.String({
  description:
    'Cursor for paginating transactions. Format: block_height:microblock_sequence:tx_index',
  pattern: '^[0-9]+:[0-9]+:[0-9]+$',
});

export const PrincipalTransactionBalanceChangeCursorSchema = Type.String({
  description:
    'Cursor for paginating principal transaction balance changes. Format: ' +
    '`<asset_type>:<asset_identifier>` where `asset_type` is a numeric tag ' +
    '(1=STX, 2=FT, 3=NFT) and `asset_identifier` is `<stx>` for STX or a ' +
    'fully-qualified Clarity asset id such as `SP000…contract-name::asset-name` ' +
    'for FT/NFT.',
  pattern: '^[0-9]+:\\S+$',
});

export const PrincipalBalanceChangeCursorSchema = Type.String({
  description:
    'Cursor for paginating principal balance changes across multiple transactions. ' +
    'Format: `<block_height>:<microblock_sequence>:<tx_index>:<asset_type>:<asset_identifier>`.',
  pattern: '^[0-9]+:[0-9]+:[0-9]+:[0-9]+:\\S+$',
});

/**
 * Querystring parameter for endpoints that take an explicit set of transaction ids.
 *
 * Accepted in two forms: repeated (`?tx_id=A&tx_id=B`) and comma-separated (`?tx_id=A,B`); the
 * latter normalized before validation by the `splitCommaSeparatedQueryParam('tx_id')`
 * `preValidation` hook, which every route using this parameter must register.
 * @param description - What the ids select
 * @returns The `tx_id` array schema.
 */
export const TransactionIdsQuerystringParam = (description: string) =>
  Type.Array(TransactionIdSchema, {
    minItems: 1,
    maxItems: getPagingQueryLimit(ResourceType.Tx),
    uniqueItems: true,
    description:
      `${description} Provide as repeated querystring values (\`?tx_id=A&tx_id=B\`) or as a ` +
      'single comma-separated value (`?tx_id=A,B`).',
  });
