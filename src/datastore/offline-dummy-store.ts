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
  DbFtBalance,
  DbMempoolTxId,
} from './common';
import { logger, FoundOrNot } from '../helpers';
import { TransactionType } from '@blockstack/stacks-blockchain-api-types';
import { getTxTypeId } from '../api/controllers/db-controller';
import { RawTxQueryResult } from './postgres-store';

export class OfflineDummyStore extends (EventEmitter as { new (): DataStoreEventEmitter })
  implements DataStore {
  getSubdomainResolver(name: { name: string }): Promise<FoundOrNot<string>> {
    throw new Error('Method not implemented.');
  }
  getUnresolvedSubdomain(tx_id: string): Promise<FoundOrNot<DbBnsSubdomain>> {
    throw new Error('Method not implemented.');
  }
  getBlock(blockHash: string): Promise<FoundOrNot<DbBlock>> {
    throw new Error('Method not implemented.');
  }
  getBlockByHeight(block_height: number): Promise<FoundOrNot<DbBlock>> {
    throw new Error('Method not implemented.');
  }
  getCurrentBlock(): Promise<FoundOrNot<DbBlock>> {
    throw new Error('Method not implemented.');
  }
  getBlocks(args: {
    limit: number;
    offset: number;
  }): Promise<{ results: DbBlock[]; total: number }> {
    throw new Error('Method not implemented.');
  }
  getBlockTxs(indexBlockHash: string): Promise<{ results: string[] }> {
    throw new Error('Method not implemented.');
  }
  getBlockTxsRows(blockHash: string): Promise<FoundOrNot<DbTx[]>> {
    throw new Error('Method not implemented.');
  }
  getTxsFromBlock(
    blockHash: string,
    limit: number,
    offset: number
  ): Promise<{ results: DbTx[]; total: number }> {
    throw new Error('Method not implemented.');
  }
  getMempoolTx(args: {
    txId: string;
    includePruned?: boolean | undefined;
  }): Promise<FoundOrNot<DbMempoolTx>> {
    throw new Error('Method not implemented.');
  }
  getMempoolTxList(args: {
    limit: number;
    offset: number;
    senderAddress?: string | undefined;
    recipientAddress?: string | undefined;
    address?: string | undefined;
  }): Promise<{ results: DbMempoolTx[]; total: number }> {
    throw new Error('Method not implemented.');
  }
  getDroppedTxs(args: {
    limit: number;
    offset: number;
  }): Promise<{ results: DbMempoolTx[]; total: number }> {
    throw new Error('Method not implemented.');
  }
  getMempoolTxIdList(): Promise<{ results: DbMempoolTxId[] }> {
    throw new Error('Method not implemented.');
  }
  getTx(txId: string): Promise<FoundOrNot<DbTx>> {
    throw new Error('Method not implemented.');
  }
  getTxList(args: {
    limit: number;
    offset: number;
    txTypeFilter: TransactionType[];
  }): Promise<{ results: DbTx[]; total: number }> {
    throw new Error('Method not implemented.');
  }
  getTxEvents(args: {
    txId: string;
    indexBlockHash: string;
    limit: number;
    offset: number;
  }): Promise<{ results: DbEvent[] }> {
    throw new Error('Method not implemented.');
  }
  getSmartContract(contractId: string): Promise<FoundOrNot<DbSmartContract>> {
    throw new Error('Method not implemented.');
  }
  getSmartContractEvents(args: {
    contractId: string;
    limit: number;
    offset: number;
  }): Promise<FoundOrNot<DbSmartContractEvent[]>> {
    throw new Error('Method not implemented.');
  }
  update(data: DataStoreUpdateData): Promise<void> {
    throw new Error('Method not implemented.');
  }
  resolveBnsNames(zonefile: string, atch_resolved: boolean, tx_id: string): Promise<void> {
    throw new Error('Method not implemented.');
  }
  resolveBnsSubdomains(data: DbBnsSubdomain[]): Promise<void> {
    throw new Error('Method not implemented.');
  }
  updateMempoolTxs(args: { mempoolTxs: DbMempoolTx[] }): Promise<void> {
    throw new Error('Method not implemented.');
  }
  dropMempoolTxs(args: { status: DbTxStatus; txIds: string[] }): Promise<void> {
    throw new Error('Method not implemented.');
  }
  updateBurnchainRewards(args: {
    burnchainBlockHash: string;
    burnchainBlockHeight: number;
    rewards: DbBurnchainReward[];
  }): Promise<void> {
    throw new Error('Method not implemented.');
  }
  getBurnchainRewards(args: {
    burnchainRecipient?: string | undefined;
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
    burnchainAddress?: string | undefined;
    limit: number;
    offset: number;
  }): Promise<{ total: number; slotHolders: DbRewardSlotHolder[] }> {
    throw new Error('Method not implemented.');
  }
  getStxBalance(stxAddress: string): Promise<DbStxBalance> {
    throw new Error('Method not implemented.');
  }
  getStxBalanceAtBlock(stxAddress: string, blockHeight: number): Promise<DbStxBalance> {
    throw new Error('Method not implemented.');
  }
  getFungibleTokenBalances(stxAddress: string): Promise<Map<string, DbFtBalance>> {
    throw new Error('Method not implemented.');
  }
  getNonFungibleTokenCounts(
    stxAddress: string
  ): Promise<Map<string, { count: bigint; totalSent: bigint; totalReceived: bigint }>> {
    throw new Error('Method not implemented.');
  }
  getUnlockedStxSupply(args: {
    blockHeight?: number | undefined;
  }): Promise<{ stx: bigint; blockHeight: number }> {
    throw new Error('Method not implemented.');
  }
  getBTCFaucetRequests(address: string): Promise<{ results: DbFaucetRequest[] }> {
    throw new Error('Method not implemented.');
  }
  getSTXFaucetRequests(address: string): Promise<{ results: DbFaucetRequest[] }> {
    throw new Error('Method not implemented.');
  }
  getAddressTxs(args: {
    stxAddress: string;
    limit: number;
    offset: number;
    height?: number | undefined;
  }): Promise<{ results: DbTx[]; total: number }> {
    throw new Error('Method not implemented.');
  }
  getAddressAssetEvents(args: {
    stxAddress: string;
    limit: number;
    offset: number;
  }): Promise<{ results: DbEvent[]; total: number }> {
    throw new Error('Method not implemented.');
  }
  getInboundTransfers(args: {
    stxAddress: string;
    limit: number;
    offset: number;
    sendManyContractId: string;
    height?: number | undefined;
  }): Promise<{ results: DbInboundStxTransfer[]; total: number }> {
    throw new Error('Method not implemented.');
  }
  searchHash(args: { hash: string }): Promise<FoundOrNot<DbSearchResult>> {
    throw new Error('Method not implemented.');
  }
  searchPrincipal(args: { principal: string }): Promise<FoundOrNot<DbSearchResult>> {
    throw new Error('Method not implemented.');
  }
  insertFaucetRequest(faucetRequest: DbFaucetRequest): Promise<void> {
    throw new Error('Method not implemented.');
  }
  getRawTx(txId: string): Promise<FoundOrNot<RawTxQueryResult>> {
    throw new Error('Method not implemented.');
  }
  getAddressNFTEvent(args: {
    stxAddress: string;
    limit: number;
    offset: number;
  }): Promise<{ results: AddressNftEventIdentifier[]; total: number }> {
    throw new Error('Method not implemented.');
  }
  getConfigState(): Promise<DbConfigState> {
    throw new Error('Method not implemented.');
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
    blockchain: string;
    address: string;
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
}
