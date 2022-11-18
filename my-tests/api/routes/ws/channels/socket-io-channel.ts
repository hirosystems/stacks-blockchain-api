import {
  AddressStxBalanceTopic,
  AddressTransactionTopic,
  ClientToServerMessages,
  ServerToClientMessages,
  Topic,
} from 'docs/socket-io';
import * as http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { Adapter } from 'socket.io-adapter';
import { isValidTxId } from '../../../../api/query-helpers';
import { isProdEnv, isValidPrincipal, logger } from '../../../../helpers';
import { WebSocketPrometheus } from '../web-socket-prometheus';
import {
  ListenerType,
  WebSocketChannel,
  WebSocketPayload,
  WebSocketTopics,
} from '../web-socket-channel';

/**
 * SocketIO channel for sending real time API updates.
 */
export class SocketIOChannel extends WebSocketChannel {
  private io?: SocketIOServer<ClientToServerMessages, ServerToClientMessages>;
  private adapter?: Adapter;

  constructor(server: http.Server) {
    super(server);
    if (isProdEnv) {
      this.prometheus = new WebSocketPrometheus('socket_io');
    }
  }

  connect(): void {
    const io = new SocketIOServer<ClientToServerMessages, ServerToClientMessages>(this.server, {
      cors: { origin: '*' },
    });
    this.io = io;

    io.on('connection', async socket => {
      logger.info(`[socket.io] new connection: ${socket.id}`);
      if (socket.handshake.headers['x-forwarded-for']) {
        this.prometheus?.connect(socket.handshake.headers['x-forwarded-for'] as string);
      } else {
        this.prometheus?.connect(socket.handshake.address);
      }
      const subscriptions = socket.handshake.query['subscriptions'];
      if (subscriptions) {
        const topics = [...[subscriptions]].flat().flatMap(r => r.split(','));
        for (const topic of topics) {
          this.prometheus?.subscribe(socket, topic);
          await socket.join(topic);
        }
      }
      socket.on('disconnect', reason => {
        logger.info(`[socket.io] disconnected ${socket.id}: ${reason}`);
        this.prometheus?.disconnect(socket);
      });
      socket.on('subscribe', async (topic, callback) => {
        if (!this.getInvalidSubscriptionTopics(topic)) {
          this.prometheus?.subscribe(socket, topic);
          await socket.join(topic);
          callback?.(null);
        }
      });
      socket.on('unsubscribe', async (...topics) => {
        for (const topic of topics) {
          this.prometheus?.unsubscribe(socket, topic);
          await socket.leave(topic);
        }
      });
    });

    // Validate topic subscriptions upon connection.
    io.use((socket, next) => {
      const subscriptions = socket.handshake.query['subscriptions'];
      if (subscriptions) {
        const topics = [...[subscriptions]].flat().flatMap(r => r.split(','));
        const invalidSubs = this.getInvalidSubscriptionTopics(topics as Topic[]);
        if (invalidSubs) {
          const error = new Error(`Invalid topic: ${invalidSubs.join(', ')}`);
          next(error);
        } else {
          next();
        }
      } else {
        next();
      }
    });

    const adapter = io.of('/').adapter;
    adapter.on('create-room', room => {
      logger.info(`[socket.io] room created: ${room}`);
    });
    adapter.on('delete-room', room => {
      logger.info(`[socket.io] room deleted: ${room}`);
    });
    adapter.on('join-room', (room, id) => {
      logger.info(`[socket.io] socket ${id} joined room: ${room}`);
    });
    adapter.on('leave-room', (room, id) => {
      logger.info(`[socket.io] socket ${id} left room: ${room}`);
    });
    this.adapter = adapter;
  }

  close(callback?: (err?: Error) => void): void {
    if (!this.io && callback) {
      callback();
    }
    this.io?.close(callback);
    this.io = undefined;
  }

  hasListeners<P extends keyof WebSocketTopics>(
    topic: P,
    ...args: ListenerType<WebSocketTopics[P]>
  ): boolean {
    if (!this.adapter) {
      return false;
    }
    switch (topic) {
      case 'block':
        return this.adapter.rooms.has('block');
      case 'microblock':
        return this.adapter.rooms.has('microblock');
      case 'mempool':
        return this.adapter.rooms.has('mempool');
      case 'nftEvent':
        return this.adapter.rooms.has('nft-event');
      case 'nftAssetEvent': {
        const [assetIdentifier, value] = args as ListenerType<WebSocketTopics['nftAssetEvent']>;
        return this.adapter.rooms.has(`nft-asset-event:${assetIdentifier}+${value}`);
      }
      case 'nftCollectionEvent': {
        const [assetIdentifier] = args as ListenerType<WebSocketTopics['nftCollectionEvent']>;
        return this.adapter.rooms.has(`nft-collection-event:${assetIdentifier}`);
      }
      case 'transaction': {
        const [txId] = args as ListenerType<WebSocketTopics['transaction']>;
        return this.adapter.rooms.has(`transaction:${txId}`);
      }
      case 'principalTransactions': {
        const [principal] = args as ListenerType<WebSocketTopics['principalTransactions']>;
        return this.adapter.rooms.has(`address-transaction:${principal}`);
      }
      case 'principalStxBalance': {
        const [principal] = args as ListenerType<WebSocketTopics['principalStxBalance']>;
        return this.adapter.rooms.has(`address-stx-balance:${principal}`);
      }
    }
    return false;
  }

