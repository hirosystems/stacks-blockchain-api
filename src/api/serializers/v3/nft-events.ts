import { decodeClarityValueToRepr } from '@stacks/codec';
import { NftHistoryEvent, NftMint } from '../../schemas/v3/entities/nft-events.js';
import { DbNftHistoryEvent, DbNftMint } from '../../../datastore/v3/types.js';

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

/**
 * Serializes a database NFT mint event into an NFT mint response entity.
 * @param mint - The database NFT mint event.
 * @returns The serialized NFT mint.
 */
export function serializeNftMint(mint: DbNftMint): NftMint {
  return {
    recipient: mint.recipient,
    value: {
      hex: mint.value,
      repr: decodeClarityValueToRepr(mint.value),
    },
    transaction: {
      tx_id: mint.tx_id,
      event_index: mint.event_index,
    },
    block: {
      height: mint.block_height,
      hash: mint.block_hash,
      index_hash: mint.index_block_hash,
      time: mint.block_time,
      tx_index: mint.tx_index,
    },
  };
}
