export interface DbBlock {
  block_hash: string;
  index_block_hash: string;
  parent_block_hash: string;
  parent_microblock: string;
  block_height: number;
}

export interface DbTx {
  tx_id: string;
}

export interface DataStore {
  updateBlock(block: DbBlock): Promise<void>;
  getBlock(blockHash: string): Promise<DbBlock>;
  updateTx(tx: DbTx): Promise<void>;
  getTx(txId: string): Promise<DbTx>;
  /*
  updateAssetEvent(): Promise<void>;
  updateStxEvent(): Promise<void>;
  updateClarityEvent(): Promise<void>;
  */
}
