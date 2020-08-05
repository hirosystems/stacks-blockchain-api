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

  private rpcCall(method: string, params: any): Promise<void> {
    const rpcReq = JsonRpcLite.request(++this.idCursor, method, params);
    return new Promise((resolve, reject) => {
      this.pendingRequests.set(rpcReq.id, { resolve, reject });
      this.webSocket.send(rpcReq.serialize());
    });
  }

  subscribeTxUpdates(txId: string): Promise<void> {
    const params: RpcTxUpdateSubscriptionParams = { event: 'tx_update', tx_id: txId };
    return this.rpcCall('subscribe', params);
  }

  unsubscribeTxUpdates(txId: string): Promise<void> {
    const params: RpcTxUpdateSubscriptionParams = { event: 'tx_update', tx_id: txId };
    return this.rpcCall('unsubscribe', params);
  }

  subscribeAddressTransactions(address: string): Promise<void> {
    const params: RpcAddressTxSubscriptionParams = { event: 'address_tx_update', address };
    return this.rpcCall('subscribe', params);
  }

  unsubscribeAddressTransactions(address: string): Promise<void> {
    const params: RpcAddressTxSubscriptionParams = { event: 'address_tx_update', address };
    return this.rpcCall('unsubscribe', params);
  }

  subscribeAddressBalanceUpdates(address: string): Promise<void> {
    const params: RpcAddressBalanceSubscriptionParams = {
      event: 'address_balance_update',
      address,
    };
    return this.rpcCall('subscribe', params);
  }

  unsubscribeAddressBalanceUpdates(address: string): Promise<void> {
    const params: RpcAddressBalanceSubscriptionParams = {
      event: 'address_balance_update',
      address,
    };
    return this.rpcCall('unsubscribe', params);
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
