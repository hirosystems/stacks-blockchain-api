import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import StrictEventEmitter from 'strict-event-emitter-types';
import { hexToBuffer, parseEnum, FoundOrNot } from '../helpers';
import {
  CoreNodeDropMempoolTxReasonType,
  CoreNodeParsedTxMessage,
  CoreNodeTxStatus,
} from '../event-stream/core-node-message';
import {
  DecodedTxResult,
  PrincipalTypeID,
  TxPayloadTypeID,
  PostConditionAuthFlag,
} from 'stacks-encoding-native-js';
import { AddressTokenOfferingLocked, TransactionType } from '@stacks/stacks-blockchain-api-types';
import { getTxSenderAddress } from '../event-stream/reader';
import { RawTxQueryResult } from './postgres-store';
import { ChainID, ClarityAbi } from '@stacks/transactions';
import { Block } from '@stacks/stacks-blockchain-api-types';

export interface DbBlock {
  block_hash: string;
  burn_block_time: number;
  burn_block_hash: string;
  burn_block_height: number;
  miner_txid: string;
  index_block_hash: string;
  parent_index_block_hash: string;
  parent_block_hash: string;
  parent_microblock_hash: string;
  parent_microblock_sequence: number;
  block_height: number;
  /** Set to `true` if entry corresponds to the canonical chain tip */
  canonical: boolean;
  /**  Sum of the execution costs for each tx included in the block */
  execution_cost_read_count: number;
  execution_cost_read_length: number;
  execution_cost_runtime: number;
  execution_cost_write_count: number;
  execution_cost_write_length: number;
}

/** An interface representing the microblock data that can be constructed _only_ from the /new_microblocks payload */
export interface DbMicroblockPartial {
  microblock_hash: string;
  microblock_sequence: number;
  microblock_parent_hash: string;
  parent_index_block_hash: string;
  parent_burn_block_time: number;
  parent_burn_block_hash: string;
  parent_burn_block_height: number;
}

export interface DbMicroblock extends DbMicroblockPartial {
  canonical: boolean;
  microblock_canonical: boolean;
  block_height: number;
  parent_block_height: number;
  parent_block_hash: string;
  index_block_hash: string;
  block_hash: string;
}

export interface DbBurnchainReward {
  canonical: boolean;
  burn_block_hash: string;
  burn_block_height: number;
  burn_amount: bigint;
  reward_recipient: string;
  reward_amount: bigint;
  reward_index: number;
}

export interface DbRewardSlotHolder {
  canonical: boolean;
  burn_block_hash: string;
  burn_block_height: number;
  address: string;
  slot_index: number;
}

export interface DbMinerReward {
  block_hash: string;
  index_block_hash: string;
  from_index_block_hash: string;
  mature_block_height: number;
  /** Set to `true` if entry corresponds to the canonical chain tip */
  canonical: boolean;
  /** STX principal */
  recipient: string;
  coinbase_amount: bigint;
  tx_fees_anchored: bigint;
  tx_fees_streamed_confirmed: bigint;
  tx_fees_streamed_produced: bigint;
}

export enum DbTxTypeId {
  TokenTransfer = 0x00,
  SmartContract = 0x01,
  ContractCall = 0x02,
  PoisonMicroblock = 0x03,
  Coinbase = 0x04,
}

export enum DbTxStatus {
  Pending = 0,
  Success = 1,
  AbortByResponse = -1,
  AbortByPostCondition = -2,
  /** Replaced by a transaction with the same nonce, but a higher fee. */
  DroppedReplaceByFee = -10,
  /** Replaced by a transaction with the same nonce but in the canonical fork. */
  DroppedReplaceAcrossFork = -11,
  /** The transaction is too expensive to include in a block. */
  DroppedTooExpensive = -12,
  /** Transaction was dropped because it became stale. */
  DroppedStaleGarbageCollect = -13,
  /** Dropped by the API (even though the Stacks node hadn't dropped it) because it exceeded maximum mempool age */
  DroppedApiGarbageCollect = -14,
}

export enum DbTxAnchorMode {
  OnChainOnly = 0x01,
  OffChainOnly = 0x02,
  Any = 0x03,
}

export interface BaseTx {
  /** u64 */
  fee_rate: bigint;
  sender_address: string;
  sponsored: boolean;
  sponsor_address?: string;
  sponsor_nonce?: number;
  nonce: number;
  tx_id: string;
  anchor_mode: DbTxAnchorMode;
  /** Only valid for `token_transfer` tx types. */
  token_transfer_recipient_address?: string;
  /** 64-bit unsigned integer. */
  token_transfer_amount?: bigint;
  // TODO(perf): use hex string since that is what we already get from deserializing event payloads
  //   and from the pg-node adapter (all the pg js libs use text mode rather than binary mode)
  /** Hex encoded arbitrary message, up to 34 bytes length (should try decoding to an ASCII string). */
  token_transfer_memo?: Buffer;
  status: DbTxStatus;
  type_id: DbTxTypeId;
  /** Only valid for `contract_call` tx types */
  contract_call_contract_id?: string;
  contract_call_function_name?: string;
  // TODO(perf): use hex string since that is what we already get from deserializing event payloads
  //   and from the pg-node adapter (all the pg js libs use text mode rather than binary mode)
  /** Hex encoded Clarity values. Undefined if function defines no args. */
  contract_call_function_args?: Buffer;
  abi?: string;
}

