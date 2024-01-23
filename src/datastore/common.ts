import { ClarityAbi } from '@stacks/transactions';
import { Block } from '@stacks/stacks-blockchain-api-types';
import { SyntheticPoxEventName } from '../pox-helpers';
import { PgBytea, PgJsonb, PgNumeric } from '@hirosystems/api-toolkit';

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
  tx_count: number;
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

export interface DbBurnBlock {
  block_hash: string;
  burn_block_time: number;
  burn_block_hash: string;
  burn_block_height: number;
  stacks_blocks: string[];
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
  /** STX principal */
  miner_address: string | null;
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
  CoinbaseToAltRecipient = 0x05,
  VersionedSmartContract = 0x06,
  TenureChange = 0x07,
  NakamotoCoinbase = 0x08,
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
  /** Transaction is problematic (e.g. a DDoS vector) and should be dropped. */
  DroppedProblematic = -15,
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
  /** Hex encoded arbitrary message, up to 34 bytes length (should try decoding to an ASCII string). */
  token_transfer_memo?: string;
  status: DbTxStatus;
  type_id: DbTxTypeId;
  /** Only valid for `contract_call` tx types */
  contract_call_contract_id?: string;
  contract_call_function_name?: string;
  /** Hex encoded Clarity values. Undefined if function defines no args. */
  contract_call_function_args?: string;
  abi?: string;

  /** Only valid for `tenure-change` tx types. */
  tenure_change_tenure_consensus_hash?: string;
  tenure_change_prev_tenure_consensus_hash?: string;
  tenure_change_burn_view_consensus_hash?: string;
  tenure_change_previous_tenure_end?: string;
  tenure_change_previous_tenure_blocks?: number;
  tenure_change_cause?: number;
  tenure_change_pubkey_hash?: string;
  tenure_change_signature?: string;
  tenure_change_signers?: string;
}

export interface DbTx extends BaseTx {
  index_block_hash: string;
  parent_index_block_hash: string;
  block_hash: string;
  parent_block_hash: string;
  block_height: number;
  burn_block_time: number;
  parent_burn_block_time: number;

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

  post_conditions: string;

  /** u8 */
  origin_hash_mode: number;

  /** Only valid for `versioned_smart_contract` tx types */
  smart_contract_clarity_version?: number;

  /** Only valid for `smart_contract` tx types. */
  smart_contract_contract_id?: string;
  smart_contract_source_code?: string;

  /** Only valid for `poison_microblock` tx types. */
  poison_microblock_header_1?: string;
  poison_microblock_header_2?: string;

  /** Only valid for `coinbase` tx types. Hex encoded 32-bytes. */
  coinbase_payload?: string;

  /** Only valid for `coinbase-to-alt-recipient` tx types. Either a standard principal or contract principal. */
  coinbase_alt_recipient?: string;

  /** Only valid for `nakamoto-coinbase` tx types. Hex encoded 80-bytes. */
  coinbase_vrf_proof?: string;

  event_count: number;

  execution_cost_read_count: number;
  execution_cost_read_length: number;
  execution_cost_runtime: number;
  execution_cost_write_count: number;
  execution_cost_write_length: number;
}

export interface DbTxRaw extends DbTx {
  raw_tx: string;
}

export interface DbTxGlobalStatus {
  status: DbTxStatus;
  index_block_hash?: string;
  microblock_hash?: string;
}

export interface DbMempoolStats {
  tx_type_counts: Record<string, number>;
  tx_simple_fee_averages: Record<
    string,
    {
      p25: number | null;
      p50: number | null;
      p75: number | null;
      p95: number | null;
    }
  >;
  tx_ages: Record<
    string,
    {
      p25: number | null;
      p50: number | null;
      p75: number | null;
      p95: number | null;
    }
  >;
  tx_byte_sizes: Record<
    string,
    {
      p25: number | null;
      p50: number | null;
      p75: number | null;
      p95: number | null;
    }
  >;
}

export interface DbMempoolFeePriority {
  type_id: DbTxTypeId | null;
  high_priority: number;
  medium_priority: number;
  low_priority: number;
  no_priority: number;
}

export interface DbMempoolTx extends BaseTx {
  pruned: boolean;

  receipt_time: number;

  post_conditions: string;
  /** u8 */
  origin_hash_mode: number;

  /** Only valid for `versioned_smart_contract` tx types */
  smart_contract_clarity_version?: number;

