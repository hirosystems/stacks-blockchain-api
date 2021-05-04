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
    console.error(error);
    console.error(`Pass an absolute URL with a protocol/schema, e.g. "wss://example.com"`);
    throw error;
  }
  /*
  if (urlObj.protocol === 'https:') {
    urlObj.protocol = 'wss:';
  } else if (urlObj.protocol === 'http:') {
    urlObj.protocol = 'ws:';
  }
  */
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
    this.test();
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
    const client = new StacksApiSocketClient(socket);
    return Object.assign(socket, client);
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

  test() {
    this.subscribeBlocks();
    this.socket.on('block', block => {
      console.log(block.height + ': ' + block.hash);
      console.log(block);
    });
  }
}