export interface DbTx extends BaseTx {
  index_block_hash: string;
  parent_index_block_hash: string;
  block_hash: string;
  parent_block_hash: string;
  block_height: number;
  burn_block_time: number;
  parent_burn_block_time: number;

  raw_tx: Buffer;
  tx_index: number;

  /** Hex encoded Clarity values. */
  raw_result: string;

  /** Set to `true` if entry corresponds to the canonical chain tip */
  canonical: boolean;

  microblock_canonical: boolean;
  // TODO(mb): should probably be (number | null) rather than -1 for batched tx
  microblock_sequence: number;
  // TODO(mb): should probably be (string | null) rather than empty string for batched tx
  microblock_hash: string;

  // TODO(perf): use hex string since that is what we already get from deserializing event payloads
  // and from the pg-node adapter (all the pg js libs use text mode rather than binary mode)
  post_conditions: Buffer;

  /** u8 */
  origin_hash_mode: number;

  /** Only valid for `smart_contract` tx types. */
  smart_contract_contract_id?: string;
  smart_contract_source_code?: string;

  /** Only valid for `poison_microblock` tx types. */
  poison_microblock_header_1?: Buffer;
  poison_microblock_header_2?: Buffer;

  /** Only valid for `coinbase` tx types. Hex encoded 32-bytes. */
  coinbase_payload?: Buffer;

  event_count: number;

  execution_cost_read_count: number;
  execution_cost_read_length: number;
  execution_cost_runtime: number;
  execution_cost_write_count: number;
  execution_cost_write_length: number;
}

export interface DbMempoolTx extends BaseTx {
  pruned: boolean;
  raw_tx: Buffer;

  receipt_time: number;

  post_conditions: Buffer;
  /** u8 */
  origin_hash_mode: number;

  /** Only valid for `smart_contract` tx types. */
  smart_contract_contract_id?: string;
  smart_contract_source_code?: string;

  /** Only valid for `poison_microblock` tx types. */
  poison_microblock_header_1?: Buffer;
  poison_microblock_header_2?: Buffer;

  /** Only valid for `coinbase` tx types. Hex encoded 32-bytes. */
  coinbase_payload?: Buffer;
}

export interface DbMempoolTxId {
  tx_id: string;
}

export interface DbSmartContract {
  tx_id: string;
  canonical: boolean;
  contract_id: string;
  block_height: number;
  source_code: string;
  abi: string | null;
}

export enum DbFaucetRequestCurrency {
  BTC = 'btc',
  STX = 'stx',
}

export interface DbFaucetRequest {
  currency: DbFaucetRequestCurrency;
  address: string;
  ip: string;
  occurred_at: number;
}

export enum DbEventTypeId {
  SmartContractLog = 1,
  StxAsset = 2,
  FungibleTokenAsset = 3,
  NonFungibleTokenAsset = 4,
  StxLock = 5,
}

export interface DbEventBase {
  event_index: number;
  tx_id: string;
  tx_index: number;
  block_height: number;
  /** Set to `true` if entry corresponds to the canonical chain tip */
  canonical: boolean;
}

export interface DbSmartContractEvent extends DbEventBase {
  event_type: DbEventTypeId.SmartContractLog;
  contract_identifier: string;
  topic: string;
  value: Buffer;
}

export interface DbStxLockEvent extends DbEventBase {
  event_type: DbEventTypeId.StxLock;
  locked_amount: BigInt;
  unlock_height: number;
  locked_address: string;
}

export enum DbAssetEventTypeId {
  Transfer = 1,
  Mint = 2,
  Burn = 3,
}

interface DbAssetEvent extends DbEventBase {
  asset_event_type_id: DbAssetEventTypeId;
  sender?: string;
  recipient?: string;
}

export interface DbStxEvent extends DbAssetEvent {
  event_type: DbEventTypeId.StxAsset;
  amount: bigint;
}

interface DbContractAssetEvent extends DbAssetEvent {
  asset_identifier: string;
}

export interface DbFtEvent extends DbContractAssetEvent {
  event_type: DbEventTypeId.FungibleTokenAsset;
  /** unsigned 128-bit integer */
  amount: bigint;
}

export interface DbNftEvent extends DbContractAssetEvent {
  event_type: DbEventTypeId.NonFungibleTokenAsset;
  // TODO(perf): use hex string since that is what we already get from deserializing event payloads
  //   and from the pg-node adapter (all the pg js libs use text mode rather than binary mode)
  /** Raw Clarity value */
  value: Buffer;
}

export interface StxUnlockEvent {
  tx_id: string;
  unlock_height: string;
  stacker_address: string;
  unlocked_amount: string;
}

export type DbEvent = DbSmartContractEvent | DbStxEvent | DbStxLockEvent | DbFtEvent | DbNftEvent;