  /** Only valid for `smart_contract` tx types. */
  smart_contract_contract_id?: string;
  smart_contract_source_code?: string;

  /** Only valid for `poison_microblock` tx types. */
  poison_microblock_header_1?: string;
  poison_microblock_header_2?: string;

  /** Only valid for `coinbase` tx types. Hex encoded 32-bytes. */
  coinbase_payload?: string;

  /** Only valid for `coinbase-to-alt-recipient` tx types. Either a standard principal or contract principal. */
  coinbase_alt_recipient?: string;

  /** Only valid for `nakamoto-coinbase` tx types. Hex encoded 80-bytes. */
  coinbase_vrf_proof?: string;
}

export interface DbMempoolTxRaw extends DbMempoolTx {
  raw_tx: string;
}

export interface DbSmartContract {
  tx_id: string;
  canonical: boolean;
  contract_id: string;
  block_height: number;
  clarity_version: number | null;
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

export type PoxSyntheticEventTable = 'pox2_events' | 'pox3_events' | 'pox4_events';

export interface DbPoxSyntheticBaseEventData {
  stacker: string;
  locked: bigint;
  balance: bigint;
  burnchain_unlock_height: bigint;
  pox_addr: string | null;
  pox_addr_raw: string | null;
}

export interface DbPoxSyntheticHandleUnlockEvent extends DbPoxSyntheticBaseEventData {
  name: SyntheticPoxEventName.HandleUnlock;
  data: {
    first_cycle_locked: bigint;
    first_unlocked_cycle: bigint;
  };
}

export interface DbPoxSyntheticStackStxEvent extends DbPoxSyntheticBaseEventData {
  name: SyntheticPoxEventName.StackStx;
  data: {
    lock_amount: bigint;
    lock_period: bigint;
    start_burn_height: bigint;
    unlock_burn_height: bigint;
  };
}

export interface DbPoxSyntheticStackIncreaseEvent extends DbPoxSyntheticBaseEventData {
  name: SyntheticPoxEventName.StackIncrease;
  data: {
    increase_by: bigint;
    total_locked: bigint;
  };
}

export interface DbPoxSyntheticStackExtendEvent extends DbPoxSyntheticBaseEventData {
  name: SyntheticPoxEventName.StackExtend;
  data: {
    extend_count: bigint;
    unlock_burn_height: bigint;
  };
}

export interface DbPoxSyntheticDelegateStxEvent extends DbPoxSyntheticBaseEventData {
  name: SyntheticPoxEventName.DelegateStx;
  data: {
    amount_ustx: bigint;
    delegate_to: string;
    unlock_burn_height: bigint | null;
  };
}

export interface DbPoxSyntheticDelegateStackStxEvent extends DbPoxSyntheticBaseEventData {
  name: SyntheticPoxEventName.DelegateStackStx;
  data: {
    lock_amount: bigint;
    unlock_burn_height: bigint;
    start_burn_height: bigint;
    lock_period: bigint;
    delegator: string;
  };
}

export interface DbPoxSyntheticDelegateStackIncreaseEvent extends DbPoxSyntheticBaseEventData {
  name: SyntheticPoxEventName.DelegateStackIncrease;
  data: {
    increase_by: bigint;
    total_locked: bigint;
    delegator: string;
  };
}

export interface DbPoxSyntheticDelegateStackExtendEvent extends DbPoxSyntheticBaseEventData {
  name: SyntheticPoxEventName.DelegateStackExtend;
  data: {
    unlock_burn_height: bigint;
    extend_count: bigint;
    delegator: string;
  };
}

export interface DbPoxSyntheticStackAggregationCommitEvent extends DbPoxSyntheticBaseEventData {
  name: SyntheticPoxEventName.StackAggregationCommit;
  data: {
    reward_cycle: bigint;
    amount_ustx: bigint;
  };
}

export interface DbPoxSyntheticStackAggregationCommitIndexedEvent
  extends DbPoxSyntheticBaseEventData {
  name: SyntheticPoxEventName.StackAggregationCommitIndexed;
  data: {
    reward_cycle: bigint;
    amount_ustx: bigint;
  };
}

export interface DbPoxSyntheticStackAggregationIncreaseEvent extends DbPoxSyntheticBaseEventData {
  name: SyntheticPoxEventName.StackAggregationIncrease;
  data: {
    reward_cycle: bigint;
    amount_ustx: bigint;
  };
}

export interface DbPoxSyntheticRevokeDelegateStxEvent extends DbPoxSyntheticBaseEventData {
  name: SyntheticPoxEventName.RevokeDelegateStx;
  data: {
    // TODO: determine what data is available for this event type
    amount_ustx: bigint;
    delegate_to: string;
  };
}

export type DbPoxSyntheticEventData =
  | DbPoxSyntheticHandleUnlockEvent
  | DbPoxSyntheticStackStxEvent
  | DbPoxSyntheticStackIncreaseEvent
  | DbPoxSyntheticStackExtendEvent
  | DbPoxSyntheticDelegateStxEvent
  | DbPoxSyntheticDelegateStackStxEvent
  | DbPoxSyntheticDelegateStackIncreaseEvent
  | DbPoxSyntheticDelegateStackExtendEvent
  | DbPoxSyntheticStackAggregationCommitEvent
  | DbPoxSyntheticStackAggregationCommitIndexedEvent
  | DbPoxSyntheticStackAggregationIncreaseEvent
  | DbPoxSyntheticRevokeDelegateStxEvent;

export type DbPoxSyntheticEvent = DbEventBase & DbPoxSyntheticEventData;

export interface DbPoxStacker {
  stacker: string;
  pox_addr?: string;
  amount_ustx: string;
  burn_block_unlock_height?: number;
  block_height: number;
  tx_id: string;
}

export interface DbSmartContractEvent extends DbEventBase {
  event_type: DbEventTypeId.SmartContractLog;
  contract_identifier: string;
  topic: string;
  value: string;
}

export interface DbStxLockEvent extends DbEventBase {
  event_type: DbEventTypeId.StxLock;
  locked_amount: bigint;
  unlock_height: number;
  locked_address: string;
  contract_name: string;
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
  memo?: string;
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
  value: string;
}

export interface StxUnlockEvent {
  tx_id: string;
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
    value: string;
    sender?: string;
    recipient?: string;
  }[];
}

