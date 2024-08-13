import { io, Socket } from 'socket.io-client';
import type { ManagerOptions, SocketOptions } from 'socket.io-client';
import type { 
  AddressStxBalanceResponse,
  AddressTransactionWithTransfers,
  Block,
  ClientToServerMessages,
  MempoolTransaction,
  Microblock,
  NftEvent,
  ServerToClientMessages,
  Topic,
  Transaction,
} from '../types';
import { BASE_PATH } from '../common';

export type StacksApiSocket = Socket<ServerToClientMessages, ClientToServerMessages>;

function getWsUrl(url: string): URL {
  let urlObj: URL;
  try {
    urlObj = new URL(url);
    if (!urlObj.protocol || !urlObj.host) {
      throw new TypeError(`[ERR_INVALID_URL]: Invalid URL: ${url}`);
    }
  } catch (error) {
    console.error(`Pass an absolute URL with a protocol/schema, e.g. "wss://example.com"`);
    throw error;
  }
  return urlObj;
}

export type StacksApiSocketConnectionOptions = {
  url?: string;
  /** Initial topics to subscribe to. */
  subscriptions?: Topic[];
  socketOpts?: Partial<ManagerOptions & SocketOptions>;
};

function createStacksApiSocket(opts?: StacksApiSocketConnectionOptions) {
  const socketOpts = {
    ...opts?.socketOpts,
    query: {
      ...opts?.socketOpts?.query,
      // Subscriptions can be specified on init using this handshake query param.
      subscriptions: Array.from(new Set(opts?.subscriptions)).join(','),
    },
  };
  if (!socketOpts.transports) {
    socketOpts.transports = ['websocket'];
  }
  const socket: StacksApiSocket = io(getWsUrl(opts?.url ?? BASE_PATH).href, socketOpts);
  return socket;
}

export class StacksApiSocketClient {
  readonly socket: StacksApiSocket;

  constructor(socket: StacksApiSocket);
  constructor(opts?: StacksApiSocketConnectionOptions);
  constructor(args?: StacksApiSocket | StacksApiSocketConnectionOptions) {
    if (args instanceof Socket) {
      this.socket = args;
    } else {
      this.socket = createStacksApiSocket(args);
    }
  }

  public static connect(opts?: StacksApiSocketConnectionOptions) {
    return new StacksApiSocketClient(opts);
  }

  handleSubscription(topic: Topic, subscribe = false, listener?: (...args: any[]) => void) {
    const subsQuery = this.socket.io.opts.query?.subscriptions as string | undefined;
    const subscriptions = new Set(subsQuery?.split(',') ?? []);
    if (subscribe) {
      this.socket.emit('subscribe', topic, error => {
        if (error) console.error(`Error subscribing: ${error}`);
      });
      subscriptions.add(topic);
    } else {
      this.socket.emit('unsubscribe', topic);
      subscriptions.delete(topic);
    }
    // Update the subscriptions in the socket handshake so topics are persisted on re-connect.
    if (this.socket.io.opts.query === undefined) {
      this.socket.io.opts.query = {};
    }
    this.socket.io.opts.query.subscriptions = Array.from(subscriptions).join(',');
    return {
      unsubscribe: () => {
        if (listener) {
          this.socket.off(topic, listener);
        }
        this.handleSubscription(topic, false);
      },
    };
  }

  subscribeBlocks(listener?: (tx: Block) => void) {
    if (listener) this.socket.on('block', listener);
    return this.handleSubscription('block', true, listener);
  }

  unsubscribeBlocks() {
    this.handleSubscription('block', false);
  }

  subscribeMicroblocks(listener?: (tx: Microblock) => void) {
    if (listener) this.socket.on('microblock', listener);
    return this.handleSubscription('microblock', true, listener);
  }

  unsubscribeMicroblocks() {
    this.handleSubscription('microblock', false);
  }

  subscribeMempool(listener?: (tx: MempoolTransaction) => void) {
    if (listener) this.socket.on('mempool', listener);
    return this.handleSubscription('mempool', true, listener);
  }

  unsubscribeMempool() {
    this.handleSubscription('mempool', false);
  }

  subscribeAddressTransactions(
    address: string,
    listener?: (address: string, tx: AddressTransactionWithTransfers) => void
  ) {
    if (listener) this.socket.on(`address-transaction:${address}`, listener);
    return this.handleSubscription(`address-transaction:${address}`, true, listener);
  }

  unsubscribeAddressTransactions(address: string) {
    this.handleSubscription(`address-transaction:${address}`, false);
  }

  subscribeAddressStxBalance(
    address: string,
    listener?: (address: string, stxBalance: AddressStxBalanceResponse) => void
  ) {
    if (listener) this.socket.on(`address-stx-balance:${address}`, listener);
    return this.handleSubscription(`address-stx-balance:${address}`, true, listener);
  }

  unsubscribeAddressStxBalance(address: string) {
    this.handleSubscription(`address-stx-balance:${address}`, false);
  }

  subscribeTransaction(txId: string, listener?: (tx: MempoolTransaction | Transaction) => void) {
    if (listener) this.socket.on(`transaction:${txId}`, listener);
    return this.handleSubscription(`transaction:${txId}`, true, listener);
  }

  unsubscribeTransaction(txId: string) {
    this.handleSubscription(`transaction:${txId}`, false);
  }

  subscribeNftEvent(listener?: (event: NftEvent) => void) {
    if (listener) this.socket.on('nft-event', listener);
    return this.handleSubscription('nft-event', true, listener);
  }

  unsubscribeNftEvent() {
    this.handleSubscription('nft-event', false);
  }

  subscribeNftAssetEvent(
    assetIdentifier: string,
    value: string,
    listener?: (assetIdentifier: string, value: string, event: NftEvent) => void
  ) {
    if (listener) this.socket.on(`nft-asset-event:${assetIdentifier}+${value}`, listener);
    return this.handleSubscription(`nft-asset-event:${assetIdentifier}+${value}`, true, listener);
  }

  unsubscribeNftAssetEvent(assetIdentifier: string, value: string) {
    this.handleSubscription(`nft-asset-event:${assetIdentifier}+${value}`, false);
  }

  subscribeNftCollectionEvent(
    assetIdentifier: string,
    listener?: (assetIdentifier: string, event: NftEvent) => void
  ) {
    if (listener) this.socket.on(`nft-collection-event:${assetIdentifier}`, listener);
    return this.handleSubscription(`nft-collection-event:${assetIdentifier}`, true, listener);
  }

  unsubscribeNftCollectionEvent(assetIdentifier: string) {
    this.handleSubscription(`nft-collection-event:${assetIdentifier}`, false);
  }

  logEvents() {
    this.socket.on('connect', () => console.log('socket connected'));
    this.socket.on('disconnect', reason => console.warn('disconnected', reason));
    this.socket.on('connect_error', error => console.error('connect_error', error));
    this.socket.on('block', block => console.log('block', block));
    this.socket.on('microblock', microblock => console.log('microblock', microblock));
    this.socket.on('mempool', tx => console.log('mempool', tx));
    this.socket.on('nft-event', event => console.log('nft-event', event));
  }
}
