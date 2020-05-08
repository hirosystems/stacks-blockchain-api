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
  readonly blocks: Map<string, { entry: DbBlock }> = new Map();
  readonly txs: Map<string, { entry: DbTx }> = new Map();
  readonly stxTokenEvents: Map<string, { indexBlockHash: string; entry: DbStxEvent }> = new Map();
  readonly fungibleTokenEvents: Map<
    string,
    { indexBlockHash: string; entry: DbFtEvent }
  > = new Map();
  readonly nonFungibleTokenEvents: Map<
    string,
    { indexBlockHash: string; entry: DbNftEvent }
  > = new Map();
  readonly smartContractEvents: Map<
    string,
    { indexBlockHash: string; entry: DbSmartContractEvent }
  > = new Map();
  readonly smartContracts: Map<
    string,
    { indexBlockHash: string; entry: DbSmartContract }
  > = new Map();

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
      b =>
        b.entry.block_height === block.block_height &&
        b.entry.block_hash !== block.block_hash &&
        b.entry.canonical
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
    this.blocks.set(block.block_hash, { entry: blockStored });
    return Promise.resolve();
  }

  updateCanonicalStatus(
    canonicalBlockHeight: number,
    ...maps: Map<unknown, { entry: { block_height: number; canonical: boolean } }>[]
  ) {
    maps.forEach(items => {
      items.forEach(item => {
        if (item.entry.block_height >= canonicalBlockHeight) {
          item.entry.canonical = false;
        }
      });
    });
  }

  getBlock(blockHash: string) {
    const block = this.blocks.get(blockHash);
    if (block === undefined) {
      return Promise.resolve({ found: false } as const);
    }
    return Promise.resolve({ found: true, result: block.entry });
  }

  getBlocks(count = 50) {
    const results = [...this.blocks.values()]
      .filter(b => b.entry.canonical)
      .sort((a, b) => b.entry.block_height - a.entry.block_height)
      .slice(0, count)
      .map(b => b.entry);
    return Promise.resolve({ results });
  }

  updateTx(tx: DbTx) {
    const txStored = { ...tx };
    this.txs.set(tx.tx_id, { entry: txStored });
    return Promise.resolve();
  }

  getTx(txId: string) {
    const tx = this.txs.get(txId);
    if (tx === undefined) {
      return Promise.resolve({ found: false } as const);
    }
    return Promise.resolve({ found: true, result: tx.entry });
  }

  getTxList({ limit, offset }: { limit: number; offset: number }) {
    const transactionsList = [...this.txs.values()];
    const results = transactionsList
      .filter(tx => tx.entry.canonical)
      .sort((a, b) => {
        if (b.entry.block_height === a.entry.block_height) {
          return b.entry.tx_index - a.entry.tx_index;
        }
        return b.entry.block_height - a.entry.block_height;
      })
      .filter((_tx, i) => i >= offset && i <= offset + limit)
      .slice(0, limit)
      .map(t => t.entry);
    return Promise.resolve({ results, total: transactionsList.length });
  }

  getTxEvents(txId: string, indexBlockHash: string) {
    const stxEvents = [...this.stxTokenEvents.values()].filter(
      e => e.indexBlockHash === indexBlockHash && e.entry.tx_id === txId
    );
    const ftEvents = [...this.fungibleTokenEvents.values()].filter(
      e => e.indexBlockHash === indexBlockHash && e.entry.tx_id === txId
    );
    const nftEvents = [...this.nonFungibleTokenEvents.values()].filter(
      e => e.indexBlockHash === indexBlockHash && e.entry.tx_id === txId
    );
    const smartContractEvents = [...this.smartContractEvents.values()].filter(
      e => e.indexBlockHash === indexBlockHash && e.entry.tx_id === txId
    );
    const allEvents = [...stxEvents, ...ftEvents, ...nftEvents, ...smartContractEvents]
      .sort(e => e.entry.event_index)
      .map(e => e.entry);
    return Promise.resolve({ results: allEvents });
  }

  updateStxEvent(tx: DbTx, event: DbStxEvent) {
    this.stxTokenEvents.set(`${event.tx_id}_${tx.index_block_hash}_${event.event_index}`, {
      indexBlockHash: tx.index_block_hash,
      entry: { ...event },
    });
    return Promise.resolve();
  }

  updateFtEvent(tx: DbTx, event: DbFtEvent) {
    this.fungibleTokenEvents.set(`${event.tx_id}_${tx.index_block_hash}_${event.event_index}`, {
      indexBlockHash: tx.index_block_hash,
      entry: { ...event },
    });
    return Promise.resolve();
  }

  updateNftEvent(tx: DbTx, event: DbNftEvent) {
    this.nonFungibleTokenEvents.set(`${event.tx_id}_${tx.index_block_hash}_${event.event_index}`, {
      indexBlockHash: tx.index_block_hash,
      entry: { ...event },
    });
    return Promise.resolve();
  }

  updateSmartContractEvent(tx: DbTx, event: DbSmartContractEvent) {
    this.smartContractEvents.set(`${event.tx_id}_${tx.index_block_hash}_${event.event_index}`, {
      indexBlockHash: tx.index_block_hash,
      entry: { ...event },
    });
    return Promise.resolve();
  }

  updateSmartContract(tx: DbTx, smartContract: DbSmartContract) {
    this.smartContracts.set(smartContract.contract_id, {
      indexBlockHash: tx.index_block_hash,
      entry: { ...smartContract },
    });
    return Promise.resolve();
  }

  getSmartContract(contractId: string) {
    const entries = [...this.smartContracts.values()]
      .filter(e => e.entry.contract_id === contractId)
      .sort((a, b) => Number(b.entry.canonical) - Number(a.entry.canonical));
    if (entries.length < 1) {
      return Promise.resolve({ found: false } as const);
    }
    return Promise.resolve({ found: true, result: entries[0].entry });
  }
}
