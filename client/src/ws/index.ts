import * as JsonRpcLite from 'jsonrpc-lite';
import EventEmitter from 'eventemitter3';
import StrictEventEmitter from 'strict-event-emitter-types';
import {
  RpcTxUpdateSubscriptionParams,
  RpcTxUpdateNotificationParams,
  RpcAddressTxSubscriptionParams,
  RpcAddressTxNotificationParams,
  RpcAddressBalanceSubscriptionParams,
  RpcAddressBalanceNotificationParams,
  RpcSubscriptionType,
} from '@blockstack/stacks-blockchain-api-types';

type IWebSocket = import('ws') | WebSocket;

interface Events {
  txUpdate: (event: RpcTxUpdateNotificationParams) => void;
  addressTxUpdate: (event: RpcAddressTxNotificationParams) => void;
  addressBalanceUpdate: (event: RpcAddressBalanceNotificationParams) => void;
}

interface Subscription {
  unsubscribe(): Promise<void>;
}

type StacksApiEventEmitter = StrictEventEmitter<EventEmitter, Events>;

export class StacksApiWebSocketClient extends (EventEmitter as {
  new (): StacksApiEventEmitter;
}) {
  webSocket: IWebSocket;
  idCursor = 0;
  pendingRequests = new Map<
    JsonRpcLite.ID,
    { resolve: (result: any) => void; reject: (error: any) => void }
  >();

  constructor(webSocket: IWebSocket) {
    super();
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
        this.emit('txUpdate', data.params as RpcTxUpdateNotificationParams);
        break;
      case 'address_tx_update':
        this.emit('addressTxUpdate', data.params as RpcAddressTxNotificationParams);
        break;
      case 'address_balance_update':
        this.emit('addressBalanceUpdate', data.params as RpcAddressBalanceNotificationParams);
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
    this.addListener('txUpdate', listener);
    return {
      unsubscribe: () => {
        this.removeListener('txUpdate', listener);
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
    this.addListener('addressTxUpdate', listener);
    return {
      unsubscribe: () => {
        this.removeListener('addressTxUpdate', listener);
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
    this.addListener('addressBalanceUpdate', listener);
    return {
      unsubscribe: () => {
        this.removeListener('addressBalanceUpdate', listener);
        return this.rpcCall('unsubscribe', params);
      },
    };
  }
}

export async function connect(url: string): Promise<StacksApiWebSocketClient> {
  const webSocket = await new Promise<IWebSocket>((resolve, reject) => {
    const webSocket = new (createWebSocket())(url);
    webSocket.onopen = () => resolve(webSocket);
    webSocket.onerror = error => reject(error);
  });
  return new StacksApiWebSocketClient(webSocket);
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
