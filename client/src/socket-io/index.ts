import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import {
  ClientToServerMessages,
  Topic,
  ServerToClientMessages,
} from '@stacks/stacks-blockchain-api-types';
import { BASE_PATH } from '../generated/runtime';

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

export interface StacksApiSocketConnectionOptions {
  url?: string;
  /** Initial topics to subscribe to. */
  subscriptions?: Topic[];
}

export class StacksApiSocketClient {
  readonly socket: StacksApiSocket;

  constructor(socket: StacksApiSocket) {
    this.socket = socket;
    this.logEvents();
  }

  public static connect({
    url = BASE_PATH,
    subscriptions = [],
  }: StacksApiSocketConnectionOptions = {}) {
    const socket: StacksApiSocket = io(getWsUrl(url).href, {
      query: {
        // Subscriptions can be specified on init using this handshake query param.
        subscriptions: Array.from(new Set(subscriptions)).join(','),
      },
    });
    return new StacksApiSocketClient(socket);
  }

  handleSubscription(topic: Topic, subscribe = false) {
    const subscriptions = new Set(this.socket.io.opts.query?.subscriptions.split(',') ?? []);
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
        this.handleSubscription(topic, false);
      },
    };
  }

  subscribeBlocks() {
    return this.handleSubscription('block', true);
  }

  unsubscribeBlocks() {
    this.handleSubscription('block', false);
  }

  subscribeMicroblocks() {
    return this.handleSubscription('microblock', true);
  }

  unsubscribeMicroblocks() {
    this.handleSubscription('microblock', false);
  }

  subscribeMempool() {
    return this.handleSubscription('mempool', true);
  }

  unsubscribeMempool() {
    this.handleSubscription('mempool', false);
  }

  subscribeAddressTransactions(address: string) {
    return this.handleSubscription(`address-transaction:${address}` as const, true);
  }

  unsubscribeAddressTransactions(address: string) {
    this.handleSubscription(`address-transaction:${address}` as const, false);
  }

  subscribeAddressStxBalance(address: string) {
    return this.handleSubscription(`address-stx-balance:${address}` as const, true);
  }

  unsubscribeAddressStxBalance(address: string) {
    this.handleSubscription(`address-stx-balance:${address}` as const, false);
  }

  logEvents() {
    this.socket.on('connect', () => console.log('socket connected'));
    this.socket.on('disconnect', reason => console.warn('disconnected', reason));
    this.socket.on('connect_error', error => console.error('connect_error', error));
    this.socket.on('block', block => console.log('block', block));
    this.socket.on('microblock', microblock => console.log('microblock', microblock));
    this.socket.on('mempool', tx => console.log('mempool', tx));
    this.socket.on('address-transaction', (address, data) =>
      console.log('address-transaction', address, data)
    );
    this.socket.on('address-stx-balance', (address, data) =>
      console.log('address-stx-balance', address, data)
    );
  }
}
