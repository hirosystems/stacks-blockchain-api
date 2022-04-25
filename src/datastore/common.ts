import { EventEmitter } from 'events';
import StrictEventEmitter from 'strict-event-emitter-types';
import { ClarityAbi } from '@stacks/transactions';
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
  locked_amount: bigint;
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
  base: number;
  coeff: number;
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
}

export interface DbChainTip {
  blockHeight: number;
  indexBlockHash: string;
  blockHash: string;
  microblockHash?: string;
  microblockSequence?: number;
}
