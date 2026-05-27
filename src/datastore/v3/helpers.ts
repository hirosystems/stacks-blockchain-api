import { TransactionCursor } from '../../api/schemas/v3/cursors.js';
import { I32_MAX } from '../../helpers.js';

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
