import {
  FtBalanceCursor,
  NftBalanceCursor,
  TransactionCursor,
} from '../../api/schemas/v3/cursors.js';
import { I32_MAX } from '../../helpers.js';
import { DbBondLockupTx } from './types.js';

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