export interface NftHoldingInfo {
  asset_identifier: string;
  value: string;
  recipient: string;
  tx_id: string;
  block_height: number;
}

export interface NftHoldingInfoWithTxMetadata {
  nft_holding_info: NftHoldingInfo;
  tx?: DbTx;
}

export interface NftEventWithTxMetadata {
  nft_event: DbNftEvent;
  tx?: DbTx;
}

export interface DataStoreBlockUpdateData {
  block: DbBlock;
  microblocks: DbMicroblock[];
  minerRewards: DbMinerReward[];
  txs: DataStoreTxEventData[];
  pox_v1_unlock_height?: number;
  pox_v2_unlock_height?: number;
  pox_v3_unlock_height?: number;
}

export interface DataStoreMicroblockUpdateData {
  microblocks: DbMicroblockPartial[];
  txs: DataStoreTxEventData[];
}

export interface DataStoreTxEventData {
  tx: DbTxRaw;
  stxEvents: DbStxEvent[];
  stxLockEvents: DbStxLockEvent[];
  ftEvents: DbFtEvent[];
  nftEvents: DbNftEvent[];
  contractLogEvents: DbSmartContractEvent[];
  smartContracts: DbSmartContract[];
  names: DbBnsName[];
  namespaces: DbBnsNamespace[];
  pox2Events: DbPoxSyntheticEvent[];
  pox3Events: DbPoxSyntheticEvent[];
  pox4Events: DbPoxSyntheticEvent[];
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

export type DataStoreBnsBlockTxData = DataStoreBnsBlockData & {
  tx_id: string;
  tx_index: number;
};

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
  nonalpha_discount: bigint;
  no_vowel_discount: bigint;
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
  resolver?: string;
  zonefile: string;
  zonefile_hash: string;
  tx_id: string;
  tx_index: number;
  event_index?: number;
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
  index_block_hash?: string;
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
  microblock_tx_count: Record<string, number>;
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

export interface BlockQueryResult {
  block_hash: string;
  index_block_hash: string;
  parent_index_block_hash: string;
  parent_block_hash: string;
  parent_microblock_hash: string;
  parent_microblock_sequence: number;
  block_height: number;
  burn_block_time: number;
  burn_block_hash: string;
  burn_block_height: number;
  miner_txid: string;
  canonical: boolean;
  execution_cost_read_count: string;
  execution_cost_read_length: string;
  execution_cost_runtime: string;
  execution_cost_write_count: string;
  execution_cost_write_length: string;
  tx_count: number;
}

export interface MicroblockQueryResult {
  canonical: boolean;
  microblock_canonical: boolean;
  microblock_hash: string;
  microblock_sequence: number;
  microblock_parent_hash: string;
  parent_index_block_hash: string;
  block_height: number;
  parent_block_height: number;
  parent_block_hash: string;
  index_block_hash: string;
  block_hash: string;
  parent_burn_block_height: number;
  parent_burn_block_hash: string;
  parent_burn_block_time: number;
}

export interface MempoolTxQueryResult {
  pruned: boolean;
  tx_id: string;

