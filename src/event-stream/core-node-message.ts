import { DecodedTxResult } from 'stacks-encoding-native-js';
import { ClarityAbi } from './contract-abi';

export enum CoreNodeEventType {
  ContractEvent = 'contract_event',
  StxTransferEvent = 'stx_transfer_event',
  StxMintEvent = 'stx_mint_event',
  StxBurnEvent = 'stx_burn_event',
  StxLockEvent = 'stx_lock_event',
  NftTransferEvent = 'nft_transfer_event',
  NftMintEvent = 'nft_mint_event',
  NftBurnEvent = 'nft_burn_event',
  FtTransferEvent = 'ft_transfer_event',
  FtMintEvent = 'ft_mint_event',
  FtBurnEvent = 'ft_burn_event',
}

// TODO: core-node should use a better encoding for this structure;
type NonStandardClarityValue = unknown;

interface CoreNodeEventBase {
  /** 0x-prefix transaction hash. */
  txid: string;
  event_index: number;
  committed: boolean;
}

export interface SmartContractEvent extends CoreNodeEventBase {
  type: CoreNodeEventType.ContractEvent;
  contract_event: {
    /** Fully qualified contract ID, e.g. "ST2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1MH.kv-store" */
    contract_identifier: string;
    topic: string;
    value: NonStandardClarityValue;
    /** Hex encoded Clarity value. */
    raw_value: string;
  };
}

export interface StxTransferEvent extends CoreNodeEventBase {
  type: CoreNodeEventType.StxTransferEvent;
  stx_transfer_event: {
    recipient: string;
    sender: string;
    amount: string;
    /** Hex-encoded string. Only provided when a memo was specified in the Clarity `stx-transfer?` function (requires a Stacks 2.1 contract). */
    memo?: string;
  };
}

interface StxMintEvent extends CoreNodeEventBase {
  type: CoreNodeEventType.StxMintEvent;
  stx_mint_event: {
    recipient: string;
    amount: string;
  };
}

interface StxBurnEvent extends CoreNodeEventBase {
  type: CoreNodeEventType.StxBurnEvent;
  stx_burn_event: {
    sender: string;
    amount: string;
  };
}

export interface StxLockEvent extends CoreNodeEventBase {
  type: CoreNodeEventType.StxLockEvent;
  /** TODO: what dis? */
  committed: boolean;
  stx_lock_event: {
    /** String quoted base10 integer. */
    locked_amount: string;
    /** String quoted base10 integer. */
    unlock_height: string;
    /** STX principal associated with the locked tokens. */
    locked_address: string;
    /** Fully qualified contract ID, e.g. "ST2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1MH.pox" or "ST2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1MH.pox-2" */
    contract_identifier?: string;
  };
}

export interface NftTransferEvent extends CoreNodeEventBase {
  type: CoreNodeEventType.NftTransferEvent;
  nft_transfer_event: {
    /** Fully qualified asset ID, e.g. "ST2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1MH.contract-name.asset-name" */
    asset_identifier: string;
    recipient: string;
    sender: string;
    value: NonStandardClarityValue;
    /** Hex encoded Clarity value. */
    raw_value: string;
  };
}

interface NftMintEvent extends CoreNodeEventBase {
  type: CoreNodeEventType.NftMintEvent;
  nft_mint_event: {
    /** Fully qualified asset ID, e.g. "ST2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1MH.contract-name.asset-name" */
    asset_identifier: string;
    recipient: string;
    value: NonStandardClarityValue;
    /** Hex encoded Clarity value. */
    raw_value: string;
  };
}

interface NftBurnEvent extends CoreNodeEventBase {
  type: CoreNodeEventType.NftBurnEvent;
  nft_burn_event: {
    /** Fully qualified asset ID, e.g. "ST2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1MH.contract-name.asset-name" */
    asset_identifier: string;
    sender: string;
    value: NonStandardClarityValue;
    /** Hex encoded Clarity value. */
    raw_value: string;
  };
}

interface FtTransferEvent extends CoreNodeEventBase {
  type: CoreNodeEventType.FtTransferEvent;
  ft_transfer_event: {
    /** Fully qualified asset ID, e.g. "ST2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1MH.contract-name.asset-name" */
    asset_identifier: string;
    recipient: string;
    sender: string;
    amount: string;
  };
}

interface FtMintEvent extends CoreNodeEventBase {
  type: CoreNodeEventType.FtMintEvent;
  ft_mint_event: {
    /** Fully qualified asset ID, e.g. "ST2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1MH.contract-name.asset-name" */
    asset_identifier: string;
    recipient: string;
    amount: string;
  };
}

interface FtBurnEvent extends CoreNodeEventBase {
  type: CoreNodeEventType.FtBurnEvent;
  ft_burn_event: {
    /** Fully qualified asset ID, e.g. "ST2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1MH.contract-name.asset-name" */
    asset_identifier: string;
    sender: string;
    amount: string;
  };
}

