import type {
  AddressStxBalanceResponse,
  AddressTransactionWithTransfers,
  Block,
  Microblock,
  Transaction,
  MempoolTransaction,
  NftEvent
} from '..';

export type AddressTransactionTopic = `address-transaction:${string}`;
export type AddressStxBalanceTopic = `address-stx-balance:${string}`;
export type TransactionTopic = `transaction:${string}`;
export type NftAssetEventTopic = `nft-asset-event:${string}+${string}`;
export type NftCollectionEventTopic = `nft-collection-event:${string}`;
export type Topic =
  | 'block'
  | 'microblock'
  | 'mempool'
  | 'nft-event'
  | AddressTransactionTopic
  | AddressStxBalanceTopic
  | TransactionTopic
  | NftAssetEventTopic
  | NftCollectionEventTopic;

export interface ClientToServerMessages {
  subscribe: (topic: Topic | Topic[], callback: (error: string | null) => void) => void;
  unsubscribe: (...topic: Topic[]) => void;
}

export interface ServerToClientMessages {
  block: (block: Block) => void;
  microblock: (microblock: Microblock) => void;
  mempool: (transaction: MempoolTransaction) => void;
  'nft-event': (event: NftEvent) => void;
  [key: TransactionTopic]: (transaction: Transaction | MempoolTransaction) => void;
  [key: NftAssetEventTopic]: (assetIdentifier: string, value: string, event: NftEvent) => void;
  [key: NftCollectionEventTopic]: (assetIdentifier: string, event: NftEvent) => void;
  [key: AddressTransactionTopic]: (address: string, stxBalance: AddressTransactionWithTransfers) => void;
  [key: AddressStxBalanceTopic]: (address: string, stxBalance: AddressStxBalanceResponse) => void;
}
