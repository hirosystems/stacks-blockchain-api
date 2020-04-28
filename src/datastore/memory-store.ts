import { EventEmitter } from 'events';
import {
  DataStore,
  DbBlock,
  DbTx,
  DbStxEvent,
  DbFtEvent,
  DbNftEvent,
  DbSmartContractEvent,
  DbSmartContract,
  DbEvent,
  DataStoreEventEmitter,
} from './common';

export class MemoryDataStore extends (EventEmitter as { new (): DataStoreEventEmitter })
  implements DataStore {
  readonly blocks: Map<string, DbBlock> = new Map();
  readonly txs: Map<string, DbTx> = new Map();
  readonly stxTokenEvents: Map<string, DbStxEvent> = new Map();
  readonly fungibleTokenEvents: Map<string, DbFtEvent> = new Map();
  readonly nonFungibleTokenEvents: Map<string, DbNftEvent> = new Map();
  readonly smartContractEvents: Map<string, DbSmartContractEvent> = new Map();
  readonly smartContracts: Set<DbSmartContract> = new Set();

  updateBlock(block: DbBlock): Promise<void> {
    const blockStored = { ...block };

    // Detect reorg event by checking for existing block with same height.
    // If reorg, then update every block with height >= to new block as non-canonical.
    const reorgDetected = [...this.blocks.values()].some(
      b => b.block_height === block.block_height && b.block_hash !== block.block_hash && b.canonical
    );
    if (reorgDetected) {
      console.warn(`Detected reorg event at block height ${block.block_height}`);
      [...this.blocks.values()].forEach(b => {
        if (b.block_height >= block.block_height) {
          b.canonical = false;
        }
      });
      [...this.txs.values()].forEach(tx => {
        if (tx.block_height >= block.block_height) {
          tx.canonical = false;
        }
      });
      [...this.smartContracts.values()].forEach(sc => {
        if (sc.block_height >= block.block_height) {
          sc.canonical = false;
        }
      });
    }
    this.blocks.set(block.block_hash, blockStored);
    this.emit('blockUpdate', blockStored);
    return Promise.resolve();
  }

  getBlock(blockHash: string): Promise<DbBlock> {
    const block = this.blocks.get(blockHash);
    if (block === undefined) {
      throw new Error(`Could not find block by hash: ${blockHash}`);
    }
    return Promise.resolve(block);
  }

  getBlocks(count = 50): Promise<{ results: DbBlock[] }> {
    const results = [...this.blocks.values()]
      .filter(b => b.canonical)
      .sort((a, b) => b.block_height - a.block_height)
      .slice(0, count);
    return Promise.resolve({
      results: results,
    });
  }

  updateTx(tx: DbTx): Promise<void> {
    const txStored = { ...tx };
    this.txs.set(tx.tx_id, txStored);
    this.emit('txUpdate', txStored);
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
      .filter(tx => tx.canonical)
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

  getTxEvents(txId: string): Promise<DbEvent[]> {
    const stxEvents = [...this.stxTokenEvents.values()].filter(e => e.tx_id === txId);
    const ftEvents = [...this.fungibleTokenEvents.values()].filter(e => e.tx_id === txId);
    const nftEvents = [...this.nonFungibleTokenEvents.values()].filter(e => e.tx_id === txId);
    const smartContractEvents = [...this.smartContractEvents.values()].filter(
      e => e.tx_id === txId
    );
    const allEvents = [...stxEvents, ...ftEvents, ...nftEvents, ...smartContractEvents].sort(
      e => e.event_index
    );
    return Promise.resolve(allEvents);
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

  updateSmartContractEvent(event: DbSmartContractEvent): Promise<void> {
    this.smartContractEvents.set(`${event.tx_id}_${event.event_index}`, { ...event });
    return Promise.resolve();
  }

  updateSmartContract(smartContract: DbSmartContract): Promise<void> {
    this.smartContracts.add({ ...smartContract });
    return Promise.resolve();
  }

  async getSmartContract(contractId: string): Promise<DbSmartContract> {
    const results = [...this.smartContracts.values()].filter(
      c => c.contract_id === contractId && c.canonical
    );
    if (results.length > 1) {
      throw new Error('Multiple canonical contracts with same ID');
    }
    if (results.length < 1) {
      throw new Error('Not found');
    }
    return await Promise.resolve(results[0]);
  }
}
