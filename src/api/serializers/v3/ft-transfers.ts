import { PrincipalFtTransfer } from '../../schemas/v3/entities/principal-ft-transfers.js';
import { DbPrincipalFtTransfer } from '../../../datastore/v3/types.js';

/**
 * Serializes a database FT transfer into an FT transfer response entity.
 * @param transfer - The database FT transfer.
 * @returns The serialized FT transfer.
 */
export function serializePrincipalFtTransfer(transfer: DbPrincipalFtTransfer): PrincipalFtTransfer {
  return {
    sender: transfer.sender,
    recipient: transfer.recipient,
    amount: transfer.amount,
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
