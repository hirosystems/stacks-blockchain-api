import type { Block, MempoolTransaction } from '..';

export type AddressRoom<TAddress extends string = string> = `address:${TAddress}`;
export type Room = 'blocks' | 'mempool' | AddressRoom;

export interface ClientToServerMessages {
  subscribe: (...room: Room[]) => void;
  unsubscribe: (...room: Room[]) => void;
}

export interface ServerToClientMessages {
  block: (block: Block) => void;
  mempool: (transaction: MempoolTransaction) => void;
}
