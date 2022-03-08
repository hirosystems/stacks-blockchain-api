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
import * as net from 'net';
import PQueue from 'p-queue';
import {
  RpcTxUpdateSubscriptionParams,
  RpcAddressTxSubscriptionParams,
  RpcAddressBalanceSubscriptionParams,
  RpcAddressBalanceNotificationParams,
  RpcAddressTxNotificationParams,
  RpcBlockSubscriptionParams,
  RpcMicroblockSubscriptionParams,
  RpcMempoolSubscriptionParams,
  RpcTxUpdateNotificationParams,
  Transaction,
} from '@stacks/stacks-blockchain-api-types';

import { DataStore, DbTx, DbMempoolTx } from '../../../datastore/common';
import { normalizeHashString, logError, isValidPrincipal, isProdEnv } from '../../../helpers';
import {
  getBlockFromDataStore,
  getMempoolTxsFromDataStore,
  getMicroblockFromDataStore,
  getTxStatusString,
  getTxTypeString,
} from '../../controllers/db-controller';
import { WebSocketPrometheus } from './metrics';

type Subscription =
  | RpcTxUpdateSubscriptionParams
  | RpcAddressTxSubscriptionParams
  | RpcAddressBalanceSubscriptionParams
  | RpcBlockSubscriptionParams
  | RpcMicroblockSubscriptionParams
  | RpcMempoolSubscriptionParams;

class SubscriptionManager {
  /**
   * Key = subscription topic.
   * Value = clients interested in the subscription topic.
   */
  subscriptions: Map<string, Set<WebSocket>> = new Map();

  // Sockets that are responding to ping.
  liveSockets: Set<WebSocket> = new Set();
  heartbeatInterval?: NodeJS.Timeout;
  readonly heartbeatIntervalMs = 5_000;

  addSubscription(client: WebSocket, topicId: string) {
    if (this.subscriptions.size === 0) {
      this.startHeartbeat();
    }
    let clients = this.subscriptions.get(topicId);
    if (!clients) {
      clients = new Set();
      this.subscriptions.set(topicId, clients);
    }
    clients.add(client);
    this.liveSockets.add(client);
    client.on('close', () => {
      this.removeSubscription(client, topicId);
    });
    client.on('pong', () => {
      this.liveSockets.add(client);
    });
  }

  removeSubscription(client: WebSocket, topicId: string) {
    const clients = this.subscriptions.get(topicId);
    if (clients) {
      clients.delete(client);
      if (clients.size === 0) {
        this.subscriptions.delete(topicId);
        if (this.subscriptions.size === 0) {
          this.stopHeartbeat();
        }
      }
    }
    this.liveSockets.delete(client);
  }

  startHeartbeat() {
    if (this.heartbeatInterval) {
      return;
    }
    this.heartbeatInterval = setInterval(() => {
      this.subscriptions.forEach((clients, topic) => {
        clients.forEach(ws => {
          // Client did not respond to a previous ping, it's dead.
          if (!this.liveSockets.has(ws)) {
            this.removeSubscription(ws, topic);
            return;
          }
          // Assume client is dead until it responds to our ping.
          this.liveSockets.delete(ws);
          ws.ping();
        });
      });
    }, this.heartbeatIntervalMs);
  }

  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = undefined;
    }
  }

  close() {
    this.subscriptions.clear();
    this.liveSockets.clear();
    this.stopHeartbeat();
  }
}