  send<P extends keyof WebSocketPayload>(
    payload: P,
    ...args: ListenerType<WebSocketPayload[P]>
  ): void {
    if (!this.io) {
      return;
    }
    switch (payload) {
      case 'block': {
        const [block] = args as ListenerType<WebSocketPayload['block']>;
        this.prometheus?.sendEvent('block');
        this.io.to('block').emit('block', block);
        break;
      }
      case 'microblock': {
        const [microblock] = args as ListenerType<WebSocketPayload['microblock']>;
        this.prometheus?.sendEvent('microblock');
        this.io.to('microblock').emit('microblock', microblock);
        break;
      }
      case 'mempoolTransaction': {
        const [tx] = args as ListenerType<WebSocketPayload['mempoolTransaction']>;
        this.prometheus?.sendEvent('mempool');
        this.io.to('mempool').emit('mempool', tx);
        break;
      }
      case 'transaction': {
        const [tx] = args as ListenerType<WebSocketPayload['transaction']>;
        this.prometheus?.sendEvent('transaction');
        this.io.to(`transaction:${tx.tx_id}`).emit('transaction', tx);
        break;
      }
      case 'nftEvent': {
        const [event] = args as ListenerType<WebSocketPayload['nftEvent']>;
        this.prometheus?.sendEvent('nft-event');
        this.io.to('nft-event').emit('nft-event', event);
        break;
      }
      case 'nftAssetEvent': {
        const [assetIdentifier, value, event] = args as ListenerType<
          WebSocketPayload['nftAssetEvent']
        >;
        this.prometheus?.sendEvent('nft-asset-event');
        this.io.to('nft-event').emit('nft-asset-event', assetIdentifier, value, event);
        break;
      }
      case 'nftCollectionEvent': {
        const [assetIdentifier, event] = args as ListenerType<
          WebSocketPayload['nftCollectionEvent']
        >;
        this.prometheus?.sendEvent('nft-collection-event');
        this.io.to('nft-event').emit('nft-collection-event', assetIdentifier, event);
        break;
      }
      case 'principalTransaction': {
        const [principal, tx] = args as ListenerType<WebSocketPayload['principalTransaction']>;
        const topic: AddressTransactionTopic = `address-transaction:${principal}`;
        this.prometheus?.sendEvent('address-transaction');
        this.io.to(topic).emit('address-transaction', principal, tx);
        this.io.to(topic).emit(topic, principal, tx);
        break;
      }
      case 'principalStxBalance': {
        const [principal, balance] = args as ListenerType<WebSocketPayload['principalStxBalance']>;
        const topic: AddressStxBalanceTopic = `address-stx-balance:${principal}`;
        this.prometheus?.sendEvent('address-stx-balance');
        this.io.to(topic).emit('address-stx-balance', principal, balance);
        this.io.to(topic).emit(topic, principal, balance);
        break;
      }
    }
  }

  private getInvalidSubscriptionTopics(subscriptions: Topic | Topic[]): undefined | string[] {
    const isSubValid = (sub: Topic): undefined | string => {
      if (sub.includes(':')) {
        const txOrAddr = sub.split(':')[0];
        const value = sub.split(':')[1];
        switch (txOrAddr) {
          case 'address-transaction':
          case 'address-stx-balance':
            return isValidPrincipal(value) ? undefined : sub;
          case 'transaction':
            return isValidTxId(value) ? undefined : sub;
          case 'nft-asset-event': {
            const [assetIdentifier, token] = sub.substring(16).split('+');
            const [contractId, tokenClass] = assetIdentifier.split('::');
            return token && tokenClass && isValidPrincipal(contractId) != false ? undefined : sub;
          }
          case 'nft-collection-event': {
            const assetIdentifier = sub.substring(21);
            const [contractId, tokenClass] = assetIdentifier.split('::');
            return tokenClass && isValidPrincipal(contractId) != false ? undefined : sub;
          }
          default:
            return sub;
        }
      }
      switch (sub) {
        case 'block':
        case 'mempool':
        case 'microblock':
        case 'nft-event':
          return undefined;
        default:
          return sub;
      }
    };
    if (!Array.isArray(subscriptions)) {
      const invalidSub = isSubValid(subscriptions);
      return invalidSub ? [invalidSub] : undefined;
    }
    const validatedSubs = subscriptions.map(isSubValid);
    const invalidSubs = validatedSubs.filter(validSub => typeof validSub === 'string');
    return invalidSubs.length === 0 ? undefined : (invalidSubs as string[]);
  }
}