  nonce: number;
  sponsor_nonce?: number;
  type_id: number;
  anchor_mode: number;
  status: number;
  receipt_time: number;
  receipt_block_height: number;

  canonical: boolean;
  post_conditions: string;
  fee_rate: string;
  sponsored: boolean;
  sponsor_address: string | null;
  sender_address: string;
  origin_hash_mode: number;

  // `token_transfer` tx types
  token_transfer_recipient_address?: string;
  token_transfer_amount?: string;
  token_transfer_memo?: string;

  // `versioned_smart_contract` tx types
  smart_contract_clarity_version?: number;

  // `smart_contract` tx types
  smart_contract_contract_id?: string;
  smart_contract_source_code?: string;

  // `contract_call` tx types
  contract_call_contract_id?: string;
  contract_call_function_name?: string;
  contract_call_function_args?: string;

  // `poison_microblock` tx types
  poison_microblock_header_1?: string;
  poison_microblock_header_2?: string;

  // `coinbase` tx types
  coinbase_payload?: string;

  /** Only valid for `coinbase-to-alt-recipient` tx types. Either a standard principal or contract principal. */
  coinbase_alt_recipient?: string;

  /** Only valid for `nakamoto-coinbase` tx types. Hex encoded 80-bytes. */
  coinbase_vrf_proof?: string;

  // `tenure-change` tx types
  tenure_change_tenure_consensus_hash?: string;
  tenure_change_prev_tenure_consensus_hash?: string;
  tenure_change_burn_view_consensus_hash?: string;
  tenure_change_previous_tenure_end?: string;
  tenure_change_previous_tenure_blocks?: number;
  tenure_change_cause?: number;
  tenure_change_pubkey_hash: string;
  tenure_change_signature?: string;
  tenure_change_signers?: string;

  // sending abi in case tx is contract call
  abi: unknown | null;
}

export interface TxQueryResult {
  tx_id: string;
  tx_index: number;
  index_block_hash: string;
  parent_index_block_hash: string;
  block_hash: string;
  parent_block_hash: string;
  block_height: number;
  burn_block_time: number;
  parent_burn_block_time: number;
  nonce: number;
  sponsor_nonce?: number;
  type_id: number;
  anchor_mode: number;
  status: number;
  raw_result: string;
  canonical: boolean;

  microblock_canonical: boolean;
  microblock_sequence: number;
  microblock_hash: string;

  post_conditions: string;
  fee_rate: string;
  sponsored: boolean;
  sponsor_address: string | null;
  sender_address: string;
  origin_hash_mode: number;

  // `token_transfer` tx types
  token_transfer_recipient_address?: string;
  token_transfer_amount?: string;
  token_transfer_memo?: string;

  // `versioned_smart_contract` tx types
  smart_contract_clarity_version?: number;

  // `smart_contract` tx types
  smart_contract_contract_id?: string;
  smart_contract_source_code?: string;

  // `contract_call` tx types
  contract_call_contract_id?: string;
  contract_call_function_name?: string;
  contract_call_function_args?: string;

  // `poison_microblock` tx types
  poison_microblock_header_1?: string;
  poison_microblock_header_2?: string;

  // `coinbase` tx types
  coinbase_payload?: string;

  // `coinbase-to-alt-recipient` tx types
  coinbase_alt_recipient?: string;

  // `nakamoto-coinbase` tx types. Hex encoded 80-bytes.
  coinbase_vrf_proof?: string;

