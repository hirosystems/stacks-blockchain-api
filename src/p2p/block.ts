import { BufferReader } from '@stacks/transactions';
import { readBlockHeader, BlockHeader } from './block-header';
import { readTransactions, Transaction } from './tx';

export interface Block {
  header: BlockHeader;
  transactions: Transaction[];
}

export function readBlocks(reader: BufferReader): Block[] {
  const blockCount = reader.readUInt32BE();
  const blocks = new Array<Block>(blockCount);
  for (let i = 0; i < blockCount; i++) {
    const blockHeader = readBlockHeader(reader);
    const txs = readTransactions(reader);
    const block: Block = {
      header: blockHeader,
      transactions: txs,
    };
    blocks[i] = block;
  }
  return blocks;
}
