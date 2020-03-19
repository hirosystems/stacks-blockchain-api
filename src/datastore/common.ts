export interface DbBlock {
  block_hash: string;
  index_block_hash: string;
  parent_block_hash: string;
  parent_microblock: string;
}

export interface DataStore {
  updateBlock(block: DbBlock): Promise<void>;
  getBlock(blockHash: string): Promise<DbBlock>;
  /*
  updateTx(): Promise<void>;
  updateAssetEvent(): Promise<void>;
  updateStxEvent(): Promise<void>;
  updateClarityEvent(): Promise<void>;
  */
}
