import {
  FtBalanceCursor,
  FtHolderCursor,
  NftBalanceCursor,
  EventPositionCursor,
  TransactionCursor,
} from '../../api/schemas/v3/cursors.js';
import { I32_MAX } from '../../helpers.js';
import { InvalidRequestError, InvalidRequestErrorType } from '../../errors.js';
import { PgSqlClient, PgSqlQuery } from '@stacks/api-toolkit';
import { DbBondLockupTx, DbSearchHit } from './types.js';
import { SearchMatchQuality, SearchTermText } from '../../api/search-term.js';

const MAX_TX_INDEX = 0x7fff;

export type TransactionCursorRow = {
  block_height: number;
  microblock_sequence: number;
  tx_index: number;
};

const parseTransactionCursor = (cursor: TransactionCursor): TransactionCursorRow => {
  const [blockHeightStr, microblockSequenceStr, txIndexStr] = cursor.split(':');
  return {
    block_height: parseInt(blockHeightStr, 10),
    microblock_sequence: parseInt(microblockSequenceStr, 10),
    tx_index: parseInt(txIndexStr, 10),
  };
};

/**
 * Resolves a transaction cursor to a transaction cursor row.
 * @param cursor - The transaction cursor.
 * @param exactCursorExists - A function that checks if a cursor exists.
 * @returns The transaction cursor row.
 */
export const resolveTransactionCursor = async (
  cursor: TransactionCursor,
  exactCursorExists: (cursor: TransactionCursorRow) => Promise<boolean>
): Promise<TransactionCursorRow> => {
  const parsed = parseTransactionCursor(cursor);
  if (parsed.microblock_sequence !== 0 || parsed.tx_index !== 0) {
    return parsed;
  }
  if (await exactCursorExists(parsed)) {
    return parsed;
  }
  return { ...parsed, microblock_sequence: I32_MAX, tx_index: MAX_TX_INDEX };
};

export const encodeTransactionCursor = (tx: TransactionCursorRow): TransactionCursor =>
  `${tx.block_height}:${tx.microblock_sequence}:${tx.tx_index}`;

export type EventPositionCursorRow = {
  block_height: number;
  microblock_sequence: number;
  tx_index: number;
  event_index: number;
};

const parseEventPositionCursor = (cursor: EventPositionCursor): EventPositionCursorRow => {
  const [blockHeightStr, microblockSequenceStr, txIndexStr, eventIndexStr] = cursor.split(':');
  const parsed = {
    block_height: parseInt(blockHeightStr, 10),
    microblock_sequence: parseInt(microblockSequenceStr, 10),
    tx_index: parseInt(txIndexStr, 10),
    event_index: parseInt(eventIndexStr, 10),
  };
  // Reject components that exceed their column ranges (`tx_index` is a smallint, the rest are
  // integers) -- otherwise the comparison would fail in postgres with an out-of-range error and
  // surface as a 500 instead of a 400.
  if (
    parsed.block_height > I32_MAX ||
    parsed.microblock_sequence > I32_MAX ||
    parsed.tx_index > MAX_TX_INDEX ||
    parsed.event_index > I32_MAX
  ) {
    throw new InvalidRequestError(
      `Cursor value out of range: ${cursor}`,
      InvalidRequestErrorType.invalid_param
    );
  }
  return parsed;
};

/**
 * Resolves an event position cursor to a cursor row. Follows the same convention as
 * `resolveTransactionCursor`: a cursor with all non-height components at zero that doesn't match an
 * exact row is treated as a block boundary, positioning the page at the top of that block.
 * @param cursor - The event position cursor.
 * @param exactCursorExists - A function that checks if a cursor exists.
 * @returns The event position cursor row.
 */
export const resolveEventPositionCursor = async (
  cursor: EventPositionCursor,
  exactCursorExists: (cursor: EventPositionCursorRow) => Promise<boolean>
): Promise<EventPositionCursorRow> => {
  const parsed = parseEventPositionCursor(cursor);
  if (parsed.microblock_sequence !== 0 || parsed.tx_index !== 0 || parsed.event_index !== 0) {
    return parsed;
  }
  if (await exactCursorExists(parsed)) {
    return parsed;
  }
  return {
    ...parsed,
    microblock_sequence: I32_MAX,
    tx_index: MAX_TX_INDEX,
    event_index: I32_MAX,
  };
};

export const encodeEventPositionCursor = (row: EventPositionCursorRow): EventPositionCursor =>
  `${row.block_height}:${row.microblock_sequence}:${row.tx_index}:${row.event_index}`;

export type FtBalanceCursorRow = {
  balance: string;
  token: string;
};

/**
 * Parses an FT balance cursor (`balance:asset_identifier`). The balance is
 * digits-only and contains no colon, so the cursor is split on the first colon;
 * the remainder is the asset identifier (which may itself contain `::`).
 */
export const parseFtBalanceCursor = (cursor: FtBalanceCursor): FtBalanceCursorRow => {
  const separatorIndex = cursor.indexOf(':');
  return {
    balance: cursor.slice(0, separatorIndex),
    token: cursor.slice(separatorIndex + 1),
  };
};

