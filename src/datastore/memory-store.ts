import { DataStore, DbBlock } from './common';

export class MemoryDataStore implements DataStore {
  readonly blocks: Map<string, DbBlock> = new Map();

  updateBlock(block: DbBlock): Promise<void> {
    this.blocks.set(block.block_hash, { ...block });
    return Promise.resolve();
  }

  getBlock(blockHash: string): Promise<DbBlock> {
    const block = this.blocks.get(blockHash);
    if (block === undefined) {
      throw new Error(`Could not find block by hash: ${blockHash}`);
    }
    return Promise.resolve(block);
  }
}
