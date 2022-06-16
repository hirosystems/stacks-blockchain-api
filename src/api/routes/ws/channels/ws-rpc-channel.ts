import * as http from 'http';
import * as WebSocket from 'ws';
import * as net from 'net';
import { isProdEnv, isValidPrincipal, logError, normalizeHashString } from '../../../../helpers';
import { WebSocketPrometheus } from '../web-socket-prometheus';
import {
  ListenerType,
  WebSocketChannel,
  WebSocketPayload,
  WebSocketTopics,
} from '../web-socket-channel';
import {
  JsonRpcError,
  JsonRpc,
  IParsedObjectRequest,
  parse as parseRpcString,
  error as jsonRpcError,
  notification as jsonRpcNotification,
  success as jsonRpcSuccess,
} from 'jsonrpc-lite';
import {
  RpcTxUpdateSubscriptionParams,
  RpcAddressTxSubscriptionParams,
  RpcAddressBalanceSubscriptionParams,
  RpcBlockSubscriptionParams,
  RpcMicroblockSubscriptionParams,
  RpcMempoolSubscriptionParams,
  Block,
  Microblock,
  MempoolTransaction,
  Transaction,
  AddressTransactionWithTransfers,
  AddressStxBalanceResponse,
} from '@stacks/stacks-blockchain-api-types';

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

/**
 * WebSocket RPC channel for sending real time API updates.
 */
export class WsRpcChannel extends WebSocketChannel {
  private subscriptions = new Map<keyof WebSocketTopics, SubscriptionManager>();
  private wsServer?: WebSocket.Server;

  constructor(server: http.Server) {
    super(server);
    if (isProdEnv) {
      this.prometheus = new WebSocketPrometheus('websocket');
    }
  }

  connect(): void {
    // Use `noServer` and the `upgrade` event to prevent the ws lib from hijacking the http.Server error event
    const wsPath = '/extended/v1/ws';
    const wsServer = new WebSocket.Server({ noServer: true, path: wsPath });
    this.server.on('upgrade', (request: http.IncomingMessage, socket, head) => {
      if (request.url?.startsWith(wsPath)) {
        wsServer.handleUpgrade(request, socket as net.Socket, head, ws => {
          wsServer.emit('connection', ws, request);
        });
      }
    });

    this.subscriptions.set('block', new SubscriptionManager());
    this.subscriptions.set('microblock', new SubscriptionManager());
    this.subscriptions.set('mempool', new SubscriptionManager());
    this.subscriptions.set('transaction', new SubscriptionManager());
    this.subscriptions.set('principalTransactions', new SubscriptionManager());
    this.subscriptions.set('principalStxBalance', new SubscriptionManager());

    wsServer.on('connection', (clientSocket, req) => {
      if (req.headers['x-forwarded-for']) {
        this.prometheus?.connect(req.headers['x-forwarded-for'] as string);
      } else if (req.socket.remoteAddress) {
        this.prometheus?.connect(req.socket.remoteAddress);
      }
      clientSocket.on('message', data => {
        this.handleClientMessage(clientSocket, data);
      });
      clientSocket.on('close', (_: WebSocket) => {
        this.prometheus?.disconnect(clientSocket);
      });
    });
    wsServer.on('close', (_: WebSocket.Server) => {
      this.subscriptions.forEach(manager => manager.close());
    });

    this.wsServer = wsServer;
  }

  close(callback?: (err?: Error) => void): void {
    if (!this.wsServer && callback) {
      callback();
    }
    this.wsServer?.close(callback);
    this.wsServer = undefined;
  }

  hasListeners<P extends keyof WebSocketTopics>(
    topic: P,
    ...args: ListenerType<WebSocketTopics[P]>
  ): boolean {
    const manager = this.subscriptions.get(topic);
    if (!this.wsServer || !manager) {
      return false;
    }
    switch (topic) {
      case 'block':
        return manager.subscriptions.get('block') !== undefined;
      case 'microblock':
        return manager.subscriptions.get('microblock') !== undefined;
      case 'mempool':
        return manager.subscriptions.get('mempool') !== undefined;
      case 'transaction': {
        const [txId] = args as ListenerType<WebSocketTopics['transaction']>;
        return manager.subscriptions.get(txId) !== undefined;
      }
      case 'principalTransactions': {
        const [principal] = args as ListenerType<WebSocketTopics['principalTransactions']>;
        return manager.subscriptions.get(principal) !== undefined;
      }
      case 'principalStxBalance': {
        const [principal] = args as ListenerType<WebSocketTopics['principalStxBalance']>;
        return manager.subscriptions.get(principal) !== undefined;
      }
    }
    return false;
  }

