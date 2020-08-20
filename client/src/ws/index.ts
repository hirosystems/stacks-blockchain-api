import * as JsonRpcLite from 'jsonrpc-lite';
import { EventEmitter } from 'eventemitter3';
import {
  RpcTxUpdateSubscriptionParams,
  RpcTxUpdateNotificationParams,
  RpcAddressTxSubscriptionParams,
  RpcAddressTxNotificationParams,
  RpcAddressBalanceSubscriptionParams,
  RpcAddressBalanceNotificationParams,
  RpcSubscriptionType,
} from '@blockstack/stacks-blockchain-api-types';
import { BASE_PATH } from '../generated/runtime';

type IWebSocket = import('ws') | WebSocket;

interface Subscription {
  unsubscribe(): Promise<void>;
}

export class StacksApiWebSocketClient {
  webSocket: IWebSocket;
  idCursor = 0;
  pendingRequests = new Map<
    JsonRpcLite.ID,
    { resolve: (result: any) => void; reject: (error: any) => void }
  >();

  eventEmitter = new EventEmitter<{
    txUpdate: (event: RpcTxUpdateNotificationParams) => any;
    addressTxUpdate: (event: RpcAddressTxNotificationParams) => void;
    addressBalanceUpdate: (event: RpcAddressBalanceNotificationParams) => void;
  }>();

  public static async connect(url: string = BASE_PATH): Promise<StacksApiWebSocketClient> {
    // `ws://${addr}/extended/v1/ws`;
    let urlObj: URL;
    try {
      urlObj = new URL(url);
    } catch (_error) {
      urlObj = new URL(`ws://${url}`);
    }
    if (urlObj.protocol === 'https:') {
      urlObj.protocol = 'wss:';
    } else if (urlObj.protocol === 'http:') {
      urlObj.protocol = 'ws:';
    }
    if (urlObj.pathname === '/') {
      urlObj.pathname = '/extended/v1/ws';
    }
    const webSocket = await new Promise<IWebSocket>((resolve, reject) => {
      const webSocket = new (createWebSocket())(urlObj.toString());
      webSocket.onopen = () => resolve(webSocket);
      webSocket.onerror = error => reject(error);
    });
    return new StacksApiWebSocketClient(webSocket);
  }

  constructor(webSocket: IWebSocket) {
    this.webSocket = webSocket;
    (webSocket as WebSocket).addEventListener('message', event => {
      const parsed = JsonRpcLite.parse(event.data);
      const rpcObjects = Array.isArray(parsed) ? parsed : [parsed];
      rpcObjects.forEach(obj => {
        if (obj.type === JsonRpcLite.RpcStatusType.notification) {
          this.handleNotification(obj.payload);
        } else if (obj.type === JsonRpcLite.RpcStatusType.success) {
          const req = this.pendingRequests.get(obj.payload.id);
          if (req) {
            this.pendingRequests.delete(obj.payload.id);
            req.resolve(obj.payload.result);
          }
        } else if (obj.type === JsonRpcLite.RpcStatusType.error) {
          const req = this.pendingRequests.get(obj.payload.id);
          if (req) {
            this.pendingRequests.delete(obj.payload.id);
            req.reject(obj.payload.error);
          }
        }
      });
    });
  }

  handleNotification(data: JsonRpcLite.NotificationObject): void {
    const method = data.method as RpcSubscriptionType;
    switch (method) {
      case 'tx_update':
        this.eventEmitter.emit('txUpdate', data.params as RpcTxUpdateNotificationParams);
        break;
      case 'address_tx_update':
        this.eventEmitter.emit('addressTxUpdate', data.params as RpcAddressTxNotificationParams);
        break;
      case 'address_balance_update':
        this.eventEmitter.emit(
          'addressBalanceUpdate',
          data.params as RpcAddressBalanceNotificationParams
        );
        break;
    }
  }

  private rpcCall<TResult = void>(method: string, params: any): Promise<TResult> {
    const rpcReq = JsonRpcLite.request(++this.idCursor, method, params);
    return new Promise<TResult>((resolve, reject) => {
      this.pendingRequests.set(rpcReq.id, { resolve, reject });
      this.webSocket.send(rpcReq.serialize());
    });
  }

  async subscribeTxUpdates(
    txId: string,
    update: (event: RpcTxUpdateNotificationParams) => any
  ): Promise<Subscription> {
    const params: RpcTxUpdateSubscriptionParams = { event: 'tx_update', tx_id: txId };
    const subscribed = await this.rpcCall<{ tx_id: string }>('subscribe', params);
    const listener = (event: RpcTxUpdateNotificationParams) => {
      if (event.tx_id === subscribed.tx_id) {
        update(event);
      }
    };
    this.eventEmitter.addListener('txUpdate', listener);
    return {
      unsubscribe: () => {
        this.eventEmitter.removeListener('txUpdate', listener);
        return this.rpcCall('unsubscribe', params);
      },
    };
  }

  async subscribeAddressTransactions(
    address: string,
    update: (event: RpcAddressTxNotificationParams) => any
  ): Promise<Subscription> {
    const params: RpcAddressTxSubscriptionParams = { event: 'address_tx_update', address };
    const subscribed = await this.rpcCall<{ address: string }>('subscribe', params);
    const listener = (event: RpcAddressTxNotificationParams) => {
      if (event.address === subscribed.address) {
        update(event);
      }
    };
    this.eventEmitter.addListener('addressTxUpdate', listener);
    return {
      unsubscribe: () => {
        this.eventEmitter.removeListener('addressTxUpdate', listener);
        return this.rpcCall('unsubscribe', params);
      },
    };
  }

  async subscribeAddressBalanceUpdates(
    address: string,
    update: (event: RpcAddressBalanceNotificationParams) => any
  ): Promise<Subscription> {
    const params: RpcAddressBalanceSubscriptionParams = {
      event: 'address_balance_update',
      address,
    };
    const subscribed = await this.rpcCall<{ address: string }>('subscribe', params);
    const listener = (event: RpcAddressBalanceNotificationParams) => {
      if (event.address === subscribed.address) {
        update(event);
      }
    };
    this.eventEmitter.addListener('addressBalanceUpdate', listener);
    return {
      unsubscribe: () => {
        this.eventEmitter.removeListener('addressBalanceUpdate', listener);
        return this.rpcCall('unsubscribe', params);
      },
    };
  }
}

export async function connectWebSocketClient(
  url: string = BASE_PATH
): Promise<StacksApiWebSocketClient> {
  return StacksApiWebSocketClient.connect(url);
}

/**
 * Simple isomorphic WebSocket class lookup.
 * Uses global WebSocket (browsers) if available, otherwise, uses the Node.js `ws` lib.
 */
function createWebSocket(): typeof WebSocket {
  if (typeof WebSocket !== 'undefined') {
    return WebSocket;
  } else if (typeof global !== 'undefined' && global.WebSocket) {
    return global.WebSocket;
  } else if (typeof window !== 'undefined' && window.WebSocket) {
    return window.WebSocket;
  } else if (typeof self !== 'undefined' && self.WebSocket) {
    return self.WebSocket;
  } else {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return require('ws');
  }
}
