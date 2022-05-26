import { PgDataStore } from '../datastore/postgres-store';
import { ReverseFileStream } from './reverse-file-stream';

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