export type CoreNodeEvent =
  | SmartContractEvent
  | StxTransferEvent
  | StxMintEvent
  | StxBurnEvent
  | StxLockEvent
  | FtTransferEvent
  | FtMintEvent
  | FtBurnEvent
  | NftTransferEvent
  | NftMintEvent
  | NftBurnEvent;

export type CoreNodeTxStatus = 'success' | 'abort_by_response' | 'abort_by_post_condition';

export interface CoreNodeTxMessage {
  raw_tx: string;
  status: CoreNodeTxStatus;
  raw_result: string;
  txid: string;
  tx_index: number;
  contract_abi: ClarityAbi | null;
  execution_cost: CoreNodeExecutionCostMessage;
  microblock_sequence: number | null;
  microblock_hash: string | null;
  microblock_parent_hash: string | null;
}

export interface CoreNodeMicroblockTxMessage extends CoreNodeTxMessage {
  microblock_sequence: number;
  microblock_hash: string;
  microblock_parent_hash: string;
}

export function isTxWithMicroblockInfo(tx: CoreNodeTxMessage): tx is CoreNodeMicroblockTxMessage {
  if (tx.microblock_hash && tx.microblock_parent_hash && tx.microblock_sequence !== null) {
    return true;
  }
  if (tx.microblock_hash || tx.microblock_parent_hash || tx.microblock_sequence !== null) {
    throw new Error(
      `Unexpected transaction object that contains only partial microblock data: ${JSON.stringify(
        tx
      )}`
    );
  }
  return false;
}

export interface CoreNodeBlockMessage {
  block_hash: string;
  block_height: number;
  burn_block_time: number;
  burn_block_hash: string;
  burn_block_height: number;
  miner_txid: string;
  index_block_hash: string;
  parent_index_block_hash: string;
  parent_block_hash: string;
  parent_microblock: string;
  parent_microblock_sequence: number;
  parent_burn_block_hash: string;
  parent_burn_block_height: number;
  parent_burn_block_timestamp: number;
  events: CoreNodeEvent[];
  transactions: CoreNodeTxMessage[];
  matured_miner_rewards: {
    from_index_consensus_hash: string;
    from_stacks_block_hash: string;
    /** STX principal */
    recipient: string;
    /** STX principal (available starting in Stacks 2.1) */
    miner_address: string | null;
    /** String quoted micro-STX amount. */
    coinbase_amount: string;
    /** String quoted micro-STX amount. */
    tx_fees_anchored: string;
    /** String quoted micro-STX amount. */
    tx_fees_streamed_confirmed: string;
    /** String quoted micro-STX amount. */
    tx_fees_streamed_produced: string;
  }[];
  pox_v1_unlock_height?: number;
}

export interface CoreNodeParsedTxMessage {
  core_tx: CoreNodeTxMessage;
  parsed_tx: DecodedTxResult;
  raw_tx: string;
  nonce: number;
  sender_address: string;
  sponsor_address: string | undefined;
  block_hash: string;
  index_block_hash: string;
  parent_index_block_hash: string;
  parent_block_hash: string;
  microblock_sequence: number;
  microblock_hash: string;
  block_height: number;
  burn_block_time: number;
  parent_burn_block_time: number;
  parent_burn_block_hash: string;
}

export interface CoreNodeBurnBlockMessage {
  burn_block_hash: string;
  burn_block_height: number;
  /** Amount in BTC satoshis. */
  burn_amount: number;
  reward_recipients: [
    {
      /** Bitcoin address (b58 encoded). */
      recipient: string;
      /** Amount in BTC satoshis. */
      amt: number;
    }
  ];
  /**
   * Array of the Bitcoin addresses that would validly receive PoX commitments during this block.
   * These addresses may not actually receive rewards during this block if the block is faster
   * than miners have an opportunity to commit.
   */
  reward_slot_holders: string[];
}

export type CoreNodeDropMempoolTxReasonType =
  | 'ReplaceByFee'
  | 'ReplaceAcrossFork'
  | 'TooExpensive'
  | 'StaleGarbageCollect';

export interface CoreNodeDropMempoolTxMessage {
  dropped_txids: string[];
  reason: CoreNodeDropMempoolTxReasonType;
}

export interface CoreNodeAttachmentMessage {
  attachment_index: number;
  index_block_hash: string;
  block_height: string; // string quoted integer?
  content_hash: string;
  contract_id: string;
  /** Hex serialized Clarity value */
  metadata: string;
  tx_id: string;
  /* Hex encoded attachment content bytes */
  content: string;
}

interface CoreNodeExecutionCostMessage {
  read_count: number;
  read_length: number;
  runtime: number;
  write_count: number;
  write_length: number;
}

export interface CoreNodeMicroblockMessage {
  parent_index_block_hash: string;
  burn_block_hash: string;
  burn_block_height: number;
  burn_block_timestamp: number;
  // TODO(mb): assume this is too hard to get from the stacks-node event
  // parent_block_hash: string;
  transactions: CoreNodeMicroblockTxMessage[];
  events: CoreNodeEvent[];
}
