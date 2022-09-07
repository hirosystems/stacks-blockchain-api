import * as fs from 'fs';
import * as readline from 'readline';
import { decodeTransaction, TxPayloadTypeID } from 'stacks-encoding-native-js';
import { DataStoreBnsBlockData } from '../datastore/common';
import { PgDataStore } from '../datastore/postgres-store';
import { ReverseFileStream } from './reverse-file-stream';

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
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const columns = line.split('\t');
    const eventName = columns[2];
    if (eventName === '/new_block') {
      const payload = JSON.parse(columns[3]);
      // Look for block 1
      if (payload.block_height === 1) {
        for (const tx of payload.transactions) {
          const decodedTx = decodeTransaction(tx.raw_tx);
          // Look for the only token transfer transaction in the genesis block. This is the one
          // that contains all the events, including all BNS name registrations.
          if (decodedTx.payload.type_id === TxPayloadTypeID.TokenTransfer) {
            rl.close();
            return {
              index_block_hash: payload.index_block_hash,
              parent_index_block_hash: payload.parent_index_block_hash,
              microblock_hash: payload.parent_microblock,
              microblock_sequence: payload.parent_microblock_sequence,
              microblock_canonical: true,
              tx_id: decodedTx.tx_id,
              tx_index: tx.tx_index,
            };
          }
        }
      }
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
export async function getDbBlockHeight(db: PgDataStore): Promise<number> {
  const result = await db.query(async client => {
    return await client.query<{ block_height: number }>(
      `SELECT MAX(block_height) as block_height FROM blocks WHERE canonical = TRUE`
    );
  });
  if (result.rowCount === 0) {
    return 0;
  }
  return result.rows[0].block_height;
}
