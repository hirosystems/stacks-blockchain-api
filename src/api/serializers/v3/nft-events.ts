import { NftHistoryEvent } from '../../schemas/v3/entities/nft-events.js';
import { DbNftHistoryEvent } from '../../../datastore/v3/types.js';

/**
 * Serializes a database NFT event into an NFT history event response entity.
 * @param event - The database NFT event.
 * @returns The serialized NFT history event.
 */
export function serializeNftHistoryEvent(event: DbNftHistoryEvent): NftHistoryEvent {
  return {
    sender: event.sender,
    recipient: event.recipient,
    transaction: {
      tx_id: event.tx_id,
      event_index: event.event_index,
    },
    block: {
      height: event.block_height,
      hash: event.block_hash,
      index_hash: event.index_block_hash,
      time: event.block_time,
      tx_index: event.tx_index,
    },
  };
}