export interface DbTxWithAssetTransfers {
  tx: DbTx;
  stx_sent: bigint;
  stx_received: bigint;
  stx_transfers: {
    amount: bigint;
    sender?: string;
    recipient?: string;
  }[];
  ft_transfers: {
    asset_identifier: string;
    amount: bigint;
    sender?: string;
    recipient?: string;
  }[];
  nft_transfers: {
    asset_identifier: string;
    // TODO(perf): use hex string since that is what we already get from deserializing event payloads
    //   and from the pg-node adapter (all the pg js libs use text mode rather than binary mode)
    value: Buffer;
    sender?: string;
    recipient?: string;
  }[];
}

export interface NftHoldingInfo {
  asset_identifier: string;
  // TODO(perf): use hex string since that is what we already get from deserializing event payloads
  //   and from the pg-node adapter (all the pg js libs use text mode rather than binary mode)
  value: Buffer;
  block_height: number;
  recipient: string;
  tx_id: Buffer;
}

export interface NftHoldingInfoWithTxMetadata {
  nft_holding_info: NftHoldingInfo;
  tx?: DbTx;
}

export interface NftEventWithTxMetadata {
  nft_event: DbNftEvent;
  tx?: DbTx;
}

export interface AddressNftEventIdentifier {
  sender: string;
  recipient: string;
  asset_identifier: string;
  // TODO(perf): use hex string since that is what we already get from deserializing event payloads
  //   and from the pg-node adapter (all the pg js libs use text mode rather than binary mode)
  value: Buffer;
  block_height: number;
  tx_id: Buffer;
}

export interface TokenMetadataUpdateInfo {
  queueId: number;
  txId: string;
  contractId: string;
}

export type DataStoreEventEmitter = StrictEventEmitter<
  EventEmitter,
  {
    txUpdate: (txId: string) => void;
    blockUpdate: (blockHash: string) => void;
    microblockUpdate: (microblockHash: string) => void;
    addressUpdate: (address: string, blockHeight: number) => void;
    nameUpdate: (info: string) => void;
    tokensUpdate: (contractID: string) => void;
    tokenMetadataUpdateQueued: (queueId: number) => void;
  }
>;

export interface DataStoreBlockUpdateData {
  block: DbBlock;
  microblocks: DbMicroblock[];
  minerRewards: DbMinerReward[];
  txs: DataStoreTxEventData[];
}

export interface DataStoreMicroblockUpdateData {
  microblocks: DbMicroblockPartial[];
  txs: DataStoreTxEventData[];
}

export interface DataStoreTxEventData {
  tx: DbTx;
  stxEvents: DbStxEvent[];
  stxLockEvents: DbStxLockEvent[];
  ftEvents: DbFtEvent[];
  nftEvents: DbNftEvent[];
  contractLogEvents: DbSmartContractEvent[];
  smartContracts: DbSmartContract[];
  names: DbBnsName[];
  namespaces: DbBnsNamespace[];
}

export interface DataStoreAttachmentData {
  op: string;
  name: string;
  namespace: string;
  zonefile: string;
  zonefileHash: string;
  txId: string;
  indexBlockHash: string;
  blockHeight: number;
}

export interface DataStoreBnsBlockData {
  index_block_hash: string;
  parent_index_block_hash: string;
  microblock_hash: string;
  microblock_sequence: number;
  microblock_canonical: boolean;
}

export interface DataStoreAttachmentSubdomainData {
  attachment?: DataStoreAttachmentData;
  blockData?: DataStoreBnsBlockData;
  subdomains?: DbBnsSubdomain[];
}

export interface DbSearchResult {
  entity_type: 'standard_address' | 'contract_address' | 'block_hash' | 'tx_id' | 'mempool_tx_id';
  entity_id: string;
  entity_data?: DbBlock | DbMempoolTx | DbTx;
}

export interface DbSearchResultWithMetadata {
  entity_type: 'standard_address' | 'contract_address' | 'block_hash' | 'tx_id' | 'mempool_tx_id';
  entity_id: string;
  entity_data?: Block | DbMempoolTx | DbTx;
}

export interface DbFtBalance {
  balance: bigint;
  totalSent: bigint;
  totalReceived: bigint;
}

export interface DbStxBalance {
  balance: bigint;
  totalSent: bigint;
  totalReceived: bigint;
  totalFeesSent: bigint;
  totalMinerRewardsReceived: bigint;
  lockTxId: string;
  locked: bigint;
  lockHeight: number;
  burnchainLockHeight: number;
  burnchainUnlockHeight: number;
}

export interface DbInboundStxTransfer {
  sender: string;
  amount: bigint;
  memo: string;
  block_height: number;
  tx_id: string;
  transfer_type: string;
  tx_index: number;
}

export interface DbBnsZoneFile {
  zonefile: string;
}

export interface DbBnsNamespace {
  id?: number;
  namespace_id: string;
  address: string;
  launched_at?: number;
  reveal_block: number;
  ready_block: number;
  buckets: string;
  base: bigint;
  coeff: bigint;
  nonalpha_discount: number;
  no_vowel_discount: number;
  lifetime: number;
  status?: string;
  tx_id: string;
  tx_index: number;
  canonical: boolean;
}

