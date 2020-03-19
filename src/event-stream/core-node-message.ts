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

export interface SmartContractEvent {
  type: CoreNodeEventType.ContractEvent;
  contract_event: {
    contract_identifier: string;
    topic: string;
    value: string;
  };
}

export interface StxTransferEvent {
  type: CoreNodeEventType.StxTransferEvent;
  stx_transfer_event: any;
}

export interface StxMintEvent {
  type: CoreNodeEventType.StxMintEvent;
  stx_mint_event: any;
}

export interface StxBurnEvent {
  type: CoreNodeEventType.StxBurnEvent;
  stx_burn_event: any;
}

export interface NftTransferEvent {
  type: CoreNodeEventType.NftTransferEvent;
  nft_transfer_event: any;
}

export interface NftMintEvent {
  type: CoreNodeEventType.NftMintEvent;
  nft_mint_event: any;
}

export interface FtTransferEvent {
  type: CoreNodeEventType.FtTransferEvent;
  ft_transfer_event: any;
}

export interface FtMintEvent {
  type: CoreNodeEventType.FtMintEvent;
  ft_mint_event: any;
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

export interface CoreNodeMessage {
  block_hash: string;
  index_block_hash: string;
  parent_block_hash: string;
  parent_microblock: string;
  events: CoreNodeEvent[];
  transactions: string[];
}

export interface CoreNodeMessageParsed extends CoreNodeMessage {
  parsed_transactions: Transaction[];
}
