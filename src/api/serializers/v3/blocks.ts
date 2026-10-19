import { unixEpochToIso } from '../../../helpers.js';
import {
  DbBitcoinBlockStacksBlockCounts,
  DbBitcoinBlockSummary,
  DbBlockDetail,
  DbBlockSummary,
} from '../../../datastore/v3/types.js';
import { Block } from '../../schemas/v3/entities/blocks.js';
import {
  BitcoinBlock,
  BitcoinBlockSummary,
  BlockSummary,
} from '../../schemas/v3/entities/common.js';
import { ScheduleTimes, serializeSchedulePointTimes } from './bitcoin-block-times.js';

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
    // Before Nakamoto (no signer bitvec) every block was its own tenure.
    tenure_height: block.tenure_height ?? (block.signer_bitvec ? null : block.block_height),
    tx_count: block.tx_count,
    bitcoin_block: {
      height: block.burn_block_height,
      hash: block.burn_block_hash,
    },
  };
}

/**
 * Serializes a database Stacks block into a block entity.
 * @param block - The database block.
 * @returns The serialized block.
 */
export function serializeDbBlock(block: DbBlockDetail): Block {
  const summary = serializeDbBlockSummary(block);
  return {
    ...summary,
    bitcoin_block: {
      ...summary.bitcoin_block,
      time: block.burn_block_time,
      time_iso: unixEpochToIso(block.burn_block_time),
    },
    parent_block: {
      hash: block.parent_block_hash,
      index_hash: block.parent_index_block_hash,
    },
    size: block.tx_total_size,
    execution_cost: {
      read_count: Number(block.execution_cost_read_count),
      read_length: Number(block.execution_cost_read_length),
      runtime: Number(block.execution_cost_runtime),
      write_count: Number(block.execution_cost_write_count),
      write_length: Number(block.execution_cost_write_length),
    },
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

/**
 * Serializes a Bitcoin block with its time (the header or interpolated time once known, a
 * projection until then) and what the Stacks blocks anchored to it add up to.
 * @param block - The Bitcoin block; a future one has no hash yet.
 * @param times - The Bitcoin block times resolved for the block's height.
 * @param counts - The Stacks block counts by Bitcoin block hash; absent means none anchored.
 * @returns The serialized Bitcoin block.
 */
export function serializeBitcoinBlock(
  block: { burn_block_height: number; burn_block_hash: string | null },
  times: ScheduleTimes,
  counts: ReadonlyMap<string, DbBitcoinBlockStacksBlockCounts>
): BitcoinBlock {
  const blockCounts = block.burn_block_hash ? counts.get(block.burn_block_hash) : undefined;
  return {
    height: block.burn_block_height,
    hash: block.burn_block_hash,
    ...serializeSchedulePointTimes(times, block.burn_block_height),
    stacks_block_count: blockCounts?.stacks_block_count ?? 0,
    tx_count: blockCounts?.tx_count ?? 0,
  };
}
