import { ClarityTypeID, decodeClarityValue, memoToString } from '@stacks/codec';
import {
  PrincipalStxTransfer,
  PrincipalStxTransferSchema,
} from '../../schemas/v3/entities/principal-stx-transfers.js';
import { DbPrincipalStxTransfer } from '../../../datastore/v3/types.js';
import { Static } from '@sinclair/typebox';

type DecodedMemo = Static<typeof PrincipalStxTransferSchema>['memo'];

/**
 * Decodes a transfer's memo into its `{ hex, repr }` form. A `send-many-memo` print value is a
 * Clarity-serialized buffer wrapping the memo bytes, so it is unwrapped first; raw memo bytes are
 * decoded directly. An absent or empty memo serializes as null.
 * @param transfer - The database STX transfer.
 * @returns The decoded memo, or null.
 */
function decodeTransferMemo(transfer: DbPrincipalStxTransfer): DecodedMemo {
  let memoHex = transfer.memo;
  if (transfer.bulk_send_memo) {
    const decoded = decodeClarityValue(transfer.bulk_send_memo);
    // The send-many-memo contract prints the memo as a Clarity buffer. Guard the type anyway so
    // an unexpected print shape degrades to no memo instead of failing the response.
    memoHex = decoded.type_id === ClarityTypeID.Buffer ? decoded.buffer : null;
  }
  if (!memoHex || memoHex === '0x') {
    return null;
  }
  return {
    hex: memoHex,
    repr: memoToString(memoHex),
  };
}

/**
 * Serializes a database STX transfer into an STX transfer response entity.
 * @param transfer - The database STX transfer.
 * @returns The serialized STX transfer.
 */
export function serializePrincipalStxTransfer(
  transfer: DbPrincipalStxTransfer
): PrincipalStxTransfer {
  return {
    sender: transfer.sender,
    recipient: transfer.recipient,
    amount: transfer.amount,
    memo: decodeTransferMemo(transfer),
    transaction: {
      tx_id: transfer.tx_id,
      event_index: transfer.event_index,
    },
    block: {
      height: transfer.block_height,
      hash: transfer.block_hash,
      index_hash: transfer.index_block_hash,
      time: transfer.block_time,
      tx_index: transfer.tx_index,
    },
  };
}
