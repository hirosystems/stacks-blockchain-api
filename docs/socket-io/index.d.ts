import type { AddressStxBalanceResponse, AddressTransactionWithTransfers, Block, Microblock, MempoolTransaction } from '..';

export type AddressTransactionTopic = `address-transaction:${string}`;
export type AddressStxBalanceTopic = `address-stx-balance:${string}`;
export type Topic = 'block' | 'microblock' | 'mempool' | AddressTransactionTopic | AddressStxBalanceTopic;

export interface ClientToServerMessages {
  subscribe: (topic: Topic | Topic[], callback: (error: string | null) => void) => void;
  unsubscribe: (...topic: Topic[]) => void;
}

export interface ServerToClientMessages {
  block: (block: Block) => void;
  microblock: (microblock: Microblock) => void;
  mempool: (transaction: MempoolTransaction) => void;

  // @ts-ignore scheduled for support in TS v4.3 https://github.com/microsoft/TypeScript/pull/26797
  [key: AddressTransactionTopic]: (address: string, stxBalance: AddressTransactionWithTransfers) => void;
  'address-transaction': (address: string, tx: AddressTransactionWithTransfers) => void;

  // @ts-ignore scheduled for support in TS v4.3 https://github.com/microsoft/TypeScript/pull/26797
  [key: AddressStxBalanceTopic]: (address: string, stxBalance: AddressStxBalanceResponse) => void;
  'address-stx-balance': (address: string, stxBalance: AddressStxBalanceResponse) => void;
}