export interface DbBnsName {
  id?: number;
  name: string;
  address: string;
  namespace_id: string;
  registered_at: number;
  expire_block: number;
  grace_period?: number;
  renewal_deadline?: number;
  resolver?: string | undefined;
  zonefile: string;
  zonefile_hash: string;
  tx_id: string;
  tx_index: number;
  status?: string;
  canonical: boolean;
}

export interface DbBnsSubdomain {
  id?: number;
  name: string;
  namespace_id: string;
  fully_qualified_subdomain: string;
  owner: string;
  zonefile: string;
  zonefile_hash: string;
  parent_zonefile_hash: string;
  parent_zonefile_index: number;
  block_height: number;
  zonefile_offset: number;
  resolver: string;
  tx_id: string;
  tx_index: number;
  canonical: boolean;
}

export interface DbConfigState {
  bns_names_onchain_imported: boolean;
  bns_subdomains_imported: boolean;
  token_offering_imported: boolean;
}

export interface DbTokenOfferingLocked {
  address: string;
  value: bigint;
  block: number;
}

export interface DbGetBlockWithMetadataOpts<
  TWithTxs extends boolean,
  TWithMicroblocks extends boolean
> {
  txs?: TWithTxs;
  microblocks?: TWithMicroblocks;
}

export interface DbGetBlockWithMetadataResponse<
  TWithTxs extends boolean,
  TWithMicroblocks extends boolean
> {
  block: DbBlock;
  txs: TWithTxs extends true ? DbTx[] : null;
  microblocks: TWithMicroblocks extends true
    ? { accepted: DbMicroblock[]; streamed: DbMicroblock[] }
    : null;
}

export interface DbRawEventRequest {
  event_path: string;
  payload: string;
}

export type BlockIdentifier =
  | { hash: string }
  | { height: number }
  | { burnBlockHash: string }
  | { burnBlockHeight: number };

export interface DbNonFungibleTokenMetadata {
  token_uri: string;
  name: string;
  description: string;
  image_uri: string;
  image_canonical_uri: string;
  contract_id: string;
  tx_id: string;
  sender_address: string;
}

export interface DbFungibleTokenMetadata {
  token_uri: string;
  name: string;
  description: string;
  image_uri: string;
  image_canonical_uri: string;
  contract_id: string;
  symbol: string;
  decimals: number;
  tx_id: string;
  sender_address: string;
}

export interface DbTokenMetadataQueueEntry {
  queueId: number;
  txId: string;
  contractId: string;
  contractAbi: ClarityAbi;
  blockHeight: number;
  processed: boolean;
  retry_count: number;
}

export interface DbChainTip {
  blockHeight: number;
  indexBlockHash: string;
  blockHash: string;
  microblockHash?: string;
  microblockSequence?: number;
}

export interface DbTxGlobalStatus {
  status: DbTxStatus;
  index_block_hash: Buffer;
  microblock_hash: Buffer;
}

export interface DataStore extends DataStoreEventEmitter {
  storeRawEventRequest(eventPath: string, payload: string): Promise<void>;
  getSubdomainResolver(name: { name: string }): Promise<FoundOrNot<string>>;
  getNameCanonical(txId: string, indexBlockHash: string): Promise<FoundOrNot<boolean>>;
  getBlock(blockIdentifer: BlockIdentifier): Promise<FoundOrNot<DbBlock>>;
  getBlockWithMetadata<TWithTxs extends boolean = false, TWithMicroblocks extends boolean = false>(
    blockIdentifer: BlockIdentifier,
    metadata?: DbGetBlockWithMetadataOpts<TWithTxs, TWithMicroblocks>
  ): Promise<FoundOrNot<DbGetBlockWithMetadataResponse<TWithTxs, TWithMicroblocks>>>;

  getMicroblocks(args: {
    limit: number;
    offset: number;
  }): Promise<{ result: { microblock: DbMicroblock; txs: string[] }[]; total: number }>;
  getMicroblock(args: {
    microblockHash: string;
  }): Promise<FoundOrNot<{ microblock: DbMicroblock; txs: string[] }>>;

  getUnanchoredTxs(): Promise<{ txs: DbTx[] }>;

  getUnanchoredChainTip(): Promise<FoundOrNot<DbChainTip>>;

  getCurrentBlock(): Promise<FoundOrNot<DbBlock>>;
  getCurrentBlockHeight(): Promise<FoundOrNot<number>>;
  getBlocks(args: {
    limit: number;
    offset: number;
  }): Promise<{ results: DbBlock[]; total: number }>;
  getBlockTxs(indexBlockHash: string): Promise<{ results: string[] }>;
  getBlockTxsRows(blockHash: string): Promise<FoundOrNot<DbTx[]>>;
  getTxsFromBlock(
    blockIdentifer: BlockIdentifier,
    limit: number,
    offset: number
  ): Promise<FoundOrNot<{ results: DbTx[]; total: number }>>;

