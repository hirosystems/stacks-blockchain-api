import { io } from 'socket.io-client';
import type { Socket } from 'socket.io-client';
import { ClientToServerMessages, Room, ServerToClientMessages } from '@stacks/stacks-blockchain-api-types';
import { BASE_PATH } from '../generated/runtime';

export const StacksApiSocketIONamespace = '/';

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
  if (urlObj.pathname === '/') {
    urlObj.pathname = StacksApiSocketIONamespace;
  }
  return urlObj;
}

export interface StacksApiSocketConnectionOptions {
  url?: string;
  subscriptions?: Room[],
}

export class StacksApiSocketClient {
  readonly socket: StacksApiSocket;

  constructor(socket: StacksApiSocket) {
    this.socket = socket;
    this.socket.on('connect_error', error => console.error(error));
    // this.test();
  }

  public static connect({
    url = BASE_PATH, 
    subscriptions = ['blocks', 'mempool'] 
  }: StacksApiSocketConnectionOptions = {}) {
    const wsUrl = getWsUrl(url).href;
    const rooms = subscriptions?.join(',') ?? '';
    const socket: StacksApiSocket = io(wsUrl, {
      query: {
        subscriptions: rooms,
      },
    });
    return new StacksApiSocketClient(socket);
  }

  subscribeBlocks() {
    this.socket.emit('subscribe', 'blocks');
  }

  unsubscribeBlocks() {
    this.socket.emit('unsubscribe', 'blocks');
  }

  subscribeMempool() {
    this.socket.emit('subscribe', 'mempool');
  }

  unsubscribeMempool() {
    this.socket.emit('unsubscribe', 'mempool');
  }

  subscribeAddressTransactions(address: string) {
    this.socket.emit('subscribe', `address-transactions:${address}` as const);
  }

  unsubscribeAddressTransactions(address: string) {
    this.socket.emit('unsubscribe', `address-transactions:${address}` as const);
  }

  subscribeAddressStxBalance(address: string) {
    this.socket.emit('subscribe', `address-stx-balance:${address}` as const);
  }

  unsubscribeAddressStxBalance(address: string) {
    this.socket.emit('unsubscribe', `address-stx-balance:${address}` as const);
  }

  test() {
    this.socket.on('block', block => {
      console.log(block);
    });
    this.socket.on('address-transaction', (address, data) => {
      console.log(address, data);
    });
    this.socket.on('address-stx-balance', (address, data) => {
      console.log(address, data);
    });
  }
}

