import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { ClientToServerMessages, Room, ServerToClientMessages } from '@stacks/stacks-blockchain-api-types';
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
  /** Initial rooms to subscribe to. */
  subscriptions?: Room[],
}

export class StacksApiSocketClient {
  readonly socket: StacksApiSocket;

  constructor(socket: StacksApiSocket) {
    this.socket = socket;   
    this.logEvents();
  }

  public static connect({
    url = BASE_PATH, 
    subscriptions = [] 
  }: StacksApiSocketConnectionOptions = {}) {
    const rooms = new Set(subscriptions);
    const socket: StacksApiSocket = io(getWsUrl(url).href, {
      query: {
        // Room subscriptions can be specified on init using this handshake query param.
        subscriptions: Array.from(rooms).join(','),
      },
    });
    return new StacksApiSocketClient(socket);
  }

  handleSubscription(room: Room, subscribe = false) {
    const subscriptions = new Set(this.socket.io.opts.query?.subscriptions.split(',').map(r => r as Room) ?? []);
    if (subscribe) {
      this.socket.emit('subscribe', room);
      subscriptions.add(room);
    } else {
      this.socket.emit('unsubscribe', room);
      subscriptions.delete(room);
    }
    // Update the subscriptions in the socket handshake so rooms are persisted on re-connect.
    this.socket.io.opts.query!.subscriptions = Array.from(subscriptions).join(',');
    return { 
      unsubscribe: () => { 
        this.handleSubscription(room, false);
      }
    };
  }

  subscribeBlocks() {
    return this.handleSubscription('blocks', true);
  }

  unsubscribeBlocks() {
    this.handleSubscription('blocks', false);
  }

  subscribeMempool() {
    return this.handleSubscription('mempool', true);
  }

  unsubscribeMempool() {
    this.handleSubscription('mempool', false);
  }

  subscribeAddressTransactions(address: string) {
    return this.handleSubscription(`address-transactions:${address}` as const, true);
  }

  unsubscribeAddressTransactions(address: string) {
    this.handleSubscription(`address-transactions:${address}` as const, false);
  }

  subscribeAddressStxBalance(address: string) {
    return this.handleSubscription(`address-stx-balance:${address}` as const, true);
  }

  unsubscribeAddressStxBalance(address: string) {
    this.handleSubscription(`address-stx-balance:${address}` as const, false);
  }

  logEvents() {
    this.socket.on('connect_error', error => console.error('connect_error', error)); 
    this.socket.on('block', block => console.log('block', block));
    this.socket.on('mempool', tx => console.log('mempool', tx));
    this.socket.on('address-transaction', (address, data) => console.log('address-transaction', address, data));
    this.socket.on('address-stx-balance', (address, data) => console.log('address-stx-balance', address, data));
  }
}