  getMempoolTxs(args: {
    txIds: string[];
    includeUnanchored: boolean;
    includePruned?: boolean;
  }): Promise<DbMempoolTx[]>;
  getMempoolTx(args: {
    txId: string;
    includeUnanchored: boolean;
    includePruned?: boolean;
  }): Promise<FoundOrNot<DbMempoolTx>>;
  getMempoolTxList(args: {
    limit: number;
    offset: number;
    includeUnanchored: boolean;
    senderAddress?: string;
    recipientAddress?: string;
    address?: string;
  }): Promise<{ results: DbMempoolTx[]; total: number }>;

  /**
   * Returns a string that represents a digest of all the current pending transactions
   * in the mempool. This digest can be used to calculate an `ETag` for mempool endpoint cache handlers.
   * @returns `FoundOrNot` object with a possible `digest` string.
   */
  getMempoolTxDigest(): Promise<FoundOrNot<{ digest: string }>>;

  getDroppedTxs(args: {
    limit: number;
    offset: number;
  }): Promise<{ results: DbMempoolTx[]; total: number }>;
  getTx(args: { txId: string; includeUnanchored: boolean }): Promise<FoundOrNot<DbTx>>;
  getTxList(args: {
    limit: number;
    offset: number;
    txTypeFilter: TransactionType[];
    includeUnanchored: boolean;
  }): Promise<{ results: DbTx[]; total: number }>;

  getTxEvents(args: {
    txId: string;
    indexBlockHash: string;
    limit: number;
    offset: number;
  }): Promise<{ results: DbEvent[] }>;

  getTxListEvents(args: {
    txs: {
      txId: string;
      indexBlockHash: string;
    }[];
    limit: number;
    offset: number;
  }): Promise<{ results: DbEvent[] }>;

  /**
   * It retrieves filtered events from the db based on transaction, principal or event type. Note: It does not accept both principal and txId at the same time
   * @param args - addressOrTxId: filter for either transaction id or address
   * @param args - eventTypeFilter: filter based on event types ids
   * @param args - limit: returned that many rows
   * @param args - offset: skip that any rows
   * @returns returns array of events
   */
  getTransactionEvents(args: {
    addressOrTxId: { address: string; txId: undefined } | { address: undefined; txId: string };
    eventTypeFilter: DbEventTypeId[];
    limit: number;
    offset: number;
  }): Promise<{ results: DbEvent[] }>;

  getTxListDetails(args: { txIds: string[]; includeUnanchored: boolean }): Promise<DbTx[]>; // tx_id is returned for not found case

  getSmartContractList(contractIds: string[]): Promise<DbSmartContract[]>;
  getSmartContract(contractId: string): Promise<FoundOrNot<DbSmartContract>>;

  getSmartContractEvents(args: {
    contractId: string;
    limit: number;
    offset: number;
  }): Promise<FoundOrNot<DbSmartContractEvent[]>>;

  getSmartContractByTrait(args: {
    trait: ClarityAbi;
    limit: number;
    offset: number;
  }): Promise<FoundOrNot<DbSmartContract[]>>;

  update(data: DataStoreBlockUpdateData): Promise<void>;

  updateMicroblocks(data: DataStoreMicroblockUpdateData): Promise<void>;

  updateAttachments(attachments: DataStoreAttachmentData[]): Promise<void>;

  resolveBnsSubdomains(
    blockData: {
      index_block_hash: string;
      parent_index_block_hash: string;
      microblock_sequence: number;
      microblock_hash: string;
      microblock_canonical: boolean;
    },
    data: DbBnsSubdomain[]
  ): Promise<void>;
  updateMempoolTxs(args: { mempoolTxs: DbMempoolTx[] }): Promise<void>;
  dropMempoolTxs(args: { status: DbTxStatus; txIds: string[] }): Promise<void>;

  updateBurnchainRewards(args: {
    burnchainBlockHash: string;
    burnchainBlockHeight: number;
    rewards: DbBurnchainReward[];
  }): Promise<void>;
  getBurnchainRewards(args: {
    /** Optionally search for rewards for a given address. */
    burnchainRecipient?: string;
    limit: number;
    offset: number;
  }): Promise<DbBurnchainReward[]>;
  getBurnchainRewardsTotal(
    burnchainRecipient: string
  ): Promise<{ reward_recipient: string; reward_amount: bigint }>;

  updateBurnchainRewardSlotHolders(args: {
    burnchainBlockHash: string;
    burnchainBlockHeight: number;
    slotHolders: DbRewardSlotHolder[];
  }): Promise<void>;
  getBurnchainRewardSlotHolders(args: {
    /** Optionally search for slots for a given address. */
    burnchainAddress?: string;
    limit: number;
    offset: number;
  }): Promise<{ total: number; slotHolders: DbRewardSlotHolder[] }>;