  // `tenure-change` tx types
  tenure_change_tenure_consensus_hash?: string;
  tenure_change_prev_tenure_consensus_hash?: string;
  tenure_change_burn_view_consensus_hash?: string;
  tenure_change_previous_tenure_end?: string;
  tenure_change_previous_tenure_blocks?: number;
  tenure_change_cause?: number;
  tenure_change_pubkey_hash: string;
  tenure_change_signature?: string;
  tenure_change_signers?: string;

  // events count
  event_count: number;

  execution_cost_read_count: string;
  execution_cost_read_length: string;
  execution_cost_runtime: string;
  execution_cost_write_count: string;
  execution_cost_write_length: string;
}

export interface ContractTxQueryResult extends TxQueryResult {
  abi?: unknown | null;
}

export interface FaucetRequestQueryResult {
  currency: string;
  ip: string;
  address: string;
  occurred_at: string;
}

interface ReOrgEntities {
  blocks: number;
  microblocks: number;
  minerRewards: number;
  txs: number;
  stxLockEvents: number;
  stxEvents: number;
  ftEvents: number;
  nftEvents: number;
  pox2Events: number;
  pox3Events: number;
  pox4Events: number;
  contractLogs: number;
  smartContracts: number;
  names: number;
  namespaces: number;
  subdomains: number;
}

export interface ReOrgUpdatedEntities {
  markedCanonical: ReOrgEntities;
  markedNonCanonical: ReOrgEntities;
  prunedMempoolTxs: number;
  restoredMempoolTxs: number;
}

export interface TransferQueryResult {
  sender: string;
  memo: string;
  block_height: number;
  tx_index: number;
  tx_id: string;
  transfer_type: string;
  amount: string;
}

export type DbPaginatedResult<T> = {
  limit: number;
  offset: number;
  total: number;
  results: T[];
};

export interface BlocksWithMetadata {
  results: {
    block: DbBlock;
    txs: string[];
    microblocks_accepted: string[];
    microblocks_streamed: string[];
    microblock_tx_count: Record<string, number>;
  }[];
  total: number;
}

export interface RawTxQueryResult {
  raw_tx: string;
}

export interface TxInsertValues {
  tx_id: PgBytea;
  raw_tx: PgBytea;
  tx_index: number;
  index_block_hash: PgBytea;
  parent_index_block_hash: PgBytea;
  block_hash: PgBytea;
  parent_block_hash: PgBytea;
  block_height: number;
  burn_block_time: number;
  parent_burn_block_time: number;
  type_id: number;
  anchor_mode: DbTxAnchorMode;
  status: DbTxStatus;
  canonical: boolean;
  post_conditions: PgBytea;
  nonce: number;
  fee_rate: bigint;
  sponsored: boolean;
  sponsor_nonce: number | null;
  sponsor_address: string | null;
  sender_address: string;
  origin_hash_mode: number;
  microblock_canonical: boolean;
  microblock_sequence: number;
  microblock_hash: PgBytea;
  token_transfer_recipient_address: string | null;
  token_transfer_amount: bigint | null;
  token_transfer_memo: PgBytea | null;
  smart_contract_clarity_version: number | null;
  smart_contract_contract_id: string | null;
  smart_contract_source_code: string | null;
  contract_call_contract_id: string | null;
  contract_call_function_name: string | null;
  contract_call_function_args: PgBytea | null;
  poison_microblock_header_1: PgBytea | null;
  poison_microblock_header_2: PgBytea | null;
  coinbase_payload: PgBytea | null;
  coinbase_alt_recipient: string | null;
  coinbase_vrf_proof: string | null;
  tenure_change_tenure_consensus_hash: string | null;
  tenure_change_prev_tenure_consensus_hash: string | null;
  tenure_change_burn_view_consensus_hash: string | null;
  tenure_change_previous_tenure_end: string | null;
  tenure_change_previous_tenure_blocks: number | null;
  tenure_change_cause: number | null;
  tenure_change_pubkey_hash: string | null;
  tenure_change_signature: string | null;
  tenure_change_signers: string | null;
  raw_result: PgBytea;
  event_count: number;
  execution_cost_read_count: number;
  execution_cost_read_length: number;
  execution_cost_runtime: number;
  execution_cost_write_count: number;
  execution_cost_write_length: number;
}

export interface MempoolTxInsertValues {
  pruned: boolean;
  tx_id: PgBytea;
  raw_tx: PgBytea;
  type_id: DbTxTypeId;
  anchor_mode: DbTxAnchorMode;
  status: DbTxStatus;
  receipt_time: number;
  receipt_block_height: number;
  post_conditions: PgBytea;
  nonce: number;
  fee_rate: bigint;
  sponsored: boolean;
  sponsor_nonce: number | null;
  sponsor_address: string | null;
  sender_address: string;
  origin_hash_mode: number;
  token_transfer_recipient_address: string | null;
  token_transfer_amount: bigint | null;
  token_transfer_memo: PgBytea | null;
  smart_contract_clarity_version: number | null;
  smart_contract_contract_id: string | null;
  smart_contract_source_code: string | null;
  contract_call_contract_id: string | null;
  contract_call_function_name: string | null;
  contract_call_function_args: PgBytea | null;
  poison_microblock_header_1: PgBytea | null;
  poison_microblock_header_2: PgBytea | null;
  coinbase_payload: PgBytea | null;
  coinbase_alt_recipient: string | null;
  coinbase_vrf_proof: string | null;
  tenure_change_tenure_consensus_hash: string | null;
  tenure_change_prev_tenure_consensus_hash: string | null;
  tenure_change_burn_view_consensus_hash: string | null;
  tenure_change_previous_tenure_end: string | null;
  tenure_change_previous_tenure_blocks: number | null;
  tenure_change_cause: number | null;
  tenure_change_pubkey_hash: string | null;
  tenure_change_signature: string | null;
  tenure_change_signers: string | null;
}

export interface BlockInsertValues {
  block_hash: PgBytea;
  index_block_hash: PgBytea;
  parent_index_block_hash: PgBytea;
  parent_block_hash: PgBytea;
  parent_microblock_hash: PgBytea;
  parent_microblock_sequence: number;
  block_height: number;
  burn_block_time: number;
  burn_block_hash: PgBytea;
  burn_block_height: number;
  miner_txid: PgBytea;
  canonical: boolean;
  execution_cost_read_count: number;
  execution_cost_read_length: number;
  execution_cost_runtime: number;
  execution_cost_write_count: number;
  execution_cost_write_length: number;
  tx_count: number;
}

export interface MicroblockInsertValues {
  canonical: boolean;
  microblock_canonical: boolean;
  microblock_hash: PgBytea;
  microblock_sequence: number;
  microblock_parent_hash: PgBytea;
  parent_index_block_hash: PgBytea;
  block_height: number;
  parent_block_height: number;
  parent_block_hash: PgBytea;
  index_block_hash: PgBytea;
  block_hash: PgBytea;
  parent_burn_block_height: number;
  parent_burn_block_hash: PgBytea;
  parent_burn_block_time: number;
}

export interface StxEventInsertValues {
  event_index: number;
  tx_id: PgBytea;
  tx_index: number;
  block_height: number;
  index_block_hash: PgBytea;
  parent_index_block_hash: PgBytea;
  microblock_hash: PgBytea;
  microblock_sequence: number;
  microblock_canonical: boolean;
  canonical: boolean;
  asset_event_type_id: DbAssetEventTypeId;
  sender: string | null;
  recipient: string | null;
  amount: bigint;
  memo: PgBytea | null;
}

export interface MinerRewardInsertValues {
  block_hash: PgBytea;
  index_block_hash: PgBytea;
  from_index_block_hash: PgBytea;
  mature_block_height: number;
  canonical: boolean;
  recipient: string;
  miner_address: string | null;
  coinbase_amount: PgNumeric;
  tx_fees_anchored: PgNumeric;
  tx_fees_streamed_confirmed: PgNumeric;
  tx_fees_streamed_produced: PgNumeric;
}

export interface StxLockEventInsertValues {
  event_index: number;
  tx_id: PgBytea;
  tx_index: number;
  block_height: number;
  index_block_hash: PgBytea;
  parent_index_block_hash: PgBytea;
  microblock_hash: PgBytea;
  microblock_sequence: number;
  microblock_canonical: boolean;
  canonical: boolean;
  locked_amount: PgNumeric;
  unlock_height: number;
  locked_address: string;
  contract_name: string;
}

export interface RawEventRequestInsertValues {
  event_path: string;
  payload: string;
}

export interface PoxSyntheticEventQueryResult {
  event_index: number;
  tx_id: string;
  tx_index: number;
  block_height: number;
  index_block_hash: string;
  parent_index_block_hash: string;
  microblock_hash: string;
  microblock_sequence: number;
  microblock_canonical: boolean;
  canonical: boolean;
  stacker: string;
  locked: string;
  balance: string;
  burnchain_unlock_height: string;
  name: string;
  pox_addr: string | null;
  pox_addr_raw: string | null;

