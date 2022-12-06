import { PgWriteStore } from '../datastore/pg-write-store';
import * as fs from 'fs';
import * as readline from 'readline';
import { decodeTransaction, TxPayloadTypeID } from 'stacks-encoding-native-js';
import { DataStoreBnsBlockData } from '../datastore/common';
import { ReverseFileStream } from './reverse-file-stream';
import { CoreNodeBlockMessage } from '../event-stream/core-node-message';

export type BnsGenesisBlock = DataStoreBnsBlockData & {
  tx_id: string;
  tx_index: number;
};

/**
 * Traverse a TSV file in reverse to find the last received `/new_block` node message and return
 * the `block_height` reported by that event. Even though the block produced by that event might
 * end up being re-org'd, it gives us a reasonable idea as to what the Stacks node thought
 * the block height was the moment it was sent.
 * @param filePath - TSV path
 * @returns `number` found block height, 0 if not found
 */
export async function findTsvBlockHeight(filePath: string): Promise<number> {
  let blockHeight = 0;
  const reverseStream = new ReverseFileStream(filePath);
  for await (const data of reverseStream) {
    const columns = data.split('\t');
    const eventName = columns[2];
    if (eventName === '/new_block') {
      const payload = columns[3];
      blockHeight = JSON.parse(payload).block_height;
      break;
    }
  }

  reverseStream.destroy();
  return blockHeight;
}

/**
 * Traverse a TSV file to find the genesis block and extract its data so we can use it during V1 BNS
 * import.
 * @param filePath - TSV path
 * @returns Genesis block data
 */
export async function findBnsGenesisBlockData(filePath: string): Promise<BnsGenesisBlock> {
  const genesisBlockMessage = await getGenesisBlockData(filePath);
  const bnsGenesisBlock = getBnsGenesisBlockFromBlockMessage(genesisBlockMessage);
  return bnsGenesisBlock;
}

export async function getGenesisBlockData(filePath: string): Promise<CoreNodeBlockMessage> {
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });
  try {
    for await (const line of rl) {
      const columns = line.split('\t');
      const eventName = columns[2];
      if (eventName === '/new_block') {
        const blockMessage = JSON.parse(columns[3]);
        if (blockMessage.block_height === 1) {
          return blockMessage as CoreNodeBlockMessage;
        }
      }
    }
  } finally {
    rl.close();
  }
  throw new Error('Genesis block data not found');
}

export function getBnsGenesisBlockFromBlockMessage(
  genesisBlockMessage: CoreNodeBlockMessage
): BnsGenesisBlock {
  if (genesisBlockMessage.block_height !== 1) {
    throw new Error(
      `This block message with height ${genesisBlockMessage.block_height} is not the genesis block message`
    );
  }
  const txs = genesisBlockMessage.transactions;
  for (const tx of txs) {
    const decodedTx = decodeTransaction(tx.raw_tx);
    // Look for the only token transfer transaction in the genesis block. This is the one
    // that contains all the events, including all BNS name registrations.
    if (decodedTx.payload.type_id === TxPayloadTypeID.TokenTransfer) {
      return {
        index_block_hash: genesisBlockMessage.index_block_hash,
        parent_index_block_hash: genesisBlockMessage.parent_index_block_hash,
        microblock_hash: genesisBlockMessage.parent_microblock,
        microblock_sequence: genesisBlockMessage.parent_microblock_sequence,
        microblock_canonical: true,
        tx_id: decodedTx.tx_id,
        tx_index: tx.tx_index,
      };
    }
  }
  throw new Error('BNS genesis block data not found');
}

/**
 * Get the current block height from the DB. We won't use the `getChainTip` method since that
 * adds some conversions from block hashes into strings that we're not interested in. We also can't
 * use the `chain_tip` materialized view since it is unavailable during replay, so we'll use the
 * `block_height DESC` index.
 * @param db - Data store
 * @returns Block height
 */
export async function getDbBlockHeight(db: PgWriteStore): Promise<number> {
  const result = await db.sql<{ block_height: number }[]>`
    SELECT MAX(block_height) as block_height FROM blocks WHERE canonical = TRUE
  `;
  if (result.length === 0) {
    return 0;
  }
  return result[0].block_height;
}
