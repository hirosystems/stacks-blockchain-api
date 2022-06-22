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
  transaction: (transaction: Transaction | MempoolTransaction) => void;

  // @ts-ignore scheduled for support in TS v4.3 https://github.com/microsoft/TypeScript/pull/26797
  [key: 'nft-event']: (event: NftEvent) => void;
  'nft-event': (event: NftEvent) => void;

  // @ts-ignore scheduled for support in TS v4.3 https://github.com/microsoft/TypeScript/pull/26797
  [key: NftAssetEventTopic]: (assetIdentifier: string, value: string, event: NftEvent) => void;
  'nft-asset-event': (assetIdentifier: string, value: string, event: NftEvent) => void;

  // @ts-ignore scheduled for support in TS v4.3 https://github.com/microsoft/TypeScript/pull/26797
  [key: NftCollectionEventTopic]: (assetIdentifier: string, event: NftEvent) => void;
  'nft-collection-event': (assetIdentifier: string, event: NftEvent) => void;

  // @ts-ignore scheduled for support in TS v4.3 https://github.com/microsoft/TypeScript/pull/26797
  [key: AddressTransactionTopic]: (address: string, stxBalance: AddressTransactionWithTransfers) => void;
  'address-transaction': (address: string, tx: AddressTransactionWithTransfers) => void;

  // @ts-ignore scheduled for support in TS v4.3 https://github.com/microsoft/TypeScript/pull/26797
  [key: AddressStxBalanceTopic]: (address: string, stxBalance: AddressStxBalanceResponse) => void;
  'address-stx-balance': (address: string, stxBalance: AddressStxBalanceResponse) => void;
}
