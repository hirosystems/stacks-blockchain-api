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

  async update(data: DataStoreUpdateData) {
    await this.updateBlock(data.block);
    for (const entry of data.txs) {
      await this.updateTx(entry.tx);
      for (const stxEvent of entry.stxEvents) {
        await this.updateStxEvent(entry.tx, stxEvent);
      }
      for (const ftEvent of entry.ftEvents) {
        await this.updateFtEvent(entry.tx, ftEvent);
      }
      for (const nftEvent of entry.nftEvents) {
        await this.updateNftEvent(entry.tx, nftEvent);
      }
      for (const contractLog of entry.contractLogEvents) {
        await this.updateSmartContractEvent(entry.tx, contractLog);
      }
      for (const smartContract of entry.smartContracts) {
        await this.updateSmartContract(entry.tx, smartContract);
      }
    }
    this.emit('blockUpdate', data.block);
    data.txs.forEach(entry => {
      this.emit('txUpdate', entry.tx);
    });
  }

  updateBlock(block: DbBlock) {
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

  getBlock(blockHash: string) {
    const block = this.blocks.get(blockHash);
    if (block === undefined) {
      return Promise.resolve({ found: false } as const);
    }
    return Promise.resolve({ found: true, result: block });
  }

  getBlocks(count = 50) {
    const results = [...this.blocks.values()]
      .filter(b => b.canonical)
      .sort((a, b) => b.block_height - a.block_height)
      .slice(0, count);
    return Promise.resolve({ results });
  }

  updateTx(tx: DbTx) {
    const txStored = { ...tx };
    this.txs.set(tx.tx_id, txStored);
    return Promise.resolve();
  }

  getTx(txId: string) {
    const tx = this.txs.get(txId);
    if (tx === undefined) {
      return Promise.resolve({ found: false } as const);
    }
    return Promise.resolve({ found: true, result: tx });
  }

  getTxList(count = 50) {
    const results = [...this.txs.values()]
      .filter(tx => tx.canonical)
      .sort((a, b) => {
        if (b.block_height === a.block_height) {
          return b.tx_index - a.tx_index;
        }
        return b.block_height - a.block_height;
      })
      .slice(0, count);
    return Promise.resolve({ results });
  }

  getTxEvents(txId: string) {
    const stxEvents = [...this.stxTokenEvents.values()].filter(e => e.tx_id === txId);
    const ftEvents = [...this.fungibleTokenEvents.values()].filter(e => e.tx_id === txId);
    const nftEvents = [...this.nonFungibleTokenEvents.values()].filter(e => e.tx_id === txId);
    const smartContractEvents = [...this.smartContractEvents.values()].filter(
      e => e.tx_id === txId
    );
    const allEvents = [...stxEvents, ...ftEvents, ...nftEvents, ...smartContractEvents].sort(
      e => e.event_index
    );
    return Promise.resolve({ results: allEvents });
  }

  updateStxEvent(tx: DbTx, event: DbStxEvent) {
    this.stxTokenEvents.set(`${event.tx_id}_${tx.block_hash}_${event.event_index}`, { ...event });
    return Promise.resolve();
  }

  updateFtEvent(tx: DbTx, event: DbFtEvent) {
    this.fungibleTokenEvents.set(`${event.tx_id}_${tx.block_hash}_${event.event_index}`, {
      ...event,
    });
    return Promise.resolve();
  }

  updateNftEvent(tx: DbTx, event: DbNftEvent) {
    this.nonFungibleTokenEvents.set(`${event.tx_id}_${tx.block_hash}_${event.event_index}`, {
      ...event,
    });
    return Promise.resolve();
  }

  updateSmartContractEvent(tx: DbTx, event: DbSmartContractEvent) {
    this.smartContractEvents.set(`${event.tx_id}_${tx.block_hash}_${event.event_index}`, {
      ...event,
    });
    return Promise.resolve();
  }

  updateSmartContract(tx: DbTx, smartContract: DbSmartContract) {
    this.smartContracts.set(smartContract.contract_id, { ...smartContract });
    return Promise.resolve();
  }

  getSmartContract(contractId: string) {
    const smartContract = this.smartContracts.get(contractId);
    if (smartContract === undefined) {
      return Promise.resolve({ found: false } as const);
    }
    return Promise.resolve({ found: true, result: smartContract });
  }
}
