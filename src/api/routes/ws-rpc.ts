import {
  JsonRpcError,
  JsonRpc,
  IParsedObjectRequest,
  parse as parseRpcString,
  error as jsonRpcError,
  notification as jsonRpcNotification,
  success as jsonRpcSuccess,
} from 'jsonrpc-lite';
import * as WebSocket from 'ws';
import * as http from 'http';
import PQueue from 'p-queue';
import {
  RpcTxUpdateSubscriptionParams,
  RpcAddressTxSubscriptionParams,
  RpcAddressBalanceSubscriptionParams,
  RpcAddressBalanceNotificationParams,
  RpcAddressTxNotificationParams,
  RpcTxUpdateNotificationParams,
} from '@stacks/stacks-blockchain-api-types';

import { DataStore, AddressTxUpdateInfo, DbTx, DbMempoolTx } from '../../datastore/common';
import { normalizeHashString, logError, isValidPrincipal } from '../../helpers';
import { getTxStatusString, getTxTypeString } from '../controllers/db-controller';

type Subscription =
  | RpcTxUpdateSubscriptionParams
  | RpcAddressTxSubscriptionParams
  | RpcAddressBalanceSubscriptionParams;

class SubscriptionManager {
  /**
   * Key = subscription topic.
   * Value = clients interested in the subscription top.
   */
  subscriptions: Map<string, Set<WebSocket>> = new Map();

  addSubscription(client: WebSocket, topicId: string) {
    let clients = this.subscriptions.get(topicId);
    if (!clients) {
      clients = new Set();
      this.subscriptions.set(topicId, clients);
    }
    clients.add(client);
    client.on('close', () => {
      this.removeSubscription(client, topicId);
    });
  }

  removeSubscription(client: WebSocket, topicId: string) {
    const clients = this.subscriptions.get(topicId);
    if (clients) {
      clients.delete(client);
      if (clients.size === 0) {
        this.subscriptions.delete(topicId);
      }
    }
  }
}