  send<P extends keyof WebSocketPayload>(
    payload: P,
    ...args: ListenerType<WebSocketPayload[P]>
  ): void {
    if (!this.wsServer) {
      return;
    }
    switch (payload) {
      case 'block': {
        const [block] = args as ListenerType<WebSocketPayload['block']>;
        this.processBlockUpdate(block);
        break;
      }
      case 'microblock': {
        const [microblock] = args as ListenerType<WebSocketPayload['microblock']>;
        this.processMicroblockUpdate(microblock);
        break;
      }
      case 'mempoolTransaction': {
        const [tx] = args as ListenerType<WebSocketPayload['mempoolTransaction']>;
        this.processMempoolUpdate(tx);
        break;
      }
      case 'transaction': {
        const [tx] = args as ListenerType<WebSocketPayload['transaction']>;
        this.processTxUpdate(tx);
        break;
      }
      case 'principalTransaction': {
        const [principal, tx] = args as ListenerType<WebSocketPayload['principalTransaction']>;
        this.processAddressUpdate(principal, tx);
        break;
      }
      case 'principalStxBalance': {
        const [principal, balance] = args as ListenerType<WebSocketPayload['principalStxBalance']>;
        this.processAddressBalanceUpdate(principal, balance);
        break;
      }
    }
  }

