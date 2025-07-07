import { ChainID } from '@stacks/transactions';
import { CoreNodeBlockMessage } from '../../src/event-stream/core-node-message';
import { parseNewBlockMessage } from '../../src/event-stream/event-server';

describe('block time tests', () => {
  test('takes block_time from block header', () => {
    const block: CoreNodeBlockMessage = {
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
    };
    const { dbData: parsed } = parseNewBlockMessage(ChainID.Mainnet, block, false);
    expect(parsed.block.block_time).toEqual(1716238792); // Takes block_time from block header
  });

  test('takes burn_block_time from block header when block_time is not present', () => {
    const block: CoreNodeBlockMessage = {
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
    };
    const { dbData: parsed } = parseNewBlockMessage(ChainID.Mainnet, block, false);
    expect(parsed.block.block_time).toEqual(1234567890); // Takes burn_block_time from block header
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
    };
    expect(() => parseNewBlockMessage(ChainID.Mainnet, block, false)).toThrow(
      'Block message has no block_time or burn_block_time'
    );
  });
});