export function createWsRpcRouter(db: DataStore, server: http.Server): WebSocket.Server {
  // Use `noServer` and the `upgrade` event to prevent the ws lib from hijacking the http.Server error event
  const wsPath = '/extended/v1/ws';
  const wsServer = new WebSocket.Server({ noServer: true, path: wsPath });
  server.on('upgrade', (request: http.IncomingMessage, socket, head) => {
    if (request.url?.startsWith(wsPath)) {
      wsServer.handleUpgrade(request, socket, head, ws => {
        wsServer.emit('connection', ws, request);
      });
    }
  });

  const txUpdateSubscriptions = new SubscriptionManager();
  const addressTxUpdateSubscriptions = new SubscriptionManager();
  const addressBalanceUpdateSubscriptions = new SubscriptionManager();

  function handleClientMessage(client: WebSocket, data: WebSocket.Data) {
    try {
      if (typeof data !== 'string') {
        throw JsonRpcError.parseError(`unexpected data type: ${data.constructor.name}`);
      }
      const parsedRpcReq = parseRpcString(data);
      const isBatchRequest = Array.isArray(parsedRpcReq);
      let rpcReqs = Array.isArray(parsedRpcReq) ? parsedRpcReq : [parsedRpcReq];

      // Ignore client notifications, spec dictates server should never respond to these.
      rpcReqs = rpcReqs.filter(req => req.type !== 'notification');

      const responses: JsonRpc[] = rpcReqs.map(rpcReq => {
        switch (rpcReq.type) {
          case 'request':
            return handleClientRpcReq(client, rpcReq);
          case 'error':
            return jsonRpcError(
              rpcReq.payload.id,
              JsonRpcError.invalidRequest('unexpected error msg from client')
            );
          case 'success':
            return jsonRpcError(
              rpcReq.payload.id,
              JsonRpcError.invalidRequest('unexpected success msg from client')
            );
          case 'invalid':
            return jsonRpcError(null as any, rpcReq.payload);
          default:
            return jsonRpcError(
              null as any,
              JsonRpcError.invalidRequest('unexpected msg type from client')
            );
        }
      });

      if (isBatchRequest) {
        client.send(JSON.stringify(responses));
      } else if (responses.length === 1) {
        client.send(responses[0].serialize());
      }
    } catch (err) {
      // Response `id` is null for invalid JSON requests (or other errors where the request ID isn't known).
      try {
        const res = err instanceof JsonRpcError ? err : JsonRpcError.internalError(err.toString());
        sendRpcResponse(client, jsonRpcError(null as any, res));
      } catch (error) {
        // ignore any errors here
      }
    }
  }

  function sendRpcResponse(client: WebSocket, res: JsonRpc) {
    client.send(res.serialize());
  }

  /** Route supported RPC methods */
  function handleClientRpcReq(client: WebSocket, req: IParsedObjectRequest): JsonRpc {
    switch (req.payload.method) {
      case 'subscribe':
        return handleClientSubscription(client, req, true);
      case 'unsubscribe':
        return handleClientSubscription(client, req, false);
      default:
        return jsonRpcError(req.payload.id, JsonRpcError.methodNotFound(null));
    }
  }

  /** Route supported subscription events */
  function handleClientSubscription(
    client: WebSocket,
    req: IParsedObjectRequest,
    subscribe: boolean
  ): JsonRpc {
    const params = req.payload.params as Subscription;
    if (!params || !params.event) {
      return jsonRpcError(
        req.payload.id,
        JsonRpcError.invalidParams('subscription requests must include an event name')
      );
    }
    switch (params.event) {
      case 'tx_update':
        return handleTxUpdateSubscription(client, req, params, subscribe);
      case 'address_tx_update':
        return handleAddressTxUpdateSubscription(client, req, params, subscribe);
      case 'address_balance_update':
        return handleAddressBalanceUpdateSubscription(client, req, params, subscribe);
      default:
        return jsonRpcError(
          req.payload.id,
          JsonRpcError.invalidParams('subscription request must use a valid event name')
        );
    }
  }

  /** Process client request for tx update notifications */
  function handleTxUpdateSubscription(
    client: WebSocket,
    req: IParsedObjectRequest,
    params: RpcTxUpdateSubscriptionParams,
    subscribe: boolean
  ): JsonRpc {
    const txId = normalizeHashString(params.tx_id);
    if (!txId) {
      return jsonRpcError(req.payload.id, JsonRpcError.invalidParams('invalid tx_id'));
    }
    if (subscribe) {
      txUpdateSubscriptions.addSubscription(client, txId);
    } else {
      txUpdateSubscriptions.removeSubscription(client, txId);
    }
    return jsonRpcSuccess(req.payload.id, { tx_id: txId });
  }

  /** Process client request for address tx update notifications */
  function handleAddressTxUpdateSubscription(
    client: WebSocket,
    req: IParsedObjectRequest,
    params: RpcAddressTxSubscriptionParams,
    subscribe: boolean
  ): JsonRpc {
    const address = params.address;
    if (!isValidPrincipal(address)) {
      return jsonRpcError(req.payload.id, JsonRpcError.invalidParams('invalid address'));
    }
    if (subscribe) {
      addressTxUpdateSubscriptions.addSubscription(client, address);
    } else {
      addressTxUpdateSubscriptions.removeSubscription(client, address);
    }
    return jsonRpcSuccess(req.payload.id, { address: address });
  }

  function handleAddressBalanceUpdateSubscription(
    client: WebSocket,
    req: IParsedObjectRequest,
    params: RpcAddressBalanceSubscriptionParams,
    subscribe: boolean
  ): JsonRpc {
    const address = params.address;
    if (!isValidPrincipal(address)) {
      return jsonRpcError(req.payload.id, JsonRpcError.invalidParams('invalid address'));
    }
    if (subscribe) {
      addressBalanceUpdateSubscriptions.addSubscription(client, address);
    } else {
      addressBalanceUpdateSubscriptions.removeSubscription(client, address);
    }
    return jsonRpcSuccess(req.payload.id, { address: address });
  }

  function processTxUpdate(tx: DbTx | DbMempoolTx) {
    try {
      const subscribers = txUpdateSubscriptions.subscriptions.get(tx.tx_id);
      if (subscribers) {
        const updateNotification: RpcTxUpdateNotificationParams = {
          tx_id: tx.tx_id,
          tx_status: getTxStatusString(tx.status),
          tx_type: getTxTypeString(tx.type_id),
        };
        const rpcNotificationPayload = jsonRpcNotification(
          'tx_update',
          updateNotification
        ).serialize();
        subscribers.forEach(client => client.send(rpcNotificationPayload));
      }
    } catch (error) {
      logError(`error sending websocket tx update for ${tx.tx_id}`, error);
    }
  }

  function processAddressUpdate(addressInfo: AddressTxUpdateInfo) {
    try {
      const subscribers = addressTxUpdateSubscriptions.subscriptions.get(addressInfo.address);
      if (subscribers) {
        Array.from(addressInfo.txs.keys()).forEach(tx => {
          const updateNotification: RpcAddressTxNotificationParams = {
            address: addressInfo.address,
            tx_id: tx.tx_id,
            tx_status: getTxStatusString(tx.status),
            tx_type: getTxTypeString(tx.type_id),
          };
          const rpcNotificationPayload = jsonRpcNotification(
            'address_tx_update',
            updateNotification
          ).serialize();
          subscribers.forEach(client => client.send(rpcNotificationPayload));
        });
      }
    } catch (error) {
      logError(`error sending websocket address tx updates to ${addressInfo.address}`, error);
    }
  }

  // Queue to process balance update notifications
  const addrBalanceProcessorQueue = new PQueue({ concurrency: 1 });

  function processAddressBalanceUpdate(addressInfo: AddressTxUpdateInfo) {
    const subscribers = addressBalanceUpdateSubscriptions.subscriptions.get(addressInfo.address);
    if (subscribers) {
      void addrBalanceProcessorQueue.add(async () => {
        try {
          const balance = await db.getStxBalance(addressInfo.address);
          const balanceNotification: RpcAddressBalanceNotificationParams = {
            address: addressInfo.address,
            balance: balance.balance.toString(),
          };
          const rpcNotificationPayload = jsonRpcNotification(
            'address_balance_update',
            balanceNotification
          ).serialize();
          subscribers.forEach(client => client.send(rpcNotificationPayload));
        } catch (error) {
          logError(`error sending websocket stx balance update to ${addressInfo.address}`, error);
        }
      });
    }
  }

  db.addListener('txUpdate', txInfo => {
    void processTxUpdate(txInfo);
  });

  db.addListener('addressUpdate', addressInfo => {
    void processAddressUpdate(addressInfo);
    void processAddressBalanceUpdate(addressInfo);
  });

  wsServer.on('connection', (clientSocket, req) => {
    clientSocket.on('message', data => {
      void handleClientMessage(clientSocket, data);
    });
  });

  return wsServer;
}