  getStxBalance(args: { stxAddress: string; includeUnanchored: boolean }): Promise<DbStxBalance>;
  getStxBalanceAtBlock(stxAddress: string, blockHeight: number): Promise<DbStxBalance>;
  getFungibleTokenBalances(args: {
    stxAddress: string;
    untilBlock: number;
  }): Promise<Map<string, DbFtBalance>>;
  getNonFungibleTokenCounts(args: {
    stxAddress: string;
    untilBlock: number;
  }): Promise<Map<string, { count: bigint; totalSent: bigint; totalReceived: bigint }>>;

  getUnlockedStxSupply(
    args:
      | {
          blockHeight: number;
        }
      | { includeUnanchored: boolean }
  ): Promise<{ stx: bigint; blockHeight: number }>;

  getBTCFaucetRequests(address: string): Promise<{ results: DbFaucetRequest[] }>;

  getSTXFaucetRequests(address: string): Promise<{ results: DbFaucetRequest[] }>;

  getAddressTxs(args: {
    stxAddress: string;
    blockHeight: number;
    atSingleBlock: boolean;
    limit: number;
    offset: number;
  }): Promise<{ results: DbTx[]; total: number }>;

  getAddressTxsWithAssetTransfers(args: {
    stxAddress: string;
    blockHeight: number;
    atSingleBlock: boolean;
    limit?: number;
    offset?: number;
  }): Promise<{ results: DbTxWithAssetTransfers[]; total: number }>;

  getInformationTxsWithStxTransfers(args: {
    stxAddress: string;
    tx_id: string;
  }): Promise<DbTxWithAssetTransfers>;

  getAddressAssetEvents(args: {
    stxAddress: string;
    blockHeight: number;
    limit: number;
    offset: number;
  }): Promise<{ results: DbEvent[]; total: number }>;

  getAddressNonceAtBlock(args: {
    stxAddress: string;
    blockIdentifier: BlockIdentifier;
  }): Promise<FoundOrNot<{ lastExecutedTxNonce: number | null; possibleNextNonce: number }>>;

  getAddressNonces(args: {
    stxAddress: string;
  }): Promise<{
    lastExecutedTxNonce: number | null;
    lastMempoolTxNonce: number | null;
    possibleNextNonce: number;
    detectedMissingNonces: number[];
  }>;

  getInboundTransfers(args: {
    stxAddress: string;
    blockHeight: number;
    atSingleBlock: boolean;
    limit: number;
    offset: number;
    sendManyContractId: string;
  }): Promise<{ results: DbInboundStxTransfer[]; total: number }>;

  searchHash(args: { hash: string }): Promise<FoundOrNot<DbSearchResult>>;

  searchPrincipal(args: { principal: string }): Promise<FoundOrNot<DbSearchResult>>;

  insertFaucetRequest(faucetRequest: DbFaucetRequest): Promise<void>;

  getRawTx(txId: string): Promise<FoundOrNot<RawTxQueryResult>>;

  getTxStatus(txId: string): Promise<FoundOrNot<DbTxGlobalStatus>>;

  /**
   * Returns a list of NFTs owned by the given principal filtered by optional `asset_identifiers`,
   * including optional transaction metadata.
   * @param args - Query arguments
   */
  getNftHoldings(args: {
    principal: string;
    assetIdentifiers?: string[];
    limit: number;
    offset: number;
    includeUnanchored: boolean;
    includeTxMetadata: boolean;
  }): Promise<{ results: NftHoldingInfoWithTxMetadata[]; total: number }>;

  /**
   * Returns the event history of a particular NFT.
   * @param args - Query arguments
   */
  getNftHistory(args: {
    assetIdentifier: string;
    value: string;
    limit: number;
    offset: number;
    blockHeight: number;
    includeTxMetadata: boolean;
  }): Promise<{ results: NftEventWithTxMetadata[]; total: number }>;

  /**
   * Returns all NFT mint events for a particular asset identifier.
   * @param args - Query arguments
   */
  getNftMints(args: {
    assetIdentifier: string;
    limit: number;
    offset: number;
    blockHeight: number;
    includeTxMetadata: boolean;
  }): Promise<{ results: NftEventWithTxMetadata[]; total: number }>;

  /**
   * @deprecated Use `getNftHoldings` instead.
   */
  getAddressNFTEvent(args: {
    stxAddress: string;
    blockHeight: number;
    limit: number;
    offset: number;
    includeUnanchored: boolean;
  }): Promise<{ results: AddressNftEventIdentifier[]; total: number }>;

  getConfigState(): Promise<DbConfigState>;
  updateConfigState(configState: DbConfigState): Promise<void>;

  getNamespaceList(args: {
    includeUnanchored: boolean;
  }): Promise<{
    results: string[];
  }>;

  getNamespaceNamesList(args: {
    namespace: string;
    page: number;
    includeUnanchored: boolean;
  }): Promise<{
    results: string[];
  }>;

