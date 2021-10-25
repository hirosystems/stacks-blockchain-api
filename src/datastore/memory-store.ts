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
  DataStoreBlockUpdateData,
  DbFaucetRequest,
  DbEvent,
  DbFaucetRequestCurrency,
  DbMempoolTx,
  DbSearchResult,
  DbStxBalance,
  DbStxLockEvent,
  DbBurnchainReward,
  DbInboundStxTransfer,
  DbTxStatus,
  AddressNftEventIdentifier,
  DbRewardSlotHolder,
  DbBnsName,
  DbBnsNamespace,
  DbBnsZoneFile,
  DbBnsSubdomain,
  DbConfigState,
  DbMinerReward,
  DbTxWithAssetTransfers,
  DataStoreMicroblockUpdateData,
  DbMicroblock,
  DbGetBlockWithMetadataOpts,
  DbGetBlockWithMetadataResponse,
  BlockIdentifier,
  StxUnlockEvent,
  DbFungibleTokenMetadata,
  DbNonFungibleTokenMetadata,
  DbTokenMetadataQueueEntry,
} from './common';
import { logger, FoundOrNot } from '../helpers';
import { AddressTokenOfferingLocked, TransactionType } from '@stacks/stacks-blockchain-api-types';
import { getTxTypeId } from '../api/controllers/db-controller';
import { RawTxQueryResult } from './postgres-store';