  // unique to handle-unlock
  first_cycle_locked: string | null;

  // unique to handle-unlock
  first_unlocked_cycle: string | null;

  // unique to stack-stx, delegate-stack-stx
  lock_period: string | null;

  // unique to stack-stx, delegate-stack-stx
  lock_amount: string | null;

  // unique to stack-stx, delegate-stack-stx
  start_burn_height: string | null;

  // unique to stack-stx, stack-extend, delegate-stack-stx, delegate-stack-extend, delegate-stx
  unlock_burn_height: string | null;

  // unique to delegate-stack-stx, delegate-stack-increase, delegate-stack-extend
  delegator: string | null;

  // unique to delegate-stx
  delegate_to: string | null;

  // unique to stack-increase, delegate-stack-increase
  increase_by: string | null;

  // unique to stack-increase, delegate-stack-increase
  total_locked: string | null;

  // unique to stack-extend, delegate-stack-extend
  extend_count: string | null;

  // unique to stack-aggregation-commit
  reward_cycle: string | null;

  // unique to stack-aggregation-commit, delegate-stx
  amount_ustx: string | null;
}

export interface PoxSyntheticEventInsertValues {
  event_index: number;
  tx_id: PgBytea;
  tx_index: number;
  block_height: number;
  index_block_hash: PgBytea;
  parent_index_block_hash: PgBytea;
  microblock_hash: PgBytea;
  microblock_sequence: number;
  microblock_canonical: boolean;
  canonical: boolean;
  stacker: string;
  locked: PgNumeric;
  balance: PgNumeric;
  burnchain_unlock_height: PgNumeric;
  name: string;
  pox_addr: string | null;
  pox_addr_raw: PgBytea | null;

