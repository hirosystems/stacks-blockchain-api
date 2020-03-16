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

export interface CoreNodeEventMessage {
  type: CoreNodeEventType;
}

export interface SmartContractEvent extends CoreNodeEventMessage {
  type: CoreNodeEventType.ContractEvent;
  contract_event: {
    contract_identifier: string;
    topic: string;
    value: string;
  };
}

export interface StxTransferEvent extends CoreNodeEventMessage {
  type: CoreNodeEventType.StxTransferEvent;
  stx_transfer_event: any;
}

export interface StxMintEvent extends CoreNodeEventMessage {
  type: CoreNodeEventType.StxMintEvent;
  stx_mint_event: any;
}

export interface StxBurnEvent extends CoreNodeEventMessage {
  type: CoreNodeEventType.StxBurnEvent;
  stx_burn_event: any;
}

export interface NftTransferEvent extends CoreNodeEventMessage {
  type: CoreNodeEventType.NftTransferEvent;
  nft_transfer_event: any;
}

export interface NftMintEvent extends CoreNodeEventMessage {
  type: CoreNodeEventType.NftMintEvent;
  nft_mint_event: any;
}

export interface FtTransferEvent extends CoreNodeEventMessage {
  type: CoreNodeEventType.FtTransferEvent;
  ft_transfer_event: any;
}

export interface FtMintEvent extends CoreNodeEventMessage {
  type: CoreNodeEventType.FtMintEvent;
  ft_mint_event: any;
}

export interface CoreNodeMessage {
  block_hash: string;
  index_block_hash: string;
  parent_block_hash: string;
  parent_microblock: string;
  events: any[];
  transactions: string[];
}
