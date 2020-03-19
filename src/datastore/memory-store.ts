import { DataStore, DbBlock, DbTx } from './common';

export class MemoryDataStore implements DataStore {
  readonly blocks: Map<string, DbBlock> = new Map();
  readonly txs: Map<string, DbTx> = new Map();

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

  updateTx(tx: DbTx): Promise<void> {
    this.txs.set(tx.tx_id, { ...tx });
    return Promise.resolve();
  }

  getTx(txId: string): Promise<DbTx> {
    const tx = this.txs.get(txId);
    if (tx === undefined) {
      throw new Error(`Could not find tx by ID: ${txId}`);
    }
    return Promise.resolve(tx);
  }
}
