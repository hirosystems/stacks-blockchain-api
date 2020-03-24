import { Transaction } from '../p2p/tx';

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

// TODO: core-node should use better encoding for this structure
export interface StandardPrincipalData {
  /** Version byte */
  0: number;
  /** 20 byte octet array */
  1: number[];
}

// TODO: update when core is fixed (contracts should be valid token recipients)
// TODO: core-node should use better encoding for this structure
export type Principal = { Standard: StandardPrincipalData } | { Contract: any };

// TODO: core-node should use a better encoding for this structure;
export type NonStandardClarityValue = any;

export interface ContractIdentifier {
  issuer: StandardPrincipalData;
  name: string;
}

export interface AssetIdentifier {
  contract_identifier: ContractIdentifier;
  asset_name: string;
}

export interface CoreNodeEventBase {
  txid: string;
}

export interface SmartContractEvent extends CoreNodeEventBase {
  type: CoreNodeEventType.ContractEvent;
  contract_event: {
    /** Currently encoded in Clarity literal syntax, e.g. "'ST2ZRX0K27GW0SP3GJCEMHD95TQGJMKB7G9Y0X1MH.kv-store" */
    contract_identifier: string;
    topic: string;
    value: NonStandardClarityValue;
  };
}

export interface StxTransferEvent extends CoreNodeEventBase {
  type: CoreNodeEventType.StxTransferEvent;
  stx_transfer_event: {
    recipient: Principal;
    sender: Principal;
    amount: number | string;
  };
}

export interface StxMintEvent extends CoreNodeEventBase {
  type: CoreNodeEventType.StxMintEvent;
  stx_mint_event: {
    recipient: Principal;
    amount: number | string;
  };
}

export interface StxBurnEvent extends CoreNodeEventBase {
  type: CoreNodeEventType.StxBurnEvent;
  stx_burn_event: {
    sender: Principal;
    amount: number | string;
  };
}

export interface NftTransferEvent extends CoreNodeEventBase {
  type: CoreNodeEventType.NftTransferEvent;
  nft_transfer_event: {
    asset_identifier: AssetIdentifier;
    recipient: Principal;
    sender: Principal;
    value: NonStandardClarityValue;
  };
}

export interface NftMintEvent extends CoreNodeEventBase {
  type: CoreNodeEventType.NftMintEvent;
  nft_mint_event: {
    asset_identifier: AssetIdentifier;
    recipient: Principal;
    value: NonStandardClarityValue;
  };
}

export interface FtTransferEvent extends CoreNodeEventBase {
  type: CoreNodeEventType.FtTransferEvent;
  ft_transfer_event: {
    asset_identifier: AssetIdentifier;
    recipient: Principal;
    sender: Principal;
    amount: number | string;
  };
}

export interface FtMintEvent extends CoreNodeEventBase {
  type: CoreNodeEventType.FtMintEvent;
  ft_mint_event: {
    asset_identifier: AssetIdentifier;
    recipient: Principal;
    amount: number | string;
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

export interface CoreNodeTxMessage {
  raw_tx: string;
  result: NonStandardClarityValue;
  success: boolean;
  txid: string;
}

export interface CoreNodeMessage {
  block_hash: string;
  block_height: number;
  index_block_hash: string;
  parent_block_hash: string;
  parent_microblock: string;
  events: CoreNodeEvent[];
  transactions: CoreNodeTxMessage[];
}

export interface CoreNodeMessageParsed extends CoreNodeMessage {
  parsed_transactions: Transaction[];
}