  private handleClientMessage(client: WebSocket, data: WebSocket.Data) {
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
            return this.handleClientRpcReq(client, rpcReq);
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
        this.sendRpcResponse(client, jsonRpcError(null as any, res));
      } catch (error) {
        // ignore any errors here
      }
    }
  }

  private sendRpcResponse(client: WebSocket, res: JsonRpc) {
    client.send(res.serialize());
  }

  /** Route supported RPC methods */
  private handleClientRpcReq(client: WebSocket, req: IParsedObjectRequest): JsonRpc {
    switch (req.payload.method) {
      case 'subscribe':
        return this.handleClientSubscription(client, req, true);
      case 'unsubscribe':
        return this.handleClientSubscription(client, req, false);
      default:
        return jsonRpcError(req.payload.id, JsonRpcError.methodNotFound(null));
    }
  }

  /** Route supported subscription events */
  private handleClientSubscription(
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
        return this.handleTxUpdateSubscription(client, req, params, subscribe);
      case 'address_tx_update':
        return this.handleAddressTxUpdateSubscription(client, req, params, subscribe);
      case 'address_balance_update':
        return this.handleAddressBalanceUpdateSubscription(client, req, params, subscribe);
      case 'block':
        return this.handleBlockUpdateSubscription(client, req, params, subscribe);
      case 'microblock':
        return this.handleMicroblockUpdateSubscription(client, req, params, subscribe);
      case 'mempool':
        return this.handleMempoolUpdateSubscription(client, req, params, subscribe);
      default:
        return jsonRpcError(
          req.payload.id,
          JsonRpcError.invalidParams('subscription request must use a valid event name')
        );
    }
  }

  /** Process client request for tx update notifications */
  private handleTxUpdateSubscription(
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
      this.subscriptions.get('transaction')?.addSubscription(client, txId);
      this.prometheus?.subscribe(client, `transaction:${txId}`);
    } else {
      this.subscriptions.get('transaction')?.removeSubscription(client, txId);
      this.prometheus?.unsubscribe(client, `transaction:${txId}`);
    }
    return jsonRpcSuccess(req.payload.id, { tx_id: txId });
  }

  /** Process client request for address tx update notifications */
  private handleAddressTxUpdateSubscription(
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
      this.subscriptions.get('principalTransactions')?.addSubscription(client, address);
      this.prometheus?.subscribe(client, `address-transaction:${address}`);
    } else {
      this.subscriptions.get('principalTransactions')?.removeSubscription(client, address);
      this.prometheus?.unsubscribe(client, `address-transaction:${address}`);
    }
    return jsonRpcSuccess(req.payload.id, { address: address });
  }

  private handleAddressBalanceUpdateSubscription(
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
      this.subscriptions.get('principalStxBalance')?.addSubscription(client, address);
      this.prometheus?.subscribe(client, `address-stx-balance:${address}`);
    } else {
      this.subscriptions.get('principalStxBalance')?.removeSubscription(client, address);
      this.prometheus?.unsubscribe(client, `address-stx-balance:${address}`);
    }
    return jsonRpcSuccess(req.payload.id, { address: address });
  }

  private handleBlockUpdateSubscription(
    client: WebSocket,
    req: IParsedObjectRequest,
    params: RpcBlockSubscriptionParams,
    subscribe: boolean
  ) {
    if (subscribe) {
      this.subscriptions.get('block')?.addSubscription(client, params.event);
      this.prometheus?.subscribe(client, 'block');
    } else {
      this.subscriptions.get('block')?.removeSubscription(client, params.event);
      this.prometheus?.unsubscribe(client, 'block');
    }
    return jsonRpcSuccess(req.payload.id, {});
  }

  private handleMicroblockUpdateSubscription(
    client: WebSocket,
    req: IParsedObjectRequest,
    params: RpcMicroblockSubscriptionParams,
    subscribe: boolean
  ) {
    if (subscribe) {
      this.subscriptions.get('microblock')?.addSubscription(client, params.event);
      this.prometheus?.subscribe(client, 'microblock');
    } else {
      this.subscriptions.get('microblock')?.removeSubscription(client, params.event);
      this.prometheus?.unsubscribe(client, 'microblock');
    }
    return jsonRpcSuccess(req.payload.id, {});
  }

  private handleMempoolUpdateSubscription(
    client: WebSocket,
    req: IParsedObjectRequest,
    params: RpcMempoolSubscriptionParams,
    subscribe: boolean
  ) {
    if (subscribe) {
      this.subscriptions.get('mempool')?.addSubscription(client, params.event);
      this.prometheus?.subscribe(client, 'mempool');
    } else {
      this.subscriptions.get('mempool')?.removeSubscription(client, params.event);
      this.prometheus?.unsubscribe(client, 'mempool');
    }
    return jsonRpcSuccess(req.payload.id, {});
  }

  private processTxUpdate(tx: Transaction | MempoolTransaction) {
    try {
      const subscribers = this.subscriptions.get('transaction')?.subscriptions.get(tx.tx_id);
      if (subscribers) {
        const rpcNotificationPayload = jsonRpcNotification('tx_update', tx).serialize();
        subscribers.forEach(client => client.send(rpcNotificationPayload));
        this.prometheus?.sendEvent('transaction');
      }
    } catch (error) {
      logError(`error sending websocket tx update for ${tx.tx_id}`, error);
    }
  }

  private processAddressUpdate(principal: string, tx: AddressTransactionWithTransfers) {
    try {
      const subscribers = this.subscriptions
        .get('principalTransactions')
        ?.subscriptions.get(principal);
      if (subscribers) {
        const updateNotification = {
          address: principal,
          tx_id: tx.tx.tx_id,
          tx_status: tx.tx.tx_status,
          tx_type: tx.tx.tx_type,
          ...tx,
        };
        const rpcNotificationPayload = jsonRpcNotification(
          'address_tx_update',
          updateNotification
        ).serialize();
        subscribers.forEach(client => client.send(rpcNotificationPayload));
        this.prometheus?.sendEvent('address-transaction');
      }
    } catch (error) {
      logError(`error sending websocket address tx updates to ${principal}`, error);
    }
  }

  private processAddressBalanceUpdate(principal: string, balance: AddressStxBalanceResponse) {
    const subscribers = this.subscriptions.get('principalStxBalance')?.subscriptions.get(principal);
    if (subscribers) {
      try {
        const balanceNotification = {
          address: principal,
          ...balance,
        };
        const rpcNotificationPayload = jsonRpcNotification(
          'address_balance_update',
          balanceNotification
        ).serialize();
        subscribers.forEach(client => client.send(rpcNotificationPayload));
        this.prometheus?.sendEvent('address-stx-balance');
      } catch (error) {
        logError(`error sending websocket stx balance update to ${principal}`, error);
      }
    }
  }

  private processBlockUpdate(block: Block) {
    try {
      const subscribers = this.subscriptions.get('block')?.subscriptions.get('block');
      if (subscribers) {
        const rpcNotificationPayload = jsonRpcNotification('block', block).serialize();
        subscribers.forEach(client => client.send(rpcNotificationPayload));
        this.prometheus?.sendEvent('block');
      }
    } catch (error) {
      logError(`error sending websocket block updates`, error);
    }
  }

  private processMicroblockUpdate(microblock: Microblock) {
    try {
      const subscribers = this.subscriptions.get('microblock')?.subscriptions.get('microblock');
      if (subscribers) {
        const rpcNotificationPayload = jsonRpcNotification('microblock', microblock).serialize();
        subscribers.forEach(client => client.send(rpcNotificationPayload));
        this.prometheus?.sendEvent('microblock');
      }
    } catch (error) {
      logError(`error sending websocket microblock updates`, error);
    }
  }

  private processMempoolUpdate(transaction: MempoolTransaction) {
    try {
      const subscribers = this.subscriptions.get('mempool')?.subscriptions.get('mempool');
      if (subscribers) {
        const rpcNotificationPayload = jsonRpcNotification('mempool', transaction).serialize();
        subscribers.forEach(client => client.send(rpcNotificationPayload));
        this.prometheus?.sendEvent('mempool');
      }
    } catch (error) {
      logError(`error sending websocket mempool updates`, error);
    }
  }
}