  getNamespace(args: {
    namespace: string;
    includeUnanchored: boolean;
  }): Promise<FoundOrNot<DbBnsNamespace>>;
  getName(args: {
    name: string;
    includeUnanchored: boolean;
    chainId: ChainID;
  }): Promise<FoundOrNot<DbBnsName>>;
  getHistoricalZoneFile(args: {
    name: string;
    zoneFileHash: string;
    includeUnanchored: boolean;
  }): Promise<FoundOrNot<DbBnsZoneFile>>;
  getLatestZoneFile(args: {
    name: string;
    includeUnanchored: boolean;
  }): Promise<FoundOrNot<DbBnsZoneFile>>;
  getNamesByAddressList(args: {
    address: string;
    includeUnanchored: boolean;
    chainId: ChainID;
  }): Promise<FoundOrNot<string[]>>;
  getNamesList(args: {
    page: number;
    includeUnanchored: boolean;
  }): Promise<{
    results: string[];
  }>;
  /**
   * This function returns the subdomains for a specific name
   * @param name - The name for which subdomains are required
   */
  getSubdomainsListInName(args: {
    name: string;
    includeUnanchored: boolean;
  }): Promise<{ results: string[] }>;
  getSubdomainsList(args: {
    page: number;
    includeUnanchored: boolean;
  }): Promise<{
    results: string[];
  }>;
  getSubdomain(args: {
    subdomain: string;
    includeUnanchored: boolean;
  }): Promise<FoundOrNot<DbBnsSubdomain>>;
  getMinersRewardsAtHeight({ blockHeight }: { blockHeight: number }): Promise<DbMinerReward[]>;
  getTokenOfferingLocked(
    address: string,
    blockHeight: number
  ): Promise<FoundOrNot<AddressTokenOfferingLocked>>;
  getUnlockedAddressesAtBlock(block: DbBlock): Promise<StxUnlockEvent[]>;

  getFtMetadata(contractId: string): Promise<FoundOrNot<DbFungibleTokenMetadata>>;
  getNftMetadata(contractId: string): Promise<FoundOrNot<DbNonFungibleTokenMetadata>>;

  updateNFtMetadata(nftMetadata: DbNonFungibleTokenMetadata): Promise<number>;
  updateFtMetadata(ftMetadata: DbFungibleTokenMetadata): Promise<number>;

  getFtMetadataList(args: {
    limit: number;
    offset: number;
  }): Promise<{ results: DbFungibleTokenMetadata[]; total: number }>;
  getNftMetadataList(args: {
    limit: number;
    offset: number;
  }): Promise<{ results: DbNonFungibleTokenMetadata[]; total: number }>;

  /**
   * Returns a single entry from the `token_metadata_queue` table.
   * @param queueId - queue entry id
   */
  getTokenMetadataQueueEntry(queueId: number): Promise<FoundOrNot<DbTokenMetadataQueueEntry>>;

  /**
   * Marks a token metadata queue entry as processed.
   * @param queueId - queue entry id
   */
  updateProcessedTokenMetadataQueueEntry(queueId: number): Promise<void>;

  /**
   * Increases the retry count for a specific token metadata queue entry.
   * @param queueId - queue entry id
   * @returns new retry count
   */
  increaseTokenMetadataQueueEntryRetryCount(queueId: number): Promise<number>;

  getTokenMetadataQueue(
    limit: number,
    excludingEntries: number[]
  ): Promise<DbTokenMetadataQueueEntry[]>;

  close(): Promise<void>;
}

export function getTxDbStatus(
  txCoreStatus: CoreNodeTxStatus | CoreNodeDropMempoolTxReasonType
): DbTxStatus {
  switch (txCoreStatus) {
    case 'success':
      return DbTxStatus.Success;
    case 'abort_by_response':
      return DbTxStatus.AbortByResponse;
    case 'abort_by_post_condition':
      return DbTxStatus.AbortByPostCondition;
    case 'ReplaceByFee':
      return DbTxStatus.DroppedReplaceByFee;
    case 'ReplaceAcrossFork':
      return DbTxStatus.DroppedReplaceAcrossFork;
    case 'TooExpensive':
      return DbTxStatus.DroppedTooExpensive;
    case 'StaleGarbageCollect':
      return DbTxStatus.DroppedStaleGarbageCollect;
    default:
      throw new Error(`Unexpected tx status: ${txCoreStatus}`);
  }
}

/**
 * Extract tx-type specific data from a Transaction and into a tx db model.
 * @param txData - Transaction data to extract from.
 * @param dbTx - The tx db object to write to.
 */
