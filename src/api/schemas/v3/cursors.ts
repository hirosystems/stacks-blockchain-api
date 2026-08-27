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

export const EventPositionCursorSchema = Type.String({
  description:
    'Cursor for paginating individual events by their position in the chain. Format: block_height:microblock_sequence:tx_index:event_index',
  pattern: '^[0-9]+:[0-9]+:[0-9]+:[0-9]+$',
});
export type EventPositionCursor = Static<typeof EventPositionCursorSchema>;

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

export const BondCursorSchema = Type.String({
  pattern: '^\\d+$',
  description: 'Cursor for paginating bonds. Format: bond_index',
});
export type BondCursor = Static<typeof BondCursorSchema>;

export const FtBalanceCursorSchema = Type.String({
  pattern: '^\\d+:.+$',
  description:
    'Cursor for paginating FT balances (sorted by balance, descending). Format: balance:asset_identifier',
});
export type FtBalanceCursor = Static<typeof FtBalanceCursorSchema>;

export const FtHolderCursorSchema = Type.String({
  pattern: '^\\d+:\\S+$',
  description:
    'Cursor for paginating fungible token holders (sorted by balance descending, then holder ' +
    'principal). Format: balance:principal',
});
export type FtHolderCursor = Static<typeof FtHolderCursorSchema>;

export const NftBalanceCursorSchema = Type.String({
  pattern: '^0x[0-9a-fA-F]*:.+$',
  description:
    'Cursor for paginating NFT balances (sorted by asset identifier then value). Format: value:asset_identifier',
});
export type NftBalanceCursor = Static<typeof NftBalanceCursorSchema>;

export const SignerCursorSchema = Type.String({
  // A Stacks principal: a standard address, optionally followed by a contract name.
  pattern: '^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{28,41}(\\.[a-zA-Z]([a-zA-Z0-9]|[-_]){0,39})?$',
  description: 'Cursor for paginating staking signers (sorted by signer). Format: signer principal',
});
export type SignerCursor = Static<typeof SignerCursorSchema>;

export const SigningKeyCursorSchema = Type.String({
  pattern: '^(0x)?[0-9a-fA-F]{66}$',
  description:
    "Cursor for paginating a cycle's signers (sorted by weight descending, then signing key). Format: signing key",
});
export type SigningKeyCursor = Static<typeof SigningKeyCursorSchema>;

export const StakerCursorSchema = Type.String({
  // A Stacks principal: a standard address, optionally followed by a contract name.
  pattern: '^[0123456789ABCDEFGHJKMNPQRSTVWXYZ]{28,41}(\\.[a-zA-Z]([a-zA-Z0-9]|[-_]){0,39})?$',
  description:
    "Cursor for paginating a signer's stakers (sorted by staker). Format: staker principal",
});
export type StakerCursor = Static<typeof StakerCursorSchema>;
