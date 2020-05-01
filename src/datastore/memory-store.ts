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
  DataStoreUpdateData,
} from './common';

export class MemoryDataStore extends (EventEmitter as { new (): DataStoreEventEmitter })
  implements DataStore {
  readonly blocks: Map<string, DbBlock> = new Map();
  readonly txs: Map<string, DbTx> = new Map();
  readonly stxTokenEvents: Map<string, DbStxEvent> = new Map();
  readonly fungibleTokenEvents: Map<string, DbFtEvent> = new Map();
  readonly nonFungibleTokenEvents: Map<string, DbNftEvent> = new Map();
  readonly smartContractEvents: Map<string, DbSmartContractEvent> = new Map();
  readonly smartContracts: Map<string, DbSmartContract> = new Map();

  async update(data: DataStoreUpdateData): Promise<void> {
    await this.updateBlock(data.block);
    for (const tx of data.txs) {
      await this.updateTx(tx);
    }
    for (const stxEvent of data.stxEvents) {
      await this.updateStxEvent(stxEvent);
    }
    for (const ftEvent of data.ftEvents) {
      await this.updateFtEvent(ftEvent);
    }
    for (const nftEvent of data.nftEvents) {
      await this.updateNftEvent(nftEvent);
    }
    for (const contractLog of data.contractLogEvents) {
      await this.updateSmartContractEvent(contractLog);
    }
    for (const smartContract of data.smartContracts) {
      await this.updateSmartContract(smartContract);
    }
    this.emit('blockUpdate', data.block);
    data.txs.forEach(tx => {
      this.emit('txUpdate', tx);
    });
  }

  updateBlock(block: DbBlock): Promise<void> {
    const blockStored = { ...block };

    // Detect reorg event by checking for existing block with same height.
    // If reorg, then update every block with height >= to new block as non-canonical.
    const reorgDetected = [...this.blocks.values()].some(
      b => b.block_height === block.block_height && b.block_hash !== block.block_hash && b.canonical
    );
    if (reorgDetected) {
      const canonicalHeight = block.block_height;
      console.warn(`Detected reorg event at block height ${canonicalHeight}`);
      this.updateCanonicalStatus(
        canonicalHeight,
        this.blocks,
        this.txs,
        this.smartContractEvents,
        this.stxTokenEvents,
        this.fungibleTokenEvents,
        this.nonFungibleTokenEvents,
        this.smartContractEvents,
        this.smartContracts
      );
    }
    this.blocks.set(block.block_hash, blockStored);
    return Promise.resolve();
  }

  updateCanonicalStatus(
    canonicalBlockHeight: number,
    ...maps: Map<unknown, { block_height: number; canonical: boolean }>[]
  ) {
    maps.forEach(items => {
      items.forEach(item => {
        if (item.block_height >= canonicalBlockHeight) {
          item.canonical = false;
        }
      });
    });
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
    this.smartContracts.set(smartContract.contract_id, { ...smartContract });
    return Promise.resolve();
  }

  async getSmartContract(contractId: string): Promise<DbSmartContract> {
    const smartContract = this.smartContracts.get(contractId);
    if (smartContract === undefined) {
      throw new Error(`Could not find smart contract by ID: ${contractId}`);
    }
    return Promise.resolve(smartContract);
  }
}
