import { Server as SocketIOServer } from 'socket.io';
import * as http from 'http';
import * as prom from 'prom-client';
import { DataStore } from '../../../datastore/common';
import {
  AddressStxBalanceResponse,
  AddressStxBalanceTopic,
  AddressTransactionTopic,
  AddressTransactionWithTransfers,
  ClientToServerMessages,
  Topic,
  ServerToClientMessages,
} from '@stacks/stacks-blockchain-api-types';
import {
  getBlockFromDataStore,
  getMempoolTxsFromDataStore,
  getMicroblockFromDataStore,
  getTxFromDataStore,
  parseDbTx,
} from '../../controllers/db-controller';
import { isProdEnv, logError, logger } from '../../../helpers';

interface SocketIOMetrics {
  subscriptions: prom.Gauge<string>;
  connectTotal: prom.Counter<string>;
  disconnectTotal: prom.Counter<string>;
  eventsSent: prom.Counter<string>;
}

class SocketIOPrometheus {
  private metrics: SocketIOMetrics;

  constructor() {
    this.metrics = {
      subscriptions: new prom.Gauge({
        name: 'socket_io_subscriptions',
        help: 'Current subscriptions',
        labelNames: ['topic'],
      }),
      connectTotal: new prom.Counter({
        name: 'socket_io_connect_total',
        help: 'Total count of socket.io connection requests',
      }),
      disconnectTotal: new prom.Counter({
        name: 'socket_io_disconnect_total',
        help: 'Total count of socket.io disconnections',
      }),
      eventsSent: new prom.Counter({
        name: 'socket_io_events_sent',
        help: 'Socket.io sent events',
        labelNames: ['event'],
      }),
    };
  }

  public connect() {
    this.metrics.connectTotal.inc();
  }

  public disconnect() {
    this.metrics.disconnectTotal.inc();
  }

  public subscribe(topic: Topic | Topic[] | string) {
    if (Array.isArray(topic)) {
      topic.forEach(t => this.metrics.subscriptions.inc({ topic: t.toString() }));
    } else {
      this.metrics.subscriptions.inc({ topic: topic.toString() });
    }
  }

  public unsubscribe(topic: Topic | string) {
    this.metrics.subscriptions.dec({ topic: topic.toString() });
  }

  public sendEvent(event: string) {
    this.metrics.eventsSent.inc({ event: event });
  }
}

