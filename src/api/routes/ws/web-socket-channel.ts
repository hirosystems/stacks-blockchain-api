import * as http from 'http';
import {
  AddressStxBalanceResponse,
  AddressTransactionWithTransfers,
  Block,
  MempoolTransaction,
  Microblock,
  Transaction,
} from 'docs/generated';
import { WebSocketPrometheus } from './metrics';

/**
 * x
 */
export type WebSocketTopics = {
  block: () => void;
  microblock: () => void;
  mempool: () => void;
  transaction: (txId: string) => void;
  principalTransactions: (principal: string) => void;
  principalStxBalance: (principal: string) => void;
};

/**
 * y
 */
export type WebSocketPayload = {
  block: (block: Block) => void;
  microblock: (microblock: Microblock) => void;
  mempoolTransaction: (transaction: MempoolTransaction) => void;
  transaction: (transaction: Transaction | MempoolTransaction) => void;
  principalTransaction: (principal: string, transaction: AddressTransactionWithTransfers) => void;
  principalStxBalance: (principal: string, stxBalance: AddressStxBalanceResponse) => void;
};

/**
 * z
 */
export type ListenerType<T> = [T] extends [(...args: infer U) => any]
  ? U
  : [T] extends [void]
  ? []
  : [T];

/**
 * xx
 */
export abstract class WebSocketChannel {
  readonly server: http.Server;
  protected prometheus?: WebSocketPrometheus;

  constructor(server: http.Server) {
    this.server = server;
  }

  abstract connect(): void;

  abstract close(callback?: (err?: Error | undefined) => void): void;

  /** Checks if the channel has listeners for the specified topic */
  abstract hasListeners<P extends keyof WebSocketTopics>(
    topic: P,
    ...args: ListenerType<WebSocketTopics[P]>
  ): boolean;

  /** Sends a payload through the channel */
  abstract send<P extends keyof WebSocketPayload>(
    payload: P,
    ...args: ListenerType<WebSocketPayload[P]>
  ): void;
}
