import type { AddressStxBalanceResponse, AddressTransactionWithTransfers, Block, MempoolTransaction } from '..';

export type AddressTransactionsRoom<TAddress extends string = string> = `address-transactions:${TAddress}`;
export type AddressStxBalanceRoom<TAddress extends string = string> = `address-stx-balance:${TAddress}`;
export type Room = 'blocks' | 'mempool' | AddressTransactionsRoom | AddressStxBalanceRoom;

export interface ClientToServerMessages {
  subscribe: (...room: Room[]) => void;
  unsubscribe: (...room: Room[]) => void;
}

export interface ServerToClientMessages {
  block: (block: Block) => void;
  mempool: (transaction: MempoolTransaction) => void;
  'address-transaction': (address: string, tx: AddressTransactionWithTransfers) => void;
  'address-stx-balance': (address: string, stxBalance: AddressStxBalanceResponse) => void;
}
