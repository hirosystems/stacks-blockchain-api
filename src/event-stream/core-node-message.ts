import { Transaction } from '../p2p/tx';
import { ClarityAbi } from './contract-abi';

export enum CoreNodeEventType {
  ContractEvent = 'contract_event',
  StxTransferEvent = 'stx_transfer_event',
  StxMintEvent = 'stx_mint_event',
  StxBurnEvent = 'stx_burn_event',
  NftTransferEvent = 'nft_transfer_event',
  NftMintEvent = 'nft_mint_event',
  FtTransferEvent = 'ft_transfer_event',
  FtMintEvent = 'ft_mint_event',
}

// TODO: core-node should use a better encoding for this structure;
export type NonStandardClarityValue = unknown;

export interface CoreNodeEventBase {
  txid: string;
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
  };
}

export interface StxMintEvent extends CoreNodeEventBase {
  type: CoreNodeEventType.StxMintEvent;
  stx_mint_event: {
    recipient: string;
    amount: string;
  };
}

export interface StxBurnEvent extends CoreNodeEventBase {
  type: CoreNodeEventType.StxBurnEvent;
  stx_burn_event: {
    sender: string;
    amount: string;
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

export interface NftMintEvent extends CoreNodeEventBase {
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

export interface FtTransferEvent extends CoreNodeEventBase {
  type: CoreNodeEventType.FtTransferEvent;
  ft_transfer_event: {
    /** Fully qualified asset ID, e.g. "ST2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1MH.contract-name.asset-name" */
    asset_identifier: string;
    recipient: string;
    sender: string;
    amount: string;
  };
}

export interface FtMintEvent extends CoreNodeEventBase {
  type: CoreNodeEventType.FtMintEvent;
  ft_mint_event: {
    /** Fully qualified asset ID, e.g. "ST2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1MH.contract-name.asset-name" */
    asset_identifier: string;
    recipient: string;
    amount: string;
  };
}

export type CoreNodeEvent =
  | SmartContractEvent
  | StxTransferEvent
  | StxMintEvent
  | StxBurnEvent
  | FtTransferEvent
  | FtMintEvent
  | NftTransferEvent
  | NftMintEvent;

export type CoreNodeTxStatus = 'success' | 'abort_by_response' | 'abort_by_post_condition';

export interface CoreNodeTxMessage {
  raw_tx: string;
  result: NonStandardClarityValue;
  status: CoreNodeTxStatus;
  raw_result: string;
  txid: string;
  tx_index: number;
  contract_abi: ClarityAbi | null;
}

export interface CoreNodeMessage {
  block_hash: string;
  block_height: number;
  burn_block_time: number;
  index_block_hash: string;
  parent_index_block_hash: string;
  parent_block_hash: string;
  parent_microblock: string;
  events: CoreNodeEvent[];
  transactions: CoreNodeTxMessage[];
}

export interface CoreNodeMessageParsed extends CoreNodeMessage {
  parsed_transactions: CoreNodeParsedTxMessage[];
}

export interface CoreNodeParsedTxMessage {
  core_tx: CoreNodeTxMessage;
  parsed_tx: Transaction;
  raw_tx: Buffer;
  sender_address: string;
  sponsor_address?: string;
  block_hash: string;
  index_block_hash: string;
  block_height: number;
  burn_block_time: number;
}