function extractTransactionPayload(txData: DecodedTxResult, dbTx: DbTx | DbMempoolTx) {
  switch (txData.payload.type_id) {
    case TxPayloadTypeID.TokenTransfer: {
      let recipientPrincipal = txData.payload.recipient.address;
      if (txData.payload.recipient.type_id === PrincipalTypeID.Contract) {
        recipientPrincipal += '.' + txData.payload.recipient.contract_name;
      }
      dbTx.token_transfer_recipient_address = recipientPrincipal;
      dbTx.token_transfer_amount = BigInt(txData.payload.amount);
      dbTx.token_transfer_memo = hexToBuffer(txData.payload.memo_hex);
      break;
    }
    case TxPayloadTypeID.SmartContract: {
      const sender_address = getTxSenderAddress(txData);
      dbTx.smart_contract_contract_id = sender_address + '.' + txData.payload.contract_name;
      dbTx.smart_contract_source_code = txData.payload.code_body;
      break;
    }
    case TxPayloadTypeID.ContractCall: {
      const contractAddress = txData.payload.address;
      dbTx.contract_call_contract_id = `${contractAddress}.${txData.payload.contract_name}`;
      dbTx.contract_call_function_name = txData.payload.function_name;
      dbTx.contract_call_function_args = hexToBuffer(txData.payload.function_args_buffer);
      break;
    }
    case TxPayloadTypeID.PoisonMicroblock: {
      dbTx.poison_microblock_header_1 = hexToBuffer(txData.payload.microblock_header_1.buffer);
      dbTx.poison_microblock_header_2 = hexToBuffer(txData.payload.microblock_header_2.buffer);
      break;
    }
    case TxPayloadTypeID.Coinbase: {
      dbTx.coinbase_payload = hexToBuffer(txData.payload.payload_buffer);
      break;
    }
    default:
      throw new Error(`Unexpected transaction type ID: ${JSON.stringify(txData.payload)}`);
  }
}

export function createDbMempoolTxFromCoreMsg(msg: {
  txData: DecodedTxResult;
  txId: string;
  sender: string;
  sponsorAddress: string | undefined;
  rawTx: Buffer;
  receiptDate: number;
}): DbMempoolTx {
  const dbTx: DbMempoolTx = {
    pruned: false,
    nonce: Number(msg.txData.auth.origin_condition.nonce),
    sponsor_nonce:
      msg.txData.auth.type_id === PostConditionAuthFlag.Sponsored
        ? Number(msg.txData.auth.sponsor_condition.nonce)
        : undefined,
    tx_id: msg.txId,
    raw_tx: msg.rawTx,
    type_id: parseEnum(DbTxTypeId, msg.txData.payload.type_id as number),
    anchor_mode: parseEnum(DbTxAnchorMode, msg.txData.anchor_mode as number),
    status: DbTxStatus.Pending,
    receipt_time: msg.receiptDate,
    fee_rate:
      msg.txData.auth.type_id === PostConditionAuthFlag.Sponsored
        ? BigInt(msg.txData.auth.sponsor_condition.tx_fee)
        : BigInt(msg.txData.auth.origin_condition.tx_fee),
    sender_address: msg.sender,
    origin_hash_mode: msg.txData.auth.origin_condition.hash_mode as number,
    sponsored: msg.txData.auth.type_id === PostConditionAuthFlag.Sponsored,
    sponsor_address: msg.sponsorAddress,
    post_conditions: hexToBuffer(msg.txData.post_conditions_buffer),
  };
  extractTransactionPayload(msg.txData, dbTx);
  return dbTx;
}

export function createDbTxFromCoreMsg(msg: CoreNodeParsedTxMessage): DbTx {
  const coreTx = msg.core_tx;
  const parsedTx = msg.parsed_tx;
  const dbTx: DbTx = {
    tx_id: coreTx.txid,
    tx_index: coreTx.tx_index,
    nonce: Number(parsedTx.auth.origin_condition.nonce),
    sponsor_nonce:
      parsedTx.auth.type_id === PostConditionAuthFlag.Sponsored
        ? Number(parsedTx.auth.sponsor_condition.nonce)
        : undefined,
    raw_tx: msg.raw_tx,
    index_block_hash: msg.index_block_hash,
    parent_index_block_hash: msg.parent_index_block_hash,
    parent_block_hash: msg.parent_block_hash,
    block_hash: msg.block_hash,
    block_height: msg.block_height,
    burn_block_time: msg.burn_block_time,
    parent_burn_block_time: msg.parent_burn_block_time,
    type_id: parseEnum(DbTxTypeId, parsedTx.payload.type_id as number),
    anchor_mode: parseEnum(DbTxAnchorMode, parsedTx.anchor_mode as number),
    status: getTxDbStatus(coreTx.status),
    raw_result: coreTx.raw_result,
    fee_rate:
      parsedTx.auth.type_id === PostConditionAuthFlag.Sponsored
        ? BigInt(parsedTx.auth.sponsor_condition.tx_fee)
        : BigInt(parsedTx.auth.origin_condition.tx_fee),
    sender_address: msg.sender_address,
    sponsor_address: msg.sponsor_address,
    origin_hash_mode: parsedTx.auth.origin_condition.hash_mode as number,
    sponsored: parsedTx.auth.type_id === PostConditionAuthFlag.Sponsored,
    canonical: true,
    microblock_canonical: true,
    microblock_sequence: msg.microblock_sequence,
    microblock_hash: msg.microblock_hash,
    post_conditions: hexToBuffer(parsedTx.post_conditions_buffer),
    event_count: 0,
    execution_cost_read_count: coreTx.execution_cost.read_count,
    execution_cost_read_length: coreTx.execution_cost.read_length,
    execution_cost_runtime: coreTx.execution_cost.runtime,
    execution_cost_write_count: coreTx.execution_cost.write_count,
    execution_cost_write_length: coreTx.execution_cost.write_length,
  };
  extractTransactionPayload(parsedTx, dbTx);
  return dbTx;
}