  // unique to handle-unlock
  first_cycle_locked: PgNumeric | null;

  // unique to handle-unlock
  first_unlocked_cycle: PgNumeric | null;

  // unique to delegate-stx
  delegate_to: string | null;

  // unique to stack-stx, delegate-stack-stx
  lock_period: PgNumeric | null;

  // unique to stack-stx, delegate-stack-stx
  lock_amount: PgNumeric | null;

  // unique to stack-stx, delegate-stack-stx
  start_burn_height: PgNumeric | null;

  unlock_burn_height: PgNumeric | null;

  // unique to delegate-stack-stx, delegate-stack-increase, delegate-stack-extend
  delegator: string | null;

  // unique to stack-increase, delegate-stack-increase
  increase_by: PgNumeric | null;

  // unique to stack-increase, delegate-stack-increase
  total_locked: PgNumeric | null;

  // unique to stack-extend, delegate-stack-extend
  extend_count: PgNumeric | null;

  // unique to stack-aggregation-commit
  reward_cycle: PgNumeric | null;

  // unique to stack-aggregation-commit, delegate-stx
  amount_ustx: PgNumeric | null;
}

export interface NftEventInsertValues {
  event_index: number;
  tx_id: PgBytea;
  tx_index: number;
  block_height: number;
  index_block_hash: PgBytea;
  parent_index_block_hash: PgBytea;
  microblock_hash: PgBytea;
  microblock_sequence: number;
  microblock_canonical: boolean;
  canonical: boolean;
  asset_event_type_id: DbAssetEventTypeId;
  sender: string | null;
  recipient: string | null;
  asset_identifier: string;
  value: PgBytea;
}

export interface NftCustodyInsertValues {
  event_index: number;
  tx_id: PgBytea;
  tx_index: number;
  block_height: number;
  index_block_hash: PgBytea;
  parent_index_block_hash: PgBytea;
  microblock_hash: PgBytea;
  microblock_sequence: number;
  recipient: string | null;
  asset_identifier: string;
  value: PgBytea;
}

export interface FtEventInsertValues {
  event_index: number;
  tx_id: PgBytea;
  tx_index: number;
  block_height: number;
  index_block_hash: PgBytea;
  parent_index_block_hash: PgBytea;
  microblock_hash: PgBytea;
  microblock_sequence: number;
  microblock_canonical: boolean;
  canonical: boolean;
  asset_event_type_id: DbAssetEventTypeId;
  sender: string | null;
  recipient: string | null;
  asset_identifier: string;
  amount: PgNumeric;
}

export interface SmartContractEventInsertValues {
  event_index: number;
  tx_id: PgBytea;
  tx_index: number;
  block_height: number;
  index_block_hash: PgBytea;
  parent_index_block_hash: PgBytea;
  microblock_hash: PgBytea;
  microblock_sequence: number;
  microblock_canonical: boolean;
  canonical: boolean;
  contract_identifier: string;
  topic: string;
  value: PgBytea;
}

export interface BurnchainRewardInsertValues {
  canonical: boolean;
  burn_block_hash: PgBytea;
  burn_block_height: number;
  burn_amount: PgNumeric;
  reward_recipient: string;
  reward_amount: bigint;
  reward_index: number;
}

export interface BnsNameInsertValues {
  name: string;
  address: string;
  registered_at: number;
  expire_block: number;
  zonefile_hash: string;
  namespace_id: string;
  tx_index: number;
  tx_id: PgBytea;
  event_index: number | null;
  status: string | null;
  canonical: boolean;
  index_block_hash: PgBytea;
  parent_index_block_hash: PgBytea;
  microblock_hash: PgBytea;
  microblock_sequence: number;
  microblock_canonical: boolean;
}

export interface BnsSubdomainInsertValues {
  name: string;
  namespace_id: string;
  fully_qualified_subdomain: string;
  owner: string;
  zonefile_hash: string;
  parent_zonefile_hash: string;
  parent_zonefile_index: number;
  block_height: number;
  tx_index: number;
  zonefile_offset: number;
  resolver: string;
  canonical: boolean;
  tx_id: PgBytea;
  index_block_hash: PgBytea;
  parent_index_block_hash: PgBytea;
  microblock_hash: PgBytea;
  microblock_sequence: number;
  microblock_canonical: boolean;
}

export interface BnsNamespaceInsertValues {
  namespace_id: string;
  launched_at: number | null;
  address: string;
  reveal_block: number;
  ready_block: number;
  buckets: string;
  base: PgNumeric;
  coeff: PgNumeric;
  nonalpha_discount: PgNumeric;
  no_vowel_discount: PgNumeric;
  lifetime: number;
  status: string | null;
  tx_index: number;
  tx_id: PgBytea;
  canonical: boolean;
  index_block_hash: PgBytea;
  parent_index_block_hash: PgBytea;
  microblock_hash: PgBytea;
  microblock_sequence: number;
  microblock_canonical: boolean;
}

export interface BnsZonefileInsertValues {
  name: string;
  zonefile: string;
  zonefile_hash: string;
  tx_id: PgBytea;
  index_block_hash: PgBytea;
}

export interface FaucetRequestInsertValues {
  currency: DbFaucetRequestCurrency;
  address: string;
  ip: string;
  occurred_at: number;
}

export interface PrincipalStxTxsInsertValues {
  principal: string;
  tx_id: PgBytea;
  block_height: number;
  index_block_hash: PgBytea;
  microblock_hash: PgBytea;
  microblock_sequence: number;
  tx_index: number;
  canonical: boolean;
  microblock_canonical: boolean;
}

export interface RewardSlotHolderInsertValues {
  canonical: boolean;
  burn_block_hash: PgBytea;
  burn_block_height: number;
  address: string;
  slot_index: number;
}

export interface SmartContractInsertValues {
  tx_id: PgBytea;
  canonical: boolean;
  contract_id: string;
  block_height: number;
  index_block_hash: PgBytea;
  clarity_version: number | null;
  source_code: string;
  abi: PgJsonb;
  parent_index_block_hash: PgBytea;
  microblock_hash: PgBytea;
  microblock_sequence: number;
  microblock_canonical: boolean;
}

export interface DbChainTip {
  block_height: number;
  block_count: number;
  block_hash: string;
  index_block_hash: string;
  burn_block_height: number;
  microblock_hash?: string;
  microblock_sequence?: number;
  microblock_count: number;
  tx_count: number;
  tx_count_unanchored: number;
  mempool_tx_count: number;
}

export enum IndexesState {
  Off = 0,
  On = 1,
}

export interface DbSmartContractStatus {
  smart_contract_contract_id: string;
  tx_id: string;
  status: DbTxStatus;
  block_height?: number;
}