export class MemoryDataStore
  extends (EventEmitter as { new (): DataStoreEventEmitter })
  implements DataStore {
  readonly blocks: Map<string, { entry: DbBlock }> = new Map();
  readonly txs: Map<string, { entry: DbTx }> = new Map();
  readonly txMempool: Map<string, DbMempoolTx> = new Map();
  readonly stxLockEvents: Map<
    string,
    { indexBlockHash: string; entry: DbStxLockEvent }
  > = new Map();
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
  readonly faucetRequests: DbFaucetRequest[] = [];

  storeRawEventRequest(eventPath: string, payload: string): Promise<void> {
    throw new Error('not implemented');
  }

  async update(data: DataStoreBlockUpdateData) {
    await this.updateBlock(data.block);
    for (const entry of data.txs) {
      await this.updateTx(entry.tx);
      for (const stxLockEvent of entry.stxLockEvents) {
        await this.updateStxLockEvent(entry.tx, stxLockEvent);
      }
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
    this.emit('blockUpdate', data.block.block_hash);
    data.txs.forEach(entry => {
      this.emit('txUpdate', entry.tx.tx_id);
    });
  }

  updateMicroblocks(data: DataStoreMicroblockUpdateData): Promise<void> {
    throw new Error('Method not implemented.');
  }

  getNameCanonical(txId: string, indexBlockHash: string): Promise<FoundOrNot<boolean>> {
    throw new Error('Method not implemented.');
  }
  updateZoneContent(zonefile: string, zonefile_hash: string, tx_id: string): Promise<void> {
    throw new Error('Method not implemented.');
  }
  resolveBnsSubdomains(
    blockData: {
      index_block_hash: string;
      parent_index_block_hash: string;
      microblock_hash: string;
      microblock_sequence: number;
      microblock_canonical: boolean;
    },
    data: DbBnsSubdomain[]
  ): Promise<void> {
    throw new Error('Method not implemented.');
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
      logger.warn(`Detected reorg event at block height ${canonicalHeight}`);
      this.updateCanonicalStatus(
        canonicalHeight,
        this.blocks,
        this.txs,
        this.smartContractEvents,
        this.stxLockEvents,
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

  getBlockWithMetadata<TWithTxs extends boolean, TWithMicroblocks extends boolean>(
    blockIdentifer: BlockIdentifier,
    metadata?: DbGetBlockWithMetadataOpts<TWithTxs, TWithMicroblocks>
  ): Promise<FoundOrNot<DbGetBlockWithMetadataResponse<TWithTxs, TWithMicroblocks>>> {
    throw new Error('Method not implemented.');
  }

  getBlock(blockIdentifer: BlockIdentifier): Promise<FoundOrNot<DbBlock>> {
    if ('hash' in blockIdentifer) {
      const block = this.blocks.get(blockIdentifer.hash);
      if (!block) {
        return Promise.resolve({ found: false });
      }
      return Promise.resolve({ found: true, result: block.entry });
    } else if ('height' in blockIdentifer) {
      const block = [...this.blocks.values()].find(
        b => b.entry.block_height === blockIdentifer.height
      );
      if (!block) {
        return Promise.resolve({ found: false });
      }
      return Promise.resolve({ found: true, result: block.entry });
    } else if ('burnBlockHash' in blockIdentifer) {
      const block = [...this.blocks.values()].find(
        b => b.entry.burn_block_hash === blockIdentifer.burnBlockHash
      );
      if (!block) {
        return Promise.resolve({ found: false });
      }
      return Promise.resolve({ found: true, result: block.entry });
    } else {
      const block = [...this.blocks.values()].find(
        b => b.entry.burn_block_height === blockIdentifer.burnBlockHeight
      );
      if (!block) {
        return Promise.resolve({ found: false });
      }
      return Promise.resolve({ found: true, result: block.entry });
    }
  }

  getCurrentBlock(): Promise<FoundOrNot<DbBlock>> {
    throw new Error('not yet implemented');
  }

  getCurrentBlockHeight(): Promise<FoundOrNot<number>> {
    throw new Error('not yet implemented');
  }

  getMicroblocks(args: {
    limit: number;
    offset: number;
  }): Promise<{ result: { microblock: DbMicroblock; txs: string[] }[]; total: number }> {
    throw new Error('not implemented');
  }

  getMicroblock(args: {
    microblockHash: string;
  }): Promise<FoundOrNot<{ microblock: DbMicroblock; txs: string[] }>> {
    throw new Error('Method not implemented.');
  }

  getUnanchoredTxs(): Promise<{ txs: DbTx[] }> {
    throw new Error('Method not implemented.');
  }

  getBlocks({ limit, offset }: { limit: number; offset: number }) {
    const blockList = [...this.blocks.values()].filter(b => b.entry.canonical);
    const results = blockList
      .sort((a, b) => b.entry.block_height - a.entry.block_height)
      .filter((_tx, i) => i >= offset && i <= offset + limit)
      .slice(0, limit)
      .map(b => b.entry);
    return Promise.resolve({ results, total: blockList.length });
  }

  getBlockTxsRows(blockHash: string): Promise<FoundOrNot<DbTx[]>> {
    throw new Error('not yet implemented');
  }

  getBlockTxs(indexBlockHash: string) {
    const results = [...this.txs.values()]
      .filter(tx => tx.entry.index_block_hash === indexBlockHash)
      .map(tx => tx.entry.tx_id);
    return Promise.resolve({ results: results });
  }

  updateBurnchainRewards(args: {
    burnchainBlockHash: string;
    burnchainBlockHeight: number;
    rewards: DbBurnchainReward[];
  }): Promise<void> {
    throw new Error('Method not implemented.');
  }

  getBurnchainRewards(args: {
    burnchainRecipient?: string;
    limit: number;
    offset: number;
  }): Promise<DbBurnchainReward[]> {
    throw new Error('Method not implemented.');
  }

  getBurnchainRewardsTotal(
    burnchainRecipient: string
  ): Promise<{ reward_recipient: string; reward_amount: bigint }> {
    throw new Error('Method not implemented.');
  }

  updateBurnchainRewardSlotHolders(args: {
    burnchainBlockHash: string;
    burnchainBlockHeight: number;
    slotHolders: DbRewardSlotHolder[];
  }): Promise<void> {
    throw new Error('Method not implemented.');
  }

  getBurnchainRewardSlotHolders(args: {
    burnchainAddress?: string;
    limit: number;
    offset: number;
  }): Promise<{ total: number; slotHolders: DbRewardSlotHolder[] }> {
    throw new Error('Method not implemented.');
  }

  updateTx(tx: DbTx) {
    const txStored = { ...tx };
    this.txs.set(tx.tx_id, { entry: txStored });
    return Promise.resolve();
  }

  updateMempoolTxs({ mempoolTxs: txs }: { mempoolTxs: DbMempoolTx[] }): Promise<void> {
    txs.forEach(tx => {
      this.txMempool.set(tx.tx_id, tx);
      this.emit('txUpdate', tx.tx_id);
    });
    return Promise.resolve();
  }

  dropMempoolTxs(args: { status: DbTxStatus; txIds: string[] }): Promise<void> {
    args.txIds.forEach(txId => {
      const tx = this.txMempool.get(txId);
      if (tx) {
        tx.status = args.status;
        this.txMempool.set(txId, tx);
        this.emit('txUpdate', tx.tx_id);
      }
    });
    return Promise.resolve();
  }

  getMempoolTx({ txId }: { txId: string; includePruned?: boolean }) {
    const tx = this.txMempool.get(txId);
    if (tx === undefined) {
      return Promise.resolve({ found: false } as const);
    }
    return Promise.resolve({ found: true, result: tx });
  }

  getMempoolTxs(args: {
    txIds: string[];
    includeUnanchored: boolean;
    includePruned?: boolean;
  }): Promise<DbMempoolTx[]> {
    throw new Error('not yet implemented');
  }

  getDroppedTxs(args: {
    limit: number;
    offset: number;
  }): Promise<{ results: DbMempoolTx[]; total: number }> {
    throw new Error('not yet implemented');
  }

  getMempoolTxList(args: {
    limit: number;
    offset: number;
  }): Promise<{ results: DbMempoolTx[]; total: number }> {
    throw new Error('not yet implemented');
  }

  getTxStrict(args: { txId: string; indexBlockHash: string }): Promise<FoundOrNot<DbTx>> {
    throw new Error('not implemented');
  }

  getTx(args: { txId: string; includeUnanchored: boolean }) {
    const tx = this.txs.get(args.txId);
    if (tx === undefined) {
      return Promise.resolve({ found: false } as const);
    }
    return Promise.resolve({ found: true, result: tx.entry });
  }

  getTxList({
    limit,
    offset,
    txTypeFilter,
  }: {
    limit: number;
    offset: number;
    txTypeFilter: TransactionType[];
  }) {
    let transactionsList = [...this.txs.values()].filter(tx => tx.entry.canonical);
    if (txTypeFilter.length > 0) {
      const typeIds = txTypeFilter.map(t => getTxTypeId(t));
      transactionsList = transactionsList.filter(tx => typeIds.includes(tx.entry.type_id));
    }
    const results = transactionsList
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

  getTxListEvents(args: {
    txs: {
      txId: string;
      indexBlockHash: string;
    }[];
    limit: number;
    offset: number;
  }): Promise<{ results: DbEvent[] }> {
    throw new Error('not implemented');
  }

  getTxListDetails(args: { txIds: string[]; includeUnanchored: boolean }): Promise<DbTx[]> {
    throw new Error('not implemented');
  }

  getSmartContractList(contractIds: string[]): Promise<DbSmartContract[]> {
    throw new Error('not implemented');
  }

  getTxEvents(args: { txId: string; indexBlockHash: string; limit: number; offset: number }) {
    const stxLockEvents = [...this.stxLockEvents.values()].filter(
      e => e.indexBlockHash === args.indexBlockHash && e.entry.tx_id === args.txId
    );
    const stxEvents = [...this.stxTokenEvents.values()].filter(
      e => e.indexBlockHash === args.indexBlockHash && e.entry.tx_id === args.txId
    );
    const ftEvents = [...this.fungibleTokenEvents.values()].filter(
      e => e.indexBlockHash === args.indexBlockHash && e.entry.tx_id === args.txId
    );
    const nftEvents = [...this.nonFungibleTokenEvents.values()].filter(
      e => e.indexBlockHash === args.indexBlockHash && e.entry.tx_id === args.txId
    );
    const smartContractEvents = [...this.smartContractEvents.values()].filter(
      e => e.indexBlockHash === args.indexBlockHash && e.entry.tx_id === args.txId
    );
    const allEvents = [
      ...stxLockEvents,
      ...stxEvents,
      ...ftEvents,
      ...nftEvents,
      ...smartContractEvents,
    ]
      .sort(e => e.entry.event_index)
      .map(e => e.entry);
    return Promise.resolve({ results: allEvents });
  }

  updateStxLockEvent(tx: DbTx, event: DbStxLockEvent) {
    this.stxLockEvents.set(`${event.tx_id}_${tx.index_block_hash}_${event.event_index}`, {
      indexBlockHash: tx.index_block_hash,
      entry: { ...event },
    });
    return Promise.resolve();
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

  getSmartContractEvents(args: {
    contractId: string;
    limit: number;
    offset: number;
  }): Promise<FoundOrNot<DbSmartContractEvent[]>> {
    throw new Error('not yet implemented');
  }

  getStxBalance(args: { stxAddress: string; includeUnanchored: boolean }): Promise<DbStxBalance> {
    throw new Error('not yet implemented');
  }

  getStxBalanceAtBlock(stxAddress: string, blockHeight: number): Promise<DbStxBalance> {
    throw new Error('not yet implemented');
  }

  getFungibleTokenBalances(args: {
    stxAddress: string;
    atBlock: number;
  }): Promise<Map<string, DbStxBalance>> {
    throw new Error('not yet implemented');
  }

  getNonFungibleTokenCounts(args: {
    stxAddress: string;
    atBlock: number;
  }): Promise<Map<string, { count: bigint; totalSent: bigint; totalReceived: bigint }>> {
    throw new Error('not yet implemented');
  }

  getAddressTxs(args: {
    stxAddress: string;
    blockHeight: number;
    atSingleBlock: boolean;
    limit: number;
    offset: number;
  }): Promise<{ results: DbTx[]; total: number }> {
    throw new Error('not yet implemented');
  }

  getInformationTxsWithStxTransfers(args: {
    stxAddress: string;
    tx_id: string;
  }): Promise<DbTxWithAssetTransfers> {
    throw new Error('not yet implemented');
  }

  getAddressTxsWithAssetTransfers(args: {
    stxAddress: string;
    blockHeight: number;
    atSingleBlock: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ results: DbTxWithAssetTransfers[]; total: number }> {
    throw new Error('not yet implemented');
  }

  getAddressAssetEvents(args: {
    stxAddress: string;
    blockHeight: number;
    limit: number;
    offset: number;
  }): Promise<{ results: DbEvent[]; total: number }> {
    throw new Error('not yet implemented');
  }

  getAddressNonces(args: {
    stxAddress: string;
  }): Promise<{
    lastExecutedTxNonce: number | null;
    lastMempoolTxNonce: number | null;
    possibleNextNonce: number;
    detectedMissingNonces: number[];
  }> {
    throw new Error('not yet implemented');
  }

  getInboundTransfers(args: {
    stxAddress: string;
    blockHeight: number;
    atSingleBlock: boolean;
    limit: number;
    offset: number;
    sendManyContractId: string;
  }): Promise<{ results: DbInboundStxTransfer[]; total: number }> {
    throw new Error('not yet implemented');
  }

  searchHash(args: { hash: string }): Promise<FoundOrNot<DbSearchResult>> {
    throw new Error('not yet implemented');
  }

  searchPrincipal(args: { principal: string }): Promise<FoundOrNot<DbSearchResult>> {
    throw new Error('not yet implemented');
  }

  insertFaucetRequest(faucetRequest: DbFaucetRequest) {
    this.faucetRequests.push({ ...faucetRequest });
    return Promise.resolve();
  }

  getUnlockedStxSupply(
    args:
      | {
          blockHeight: number;
        }
      | { includeUnanchored: boolean }
  ): Promise<{ stx: bigint; blockHeight: number }> {
    throw new Error('Method not implemented.');
  }

  getBTCFaucetRequests(address: string) {
    const request = this.faucetRequests
      .filter(f => f.address === address)
      .filter(f => f.currency === DbFaucetRequestCurrency.BTC)
      .sort((a, b) => b.occurred_at - a.occurred_at)
      .slice(0, 5);
    return Promise.resolve({ results: request });
  }

  getSTXFaucetRequests(address: string) {
    const request = this.faucetRequests
      .filter(f => f.address === address)
      .filter(f => f.currency === DbFaucetRequestCurrency.STX)
      .sort((a, b) => b.occurred_at - a.occurred_at)
      .slice(0, 5);
    return Promise.resolve({ results: request });
  }

  getRawTx(txId: string): Promise<FoundOrNot<RawTxQueryResult>> {
    throw new Error('Method not implemented.');
  }

  getAddressNFTEvent(args: {
    stxAddress: string;
    blockHeight: number;
    limit: number;
    offset: number;
  }): Promise<{ results: AddressNftEventIdentifier[]; total: number }> {
    throw new Error('Method not implemented.');
  }

  getConfigState(): Promise<DbConfigState> {
    return Promise.resolve({
      bns_names_onchain_imported: false,
      bns_subdomains_imported: false,
      token_offering_imported: false,
    });
  }

  updateConfigState(configState: DbConfigState): Promise<void> {
    throw new Error('Method not implemented.');
  }

  getNamespaceList(): Promise<{ results: string[] }> {
    throw new Error('Method not implemented.');
  }

  getNamespaceNamesList(args: { namespace: string; page: number }): Promise<{ results: string[] }> {
    throw new Error('Method not implemented.');
  }

  getNamespace(args: { namespace: string }): Promise<FoundOrNot<DbBnsNamespace>> {
    throw new Error('Method not implemented.');
  }

  getName(args: { name: string }): Promise<FoundOrNot<DbBnsName>> {
    throw new Error('Method not implemented.');
  }

  getHistoricalZoneFile(args: {
    name: string;
    zoneFileHash: string;
  }): Promise<FoundOrNot<DbBnsZoneFile>> {
    throw new Error('Method not implemented.');
  }

  getLatestZoneFile(args: { name: string }): Promise<FoundOrNot<DbBnsZoneFile>> {
    throw new Error('Method not implemented.');
  }

  getNamesByAddressList(args: {
    address: string;
    includeUnanchored: boolean;
  }): Promise<FoundOrNot<string[]>> {
    throw new Error('Method not implemented.');
  }

  getNamesList(args: { page: number }): Promise<{ results: string[] }> {
    throw new Error('Method not implemented.');
  }

  getSubdomainsList(args: { page: number }): Promise<{ results: string[] }> {
    throw new Error('Method not implemented.');
  }

  getSubdomain(args: { subdomain: string }): Promise<FoundOrNot<DbBnsSubdomain>> {
    throw new Error('Method not implemented.');
  }

  getSubdomainResolver(name: { name: string }): Promise<FoundOrNot<string>> {
    throw new Error('Method not implemented.');
  }

  getTxsFromBlock(
    blockHash: string,
    limit: number,
    offset: number
  ): Promise<{ results: DbTx[]; total: number }> {
    throw new Error('Method not implemented');
  }
  getMinersRewardsAtHeight({ blockHeight }: { blockHeight: number }): Promise<DbMinerReward[]> {
    return Promise.resolve([]);
  }
  getTokenOfferingLocked(
    address: string,
    blockHeight: number
  ): Promise<FoundOrNot<AddressTokenOfferingLocked>> {
    throw new Error('Method not implemented');
  }

  getUnlockedAddressesAtBlock(block: DbBlock): Promise<StxUnlockEvent[]> {
    throw new Error('Method not implemented');
  }

  close() {
    return Promise.resolve();
  }
  getFtMetadata(contractId: string): Promise<FoundOrNot<DbFungibleTokenMetadata>> {
    throw new Error('Method not implemented.');
  }
  getNftMetadata(contractId: string): Promise<FoundOrNot<DbNonFungibleTokenMetadata>> {
    throw new Error('Method not implemented.');
  }
  updateNFtMetadata(nftMetadata: DbNonFungibleTokenMetadata): Promise<number> {
    throw new Error('Method not implemented.');
  }
  updateFtMetadata(ftMetadata: DbFungibleTokenMetadata): Promise<number> {
    throw new Error('Method not implemented.');
  }

  getFtMetadataList(args: {
    limit: number;
    offset: number;
  }): Promise<{ results: DbFungibleTokenMetadata[]; total: number }> {
    throw new Error('Method not implemented.');
  }

  getNftMetadataList(args: {
    limit: number;
    offset: number;
  }): Promise<{ results: DbNonFungibleTokenMetadata[]; total: number }> {
    throw new Error('Method not implemented.');
  }

  getTokenMetadataQueue(
    _limit: number,
    _excludingEntries: number[]
  ): Promise<DbTokenMetadataQueueEntry[]> {
    throw new Error('Method not implemented.');
  }
}