export const encodeFtBalanceCursor = (row: FtBalanceCursorRow): FtBalanceCursor =>
  `${row.balance}:${row.token}`;

export type FtHolderCursorRow = {
  balance: string;
  /** The holder's principal (the `ft_balances.address` column). */
  principal: string;
};

/**
 * Parses an FT holder cursor (`balance:principal`). The balance is digits-only and contains no
 * colon, so the cursor is split on the first colon; the remainder is the holder principal (which
 * may itself contain a `.` contract name, but never a colon).
 */
export const parseFtHolderCursor = (cursor: FtHolderCursor): FtHolderCursorRow => {
  const separatorIndex = cursor.indexOf(':');
  return {
    balance: cursor.slice(0, separatorIndex),
    principal: cursor.slice(separatorIndex + 1),
  };
};

export const encodeFtHolderCursor = (row: FtHolderCursorRow): FtHolderCursor =>
  `${row.balance}:${row.principal}`;

export type NftBalanceCursorRow = {
  /** The NFT instance value as a `0x`-prefixed hex string. */
  value: string;
  asset_identifier: string;
};

/**
 * Parses an NFT balance cursor (`value:asset_identifier`). The value is a
 * `0x`-prefixed hex string and contains no colon, so the cursor is split on the
 * first colon; the remainder is the asset identifier (which may contain `::`).
 */
export const parseNftBalanceCursor = (cursor: NftBalanceCursor): NftBalanceCursorRow => {
  const separatorIndex = cursor.indexOf(':');
  return {
    value: cursor.slice(0, separatorIndex),
    asset_identifier: cursor.slice(separatorIndex + 1),
  };
};

export const encodeNftBalanceCursor = (row: NftBalanceCursorRow): NftBalanceCursor =>
  `${row.value}:${row.asset_identifier}`;

/**
 * Normalizes a `bond_registrations.btc_lockup_txs` jsonb value into a parsed
 * array. The pg driver returns jsonb columns as raw strings here, so a string
 * is JSON-parsed; an already-parsed array (or null) is returned as-is.
 */
export function parseBondLockupTxs(value: unknown): DbBondLockupTx[] | null {
  if (value == null) {
    return null;
  }
  if (typeof value === 'string') {
    return value.length > 0 ? (JSON.parse(value) as DbBondLockupTx[]) : null;
  }
  return value as DbBondLockupTx[];
}

/**
 * Escapes the characters that are wildcards in a `LIKE`/`ILIKE` pattern, so a term is matched
 * literally. Clarity names can contain underscores, which would otherwise match any character.
 * @param value - The literal text to match.
 * @returns The text with `LIKE` wildcards escaped.
 */
export const escapeLikePattern = (value: string): string =>
  value.replace(/[\\%_]/g, char => `\\${char}`);

/**
 * The identity of a search hit within its entity type, used to drop the duplicates that arise when
 * a term reaches the same entity through more than one branch.
 * @param hit - The search hit.
 * @returns A value identifying the hit among others of its type.
 */
export const searchHitId = (hit: DbSearchHit): string => {
  switch (hit.type) {
    case 'block':
      return hit.result.index_block_hash;
    case 'bitcoin_block':
      return hit.result.burn_block_hash;
    case 'transaction':
      return hit.result.tx_id;
    case 'address':
      return hit.result.principal;
    case 'smart_contract':
      return hit.result.contract_id;
    case 'token':
      return hit.result.asset_identifier;
  }
};

/**
 * How closely a matched value answers the term that found it. A term is not distinguishable from a
 * complete identifier by syntax alone, so a result equal to the term ranks as an exact match and
 * everything else ranks by how the term was matched.
 * @param value - The matched value.
 * @param term - The text term that matched it.
 * @returns The match quality to rank the result by.
 */
export const matchQuality = (value: string, term: SearchTermText): SearchMatchQuality =>
  value === term.value ? 'exact' : term.mode;

/**
 * The `ORDER BY` expression that ranks a substring match on a name column.
 *
 * With `pg_trgm` installed this is the trigram similarity between the name and the term, which
 * tolerates small misspellings. Without it, `similarity()` does not exist, so relevance is
 * approximated from the match itself: the earlier the term appears in the name and the shorter the
 * name is, the larger a share of the name the term accounts for. Callers append their own
 * tie-breaker after this expression. The expressions are not aggregates, so this works both in a
 * plain query and in one grouped by the name column.
 * @param sql - The SQL client, used to build the fragment.
 * @param column - The name column being matched.
 * @param term - The search term.
 * @param trigrams - Whether the `pg_trgm` extension is installed.
 * @returns The ordering fragment.
 */
export const nameRelevance = (
  sql: PgSqlClient,
  column: 'contract_id' | 'asset_identifier',
  term: string,
  trigrams: boolean
): PgSqlQuery =>
  trigrams
    ? sql`similarity(${sql(column)}, ${term}) DESC`
    : sql`strpos(lower(${sql(column)}), lower(${term})) ASC, length(${sql(column)}) ASC`;
