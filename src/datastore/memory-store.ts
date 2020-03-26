import { DataStore, DbBlock, DbTx, DbStxEvent, DbFtEvent, DbNftEvent, DbSmartContractEventTypeId } from './common';

export class MemoryDataStore implements DataStore {
  readonly blocks: Map<string, DbBlock> = new Map();
  readonly txs: Map<string, DbTx> = new Map();
  readonly stxTokenEvents: Map<string, DbStxEvent> = new Map();
  readonly fungibleTokenEvents: Map<string, DbFtEvent> = new Map();
  readonly nonFungibleTokenEvents: Map<string, DbNftEvent> = new Map();
  readonly smartContractEvents: Map<string, DbSmartContractEventTypeId> = new Map();

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

  getTxList(count = 50): Promise<{ results: DbTx[] }> {
    const results = [...this.txs.values()]
      .sort((a, b) => {
        if (b.block_height === a.block_height) {
          return b.tx_index - a.tx_index;
        }
        return b.block_height - a.block_height;
      })
      .slice(0, count);
    return Promise.resolve({
      results: results,
    });
  }

  updateStxEvent(event: DbStxEvent): Promise<void> {
    this.stxTokenEvents.set(`${event.tx_id}_${event.event_index}`, { ...event });
    return Promise.resolve();
  }

  updateFtEvent(event: DbFtEvent): Promise<void> {
    this.fungibleTokenEvents.set(`${event.tx_id}_${event.event_index}`, { ...event });
    return Promise.resolve();
  }

  updateNftEvent(event: DbNftEvent): Promise<void> {
    this.nonFungibleTokenEvents.set(`${event.tx_id}_${event.event_index}`, { ...event });
    return Promise.resolve();
  }

  updateSmartContractEvent(event: DbSmartContractEventTypeId): Promise<void> {
    this.smartContractEvents.set(`${event.tx_id}_${event.event_index}`, { ...event });
    return Promise.resolve();
  }
}
