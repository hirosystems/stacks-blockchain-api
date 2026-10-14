import { unixEpochToIso } from '../../../helpers.js';
import { DbBitcoinBlockSummary, DbBlockSummary } from '../../../datastore/v3/types.js';
import { BitcoinBlockSummary, BlockSummary } from '../../schemas/v3/entities/common.js';

/**
 * Serializes a database Stacks block summary into a block summary entity.
 * @param block - The database block summary.
 * @returns The serialized block summary.
 */
export function serializeDbBlockSummary(block: DbBlockSummary): BlockSummary {
  return {
    height: block.block_height,
    hash: block.block_hash,
    index_hash: block.index_block_hash,
    time: block.block_time,
    time_iso: unixEpochToIso(block.block_time),
  };
}

/**
 * Serializes a database Bitcoin block summary into a Bitcoin block summary entity.
 * @param block - The database Bitcoin block summary.
 * @returns The serialized Bitcoin block summary.
 */
export function serializeDbBitcoinBlockSummary(block: DbBitcoinBlockSummary): BitcoinBlockSummary {
  return {
    height: block.burn_block_height,
    hash: block.burn_block_hash,
  };
}
