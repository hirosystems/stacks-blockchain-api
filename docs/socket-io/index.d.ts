import type { AddressTransactionWithTransfers, Block, MempoolTransaction } from '..';

export type AddressTransactionsRoom<TAddress extends string = string> = `address-transactions:${TAddress}`;
export type AddressBalanceRoom<TAddress extends string = string> = `address-balance:${TAddress}`;
export type Room = 'blocks' | 'mempool' | AddressTransactionsRoom | AddressBalanceRoom;

export interface ClientToServerMessages {
  subscribe: (...room: Room[]) => void;
  unsubscribe: (...room: Room[]) => void;
}

export interface ServerToClientMessages {
  block: (block: Block) => void;
  mempool: (transaction: MempoolTransaction) => void;
  'address-transaction': (address: string, tx: AddressTransactionWithTransfers) => void;
}
