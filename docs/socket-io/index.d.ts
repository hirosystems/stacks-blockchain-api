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

// Allows timeout callbacks for messages. See
// https://socket.io/docs/v4/typescript/#emitting-with-a-timeout
type WithTimeoutAck<isSender extends boolean, args extends any[]> = isSender extends true ? [Error, ...args] : args;

export interface ClientToServerMessages {
  subscribe: (topic: Topic | Topic[], callback: (error: string | null) => void) => void;
  unsubscribe: (...topic: Topic[]) => void;
}

export interface ServerToClientMessages<isSender extends boolean = false> {
  block: (block: Block, callback: (...args: WithTimeoutAck<isSender, [string]>) => void) => void;
  microblock: (microblock: Microblock, callback: (...args: WithTimeoutAck<isSender, [string]>) => void) => void;
  mempool: (transaction: MempoolTransaction, callback: (...args: WithTimeoutAck<isSender, [string]>) => void) => void;
  transaction: (transaction: Transaction | MempoolTransaction, callback: (...args: WithTimeoutAck<isSender, [string]>) => void) => void;

  // @ts-ignore scheduled for support in TS v4.3 https://github.com/microsoft/TypeScript/pull/26797
  [key: 'nft-event']: (event: NftEvent, callback: (...args: WithTimeoutAck<isSender, [string]>) => void) => void;
  'nft-event': (event: NftEvent, callback: (...args: WithTimeoutAck<isSender, [string]>) => void) => void;

  // @ts-ignore scheduled for support in TS v4.3 https://github.com/microsoft/TypeScript/pull/26797
  [key: NftAssetEventTopic]: (assetIdentifier: string, value: string, event: NftEvent, callback: (...args: WithTimeoutAck<isSender, [string]>) => void) => void;
  'nft-asset-event': (assetIdentifier: string, value: string, event: NftEvent, callback: (...args: WithTimeoutAck<isSender, [string]>) => void) => void;

  // @ts-ignore scheduled for support in TS v4.3 https://github.com/microsoft/TypeScript/pull/26797
  [key: NftCollectionEventTopic]: (assetIdentifier: string, event: NftEvent, callback: (...args: WithTimeoutAck<isSender, [string]>) => void) => void;
  'nft-collection-event': (assetIdentifier: string, event: NftEvent, callback: (...args: WithTimeoutAck<isSender, [string]>) => void) => void;

  // @ts-ignore scheduled for support in TS v4.3 https://github.com/microsoft/TypeScript/pull/26797
  [key: AddressTransactionTopic]: (address: string, stxBalance: AddressTransactionWithTransfers, callback: (...args: WithTimeoutAck<isSender, [string]>) => void) => void;
  'address-transaction': (address: string, tx: AddressTransactionWithTransfers, callback: (...args: WithTimeoutAck<isSender, [string]>) => void) => void;

  // @ts-ignore scheduled for support in TS v4.3 https://github.com/microsoft/TypeScript/pull/26797
  [key: AddressStxBalanceTopic]: (address: string, stxBalance: AddressStxBalanceResponse, callback: (...args: WithTimeoutAck<isSender, [string]>) => void) => void;
  'address-stx-balance': (address: string, stxBalance: AddressStxBalanceResponse, callback: (...args: WithTimeoutAck<isSender, [string]>) => void) => void;
}
