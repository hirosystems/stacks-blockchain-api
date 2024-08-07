import * as http from 'http';
import {
  AddressStxBalanceResponse,
  AddressTransactionWithTransfers,
  NftEvent,
} from 'client/src/types';
import { WebSocketPrometheus } from './web-socket-prometheus';
import { Block } from '../../schemas/entities/block';
import { Microblock } from '../../schemas/entities/microblock';
import { Transaction, MempoolTransaction } from '../../schemas/entities/transactions';

/**
 * Topics that external API users may subscribe to when looking for real time updates.
 * Not to be confused with `PgStoreEventEmitter` internal events or `WebSocketPayload` messages.
 */
export type WebSocketTopics = {
  block: () => void;
  microblock: () => void;
  mempool: () => void;
  transaction: (txId: string) => void;
  principalTransactions: (principal: string) => void;
  principalStxBalance: (principal: string) => void;
  nftEvent: () => void;
  nftAssetEvent: (assetIdentifier: string, value: string) => void;
  nftCollectionEvent: (assetIdentifier: string) => void;
};

/**
 * Payloads that can be sent to external API users depending on which `WebSocketTopics` they are
 * subscribed to. Each of these contains a full database object relevant to the response so each
 * channel may format the output according to its needs.
 */
export type WebSocketPayload = {
  block: (block: Block) => void;
  microblock: (microblock: Microblock) => void;
  mempoolTransaction: (transaction: MempoolTransaction) => void;
  transaction: (transaction: Transaction | MempoolTransaction) => void;
  principalTransaction: (principal: string, transaction: AddressTransactionWithTransfers) => void;
  principalStxBalance: (principal: string, stxBalance: AddressStxBalanceResponse) => void;
  nftEvent: (event: NftEvent) => void;
  nftAssetEvent: (assetIdentifier: string, value: string, event: NftEvent) => void;
  nftCollectionEvent: (assetIdentifier: string, event: NftEvent) => void;
};

/**
 * Type hack taken from https://github.com/bterlson/strict-event-emitter-types to dynamically set
 * the argument types depending on the selected topic or payload.
 */
export type ListenerType<T> = [T] extends [(...args: infer U) => any]
  ? U
  : [T] extends [void]
  ? []
  : [T];

/**
 * A channel that accepts user subscriptions to real time updates and responds with relevant
 * payloads through WebSockets (or its flavors like Socket.IO).
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
