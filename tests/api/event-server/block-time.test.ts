import { parseNewBlockMessage } from '../../../src/event-stream/event-server.ts';
import { NewBlockMessage } from '@stacks/node-publisher-client';
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { STACKS_MAINNET } from '@stacks/network';

describe('block time tests', () => {
  test('takes block_time from block header', () => {
    const block: NewBlockMessage = {
      block_time: 1716238792,
      block_height: 1,
      block_hash: '0x1234',
      index_block_hash: '0x5678',
      parent_index_block_hash: '0x9abc',
      parent_block_hash: '0x1234',
      parent_microblock: '0x1234',
      parent_microblock_sequence: 0,
      parent_burn_block_hash: '0x1234',
      parent_burn_block_height: 0,
      parent_burn_block_timestamp: 0,
      burn_block_time: 1234567890,
      burn_block_hash: '0x1234',
      burn_block_height: 1,
      miner_txid: '0x1234',
      events: [],
      transactions: [],
      matured_miner_rewards: [],
      signer_signature_hash: '0x1234',
      miner_signature: '0x1234',
    };
    const { dbData: parsed } = parseNewBlockMessage(STACKS_MAINNET.chainId, block, false);
    assert.deepEqual(parsed.block.block_time, 1716238792); // Takes block_time from block header
  });

  test('takes burn_block_time from block header when block_time is not present', () => {
    const block: NewBlockMessage = {
      block_time: null,
      block_height: 1,
      block_hash: '0x1234',
      index_block_hash: '0x5678',
      parent_index_block_hash: '0x9abc',
      parent_block_hash: '0x1234',
      parent_microblock: '0x1234',
      parent_microblock_sequence: 0,
      parent_burn_block_hash: '0x1234',
      parent_burn_block_height: 0,
      parent_burn_block_timestamp: 0,
      burn_block_time: 1234567890,
      burn_block_hash: '0x1234',
      burn_block_height: 1,
      miner_txid: '0x1234',
      events: [],
      transactions: [],
      matured_miner_rewards: [],
      signer_signature_hash: '0x1234',
      miner_signature: '0x1234',
    };
    const { dbData: parsed } = parseNewBlockMessage(STACKS_MAINNET.chainId, block, false);
    assert.deepEqual(parsed.block.block_time, 1234567890); // Takes burn_block_time from block header
  });

  test('throws error if block_time and burn_block_time are not present', () => {
    // Use `any` to avoid type errors when setting `block_time` and `burn_block_time` to `null`.
    const block: any = {
      block_time: null,
      burn_block_time: null,
      block_height: 1,
      block_hash: '0x1234',
      index_block_hash: '0x5678',
      parent_index_block_hash: '0x9abc',
      parent_block_hash: '0x1234',
      parent_microblock: '0x1234',
      parent_microblock_sequence: 0,
      parent_burn_block_hash: '0x1234',
      parent_burn_block_height: 0,
      parent_burn_block_timestamp: 0,
      burn_block_hash: '0x1234',
      burn_block_height: 1,
      miner_txid: '0x1234',
      events: [],
      transactions: [],
      matured_miner_rewards: [],
      signer_signature_hash: '0x1234',
      miner_signature: '0x1234',
    };
    assert.throws(
      () => parseNewBlockMessage(STACKS_MAINNET.chainId, block, false),
      /Block message has no block_time or burn_block_time/
    );
  });
});
