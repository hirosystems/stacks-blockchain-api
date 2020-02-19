import { BinaryReader } from './binaryReader';
import { readBlockHeader, BlockHeader } from './blockHeaderReader';
import { readTransactions, Transaction } from './txReader';

export interface Block {
  header: BlockHeader;
  transactions: Transaction[];
}

export async function readBlocks(stream: BinaryReader): Promise<Block[]> {
  const blockCount = await stream.readUInt32BE();
  const blocks = new Array<Block>(blockCount);
  for (let i = 0; i < blockCount; i++) {
    const blockHeader = await readBlockHeader(stream);
    const txs = await readTransactions(stream);
    const block: Block = {
      header: blockHeader,
      transactions: txs,
    };
    blocks[i] = block;
  }
  return blocks;
}
