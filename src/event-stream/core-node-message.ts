import { DecodedTxResult } from '@hirosystems/stacks-encoding-native-js';
import { NewBlockTransaction, NewMicroblocksTransaction } from '@stacks/node-publisher-client';

export interface CoreNodeParsedTxMessage {
  core_tx: NewBlockTransaction;
  parsed_tx: DecodedTxResult;
  raw_tx: string;
  nonce: number;
  sender_address: string;
  sponsor_address: string | undefined;
  block_hash: string;
  index_block_hash: string;
  parent_index_block_hash: string;
  parent_block_hash: string;
  microblock_sequence: number;
  microblock_hash: string;
  block_height: number;
  burn_block_height: number;
  burn_block_time: number;
  parent_burn_block_time: number;
  parent_burn_block_hash: string;
  block_time: number;
}

export function isTxWithMicroblockInfo(tx: NewBlockTransaction): tx is NewMicroblocksTransaction {
  if (tx.microblock_hash && tx.microblock_parent_hash && tx.microblock_sequence !== null) {
    return true;
  }
  if (tx.microblock_hash || tx.microblock_parent_hash || tx.microblock_sequence !== null) {
    throw new Error(
      `Unexpected transaction object that contains only partial microblock data: ${JSON.stringify(
        tx
      )}`
    );
  }
  return false;
}