export function createSocketIORouter(db: DataStore, server: http.Server) {
  const io = new SocketIOServer<ClientToServerMessages, ServerToClientMessages>(server, {
    cors: { origin: '*' },
  });
  let prometheus: SocketIOPrometheus | null;
  if (isProdEnv) {
    prometheus = new SocketIOPrometheus();
  }

  io.on('connection', socket => {
    logger.info('[socket.io] new connection');
    prometheus?.connect();
    socket.on('disconnect', reason => {
      logger.info(`[socket.io] disconnected: ${reason}`);
      prometheus?.disconnect();
    });
    const subscriptions = socket.handshake.query['subscriptions'];
    if (subscriptions) {
      // TODO: check if init topics are valid, reject connection with error if not
      const topics = [...[subscriptions]].flat().flatMap(r => r.split(','));
      topics.forEach(topic => {
        prometheus?.subscribe(topic);
        void socket.join(topic);
      });
    }
    socket.on('subscribe', (topic, callback) => {
      prometheus?.subscribe(topic);
      void socket.join(topic);
      // TODO: check if topic is valid, and return error message if not
      callback?.(null);
    });
    socket.on('unsubscribe', (...topics) => {
      topics.forEach(topic => {
        prometheus?.unsubscribe(topic);
        void socket.leave(topic);
      });
    });
  });

  const adapter = io.of('/').adapter;

  adapter.on('create-room', room => {
    logger.info(`[socket.io] room created: "${room}"`);
  });

  adapter.on('delete-room', room => {
    logger.info(`[socket.io] room deleted: "${room}"`);
  });

  adapter.on('join-room', (room, id) => {
    logger.info(`[socket.io] socket ${id} joined room "${room}"`);
  });

  adapter.on('leave-room', (room, id) => {
    logger.info(`[socket.io] socket ${id} left room "${room}"`);
  });

  db.on('blockUpdate', async blockHash => {
    // Only parse and emit data if there are currently subscriptions to the blocks topic
    const blockTopic: Topic = 'block';
    if (adapter.rooms.has(blockTopic)) {
      const blockQuery = await getBlockFromDataStore({ blockIdentifer: { hash: blockHash }, db });
      if (!blockQuery.found) {
        return;
      }
      const block = blockQuery.result;
      prometheus?.sendEvent('block');
      io.to(blockTopic).emit('block', block);
    }
  });

  db.on('microblockUpdate', async microblockHash => {
    const microblockTopic: Topic = 'microblock';
    if (adapter.rooms.has(microblockTopic)) {
      const microblockQuery = await getMicroblockFromDataStore({
        db: db,
        microblockHash: microblockHash,
      });
      if (!microblockQuery.found) {
        return;
      }
      const microblock = microblockQuery.result;
      prometheus?.sendEvent('microblock');
      io.to(microblockTopic).emit('microblock', microblock);
    }
  });

  db.on('txUpdate', async txId => {
    // Mempool updates
    const mempoolTopic: Topic = 'mempool';
    if (adapter.rooms.has(mempoolTopic)) {
      const mempoolTxs = await getMempoolTxsFromDataStore(db, {
        txIds: [txId],
        includeUnanchored: true,
      });
      if (mempoolTxs.length > 0) {
        const mempoolTx = mempoolTxs[0];
        prometheus?.sendEvent('mempool');
        io.to(mempoolTopic).emit('mempool', mempoolTx);
      }
    }

    // Individual tx updates
    const txTopic: Topic = `transaction:${txId}`;
    if (adapter.rooms.has(txTopic)) {
      const mempoolTxs = await getMempoolTxsFromDataStore(db, {
        txIds: [txId],
        includeUnanchored: true,
      });
      if (mempoolTxs.length > 0) {
        prometheus?.sendEvent('tx');
        io.to(mempoolTopic).emit('transaction', mempoolTxs[0]);
      } else {
        const txQuery = await getTxFromDataStore(db, {
          txId: txId,
          includeUnanchored: true,
        });
        if (txQuery.found) {
          prometheus?.sendEvent('tx');
          io.to(mempoolTopic).emit('transaction', txQuery.result);
        }
      }
    }
  });

  db.on('addressUpdate', async (address, blockHeight) => {
    const addrTxTopic: AddressTransactionTopic = `address-transaction:${address}` as const;
    const addrStxBalanceTopic: AddressStxBalanceTopic = `address-stx-balance:${address}` as const;
    if (!adapter.rooms.has(addrTxTopic) && !adapter.rooms.has(addrStxBalanceTopic)) {
      return;
    }
    const dbTxsQuery = await db.getAddressTxsWithAssetTransfers({
      stxAddress: address,
      blockHeight: blockHeight,
      atSingleBlock: true,
    });
    if (dbTxsQuery.total == 0) {
      return;
    }
    const addressTxs = dbTxsQuery.results;

    // Address txs updates
    if (adapter.rooms.has(addrTxTopic)) {
      addressTxs.forEach(addressTx => {
        const parsedTx = parseDbTx(addressTx.tx);
        const result: AddressTransactionWithTransfers = {
          tx: parsedTx,
          stx_sent: addressTx.stx_sent.toString(),
          stx_received: addressTx.stx_received.toString(),
          stx_transfers: addressTx.stx_transfers.map(value => {
            return {
              amount: value.amount.toString(),
              sender: value.sender,
              recipient: value.recipient,
            };
          }),
        };
        prometheus?.sendEvent('address-transaction');
        io.to(addrTxTopic).emit('address-transaction', address, result);
        io.to(addrTxTopic).emit(addrTxTopic, address, result);
      });
    }

    // Address STX balance updates
    if (adapter.rooms.has(addrStxBalanceTopic)) {
      // Get latest balance (in case multiple txs come in from different blocks)
      const blockHeights = addressTxs.map(tx => tx.tx.block_height);
      const latestBlock = Math.max(...blockHeights);
      void getAddressStxBalance(address, latestBlock)
        .then(balance => {
          prometheus?.sendEvent('address-stx-balance');
          io.to(addrStxBalanceTopic).emit('address-stx-balance', address, balance);
          io.to(addrStxBalanceTopic).emit(addrStxBalanceTopic, address, balance);
        })
        .catch(error => {
          logError(`[socket.io] Error querying STX balance update for ${address}`, error);
        });
    }
  });

  async function getAddressStxBalance(address: string, blockHeight: number) {
    const stxBalanceResult = await db.getStxBalanceAtBlock(address, blockHeight);
    const tokenOfferingLocked = await db.getTokenOfferingLocked(address, blockHeight);
    const result: AddressStxBalanceResponse = {
      balance: stxBalanceResult.balance.toString(),
      total_sent: stxBalanceResult.totalSent.toString(),
      total_received: stxBalanceResult.totalReceived.toString(),
      total_fees_sent: stxBalanceResult.totalFeesSent.toString(),
      total_miner_rewards_received: stxBalanceResult.totalMinerRewardsReceived.toString(),
      lock_tx_id: stxBalanceResult.lockTxId,
      locked: stxBalanceResult.locked.toString(),
      lock_height: stxBalanceResult.lockHeight,
      burnchain_lock_height: stxBalanceResult.burnchainLockHeight,
      burnchain_unlock_height: stxBalanceResult.burnchainUnlockHeight,
    };
    if (tokenOfferingLocked.found) {
      result.token_offering_locked = tokenOfferingLocked.result;
    }
    return result;
  }

  return io;
}