export function createWsRpcRouter(db: DataStore, server: http.Server): WebSocket.Server {
  let prometheus: WebSocketPrometheus | null;
  if (isProdEnv) {
    prometheus = new WebSocketPrometheus('websocket');
  }

  // Use `noServer` and the `upgrade` event to prevent the ws lib from hijacking the http.Server error event
  const wsPath = '/extended/v1/ws';
  const wsServer = new WebSocket.Server({ noServer: true, path: wsPath });
  server.on('upgrade', (request: http.IncomingMessage, socket, head) => {
    if (request.url?.startsWith(wsPath)) {
      wsServer.handleUpgrade(request, socket as net.Socket, head, ws => {
        wsServer.emit('connection', ws, request);
      });
    }
  });

  const txUpdateSubscriptions = new SubscriptionManager();
  const addressTxUpdateSubscriptions = new SubscriptionManager();
  const addressBalanceUpdateSubscriptions = new SubscriptionManager();
  const blockSubscriptions = new SubscriptionManager();
  const microblockSubscriptions = new SubscriptionManager();
  const mempoolSubscriptions = new SubscriptionManager();

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
    } catch (err: any) {
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
      case 'block':
        return handleBlockUpdateSubscription(client, req, params, subscribe);
      case 'microblock':
        return handleMicroblockUpdateSubscription(client, req, params, subscribe);
      case 'mempool':
        return handleMempoolUpdateSubscription(client, req, params, subscribe);
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
      prometheus?.subscribe(client, `transaction:${txId}`);
    } else {
      txUpdateSubscriptions.removeSubscription(client, txId);
      prometheus?.unsubscribe(client, `transaction:${txId}`);
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
      prometheus?.subscribe(client, `address-transaction:${address}`);
    } else {
      addressTxUpdateSubscriptions.removeSubscription(client, address);
      prometheus?.unsubscribe(client, `address-transaction:${address}`);
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
      prometheus?.subscribe(client, `address-stx-balance:${address}`);
    } else {
      addressBalanceUpdateSubscriptions.removeSubscription(client, address);
      prometheus?.unsubscribe(client, `address-stx-balance:${address}`);
    }
    return jsonRpcSuccess(req.payload.id, { address: address });
  }

  function handleBlockUpdateSubscription(
    client: WebSocket,
    req: IParsedObjectRequest,
    params: RpcBlockSubscriptionParams,
    subscribe: boolean
  ) {
    if (subscribe) {
      blockSubscriptions.addSubscription(client, params.event);
      prometheus?.subscribe(client, 'block');
    } else {
      blockSubscriptions.removeSubscription(client, params.event);
      prometheus?.unsubscribe(client, 'block');
    }
    return jsonRpcSuccess(req.payload.id, {});
  }

  function handleMicroblockUpdateSubscription(
    client: WebSocket,
    req: IParsedObjectRequest,
    params: RpcMicroblockSubscriptionParams,
    subscribe: boolean
  ) {
    if (subscribe) {
      microblockSubscriptions.addSubscription(client, params.event);
      prometheus?.subscribe(client, 'microblock');
    } else {
      microblockSubscriptions.removeSubscription(client, params.event);
      prometheus?.unsubscribe(client, 'microblock');
    }
    return jsonRpcSuccess(req.payload.id, {});
  }

  function handleMempoolUpdateSubscription(
    client: WebSocket,
    req: IParsedObjectRequest,
    params: RpcMempoolSubscriptionParams,
    subscribe: boolean
  ) {
    if (subscribe) {
      mempoolSubscriptions.addSubscription(client, params.event);
      prometheus?.subscribe(client, 'mempool');
    } else {
      mempoolSubscriptions.removeSubscription(client, params.event);
      prometheus?.unsubscribe(client, 'mempool');
    }
    return jsonRpcSuccess(req.payload.id, {});
  }

  async function processTxUpdate(txId: string) {
    try {
      const subscribers = txUpdateSubscriptions.subscriptions.get(txId);
      if (subscribers) {
        let tx: DbTx | DbMempoolTx; // Tx updates can come from both mempool and mined txs.
        const dbMempoolTxQuery = await db.getMempoolTx({
          txId: txId,
          includeUnanchored: true,
          includePruned: true,
        });
        if (dbMempoolTxQuery.found) {
          tx = dbMempoolTxQuery.result;
        } else {
          const dbTxQuery = await db.getTx({ txId: txId, includeUnanchored: true });
          if (dbTxQuery.found) {
            tx = dbTxQuery.result;
          } else {
            return;
          }
        }
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
        prometheus?.sendEvent('transaction');
      }
    } catch (error) {
      logError(`error sending websocket tx update for ${txId}`, error);
    }
  }

  async function processAddressUpdate(address: string, blockHeight: number) {
    try {
      const subscribers = addressTxUpdateSubscriptions.subscriptions.get(address);
      if (subscribers) {
        const dbTxsQuery = await db.getAddressTxsWithAssetTransfers({
          stxAddress: address,
          blockHeight: blockHeight,
          atSingleBlock: true,
        });
        if (dbTxsQuery.total == 0) {
          return;
        }
        const addressTxs = dbTxsQuery.results;
        addressTxs.forEach(tx => {
          const updateNotification: RpcAddressTxNotificationParams = {
            address: address,
            tx_id: tx.tx.tx_id,
            tx_status: getTxStatusString(tx.tx.status),
            tx_type: getTxTypeString(tx.tx.type_id),
          };
          const rpcNotificationPayload = jsonRpcNotification(
            'address_tx_update',
            updateNotification
          ).serialize();
          subscribers.forEach(client => client.send(rpcNotificationPayload));
          prometheus?.sendEvent('address-transaction');
        });
      }
    } catch (error) {
      logError(`error sending websocket address tx updates to ${address}`, error);
    }
  }

  // Queue to process balance update notifications
  const addrBalanceProcessorQueue = new PQueue({ concurrency: 1 });

  async function processAddressBalanceUpdate(address: string) {
    const subscribers = addressBalanceUpdateSubscriptions.subscriptions.get(address);
    if (subscribers) {
      await addrBalanceProcessorQueue.add(async () => {
        try {
          const balance = await db.getStxBalance({
            stxAddress: address,
            includeUnanchored: true,
          });
          const balanceNotification: RpcAddressBalanceNotificationParams = {
            address: address,
            balance: balance.balance.toString(),
          };
          const rpcNotificationPayload = jsonRpcNotification(
            'address_balance_update',
            balanceNotification
          ).serialize();
          subscribers.forEach(client => client.send(rpcNotificationPayload));
          prometheus?.sendEvent('address-stx-balance');
        } catch (error) {
          logError(`error sending websocket stx balance update to ${address}`, error);
        }
      });
    }
  }

  async function processBlockUpdate(blockHash: string) {
    try {
      const subscribers = blockSubscriptions.subscriptions.get('block');
      if (subscribers) {
        const blockQuery = await getBlockFromDataStore({ blockIdentifer: { hash: blockHash }, db });
        if (blockQuery.found) {
          const block = blockQuery.result;
          const rpcNotificationPayload = jsonRpcNotification('block', block).serialize();
          subscribers.forEach(client => client.send(rpcNotificationPayload));
          prometheus?.sendEvent('block');
        }
      }
    } catch (error) {
      logError(`error sending websocket block updates`, error);
    }
  }

  async function processMicroblockUpdate(microblockHash: string) {
    try {
      const subscribers = microblockSubscriptions.subscriptions.get('microblock');
      if (subscribers) {
        const microblockQuery = await getMicroblockFromDataStore({
          microblockHash: microblockHash,
          db,
        });
        if (microblockQuery.found) {
          const microblock = microblockQuery.result;
          const rpcNotificationPayload = jsonRpcNotification('microblock', microblock).serialize();
          subscribers.forEach(client => client.send(rpcNotificationPayload));
          prometheus?.sendEvent('microblock');
        }
      }
    } catch (error) {
      logError(`error sending websocket microblock updates`, error);
    }
  }

  async function processMempoolUpdate(txId: string) {
    try {
      const subscribers = mempoolSubscriptions.subscriptions.get('mempool');
      if (subscribers) {
        const mempoolTxs = await getMempoolTxsFromDataStore(db, {
          txIds: [txId],
          includeUnanchored: true,
        });
        if (mempoolTxs.length > 0) {
          const mempoolTx = mempoolTxs[0];
          const rpcNotificationPayload = jsonRpcNotification('mempool', mempoolTx).serialize();
          subscribers.forEach(client => client.send(rpcNotificationPayload));
          prometheus?.sendEvent('mempool');
        }
      }
    } catch (error) {
      logError(`error sending websocket mempool updates`, error);
    }
  }

  db.addListener('txUpdate', async txId => {
    await processTxUpdate(txId);
    await processMempoolUpdate(txId);
  });

  db.addListener('addressUpdate', async (address, blockHeight) => {
    await processAddressUpdate(address, blockHeight);
    await processAddressBalanceUpdate(address);
  });

  db.addListener('blockUpdate', async blockHash => {
    await processBlockUpdate(blockHash);
  });

  db.addListener('microblockUpdate', async microblockHash => {
    await processMicroblockUpdate(microblockHash);
  });

  wsServer.on('connection', (clientSocket, req) => {
    if (req.headers['x-forwarded-for']) {
      prometheus?.connect(req.headers['x-forwarded-for'] as string);
    } else if (req.socket.remoteAddress) {
      prometheus?.connect(req.socket.remoteAddress);
    }
    clientSocket.on('message', data => {
      handleClientMessage(clientSocket, data);
    });
    clientSocket.on('close', (_: WebSocket) => {
      prometheus?.disconnect(clientSocket);
    });
  });

  wsServer.on('close', (_: WebSocket.Server) => {
    txUpdateSubscriptions.close();
    addressTxUpdateSubscriptions.close();
    addressBalanceUpdateSubscriptions.close();
    blockSubscriptions.close();
    microblockSubscriptions.close();
    mempoolSubscriptions.close();
  });

  return wsServer;
}
