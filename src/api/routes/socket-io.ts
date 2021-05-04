import { Server as SocketIOServer, Socket } from 'socket.io';
import * as http from 'http';
import { DataStore } from '../../datastore/common';
import {
  AddressTransactionsRoom,
  AddressTransactionWithTransfers,
  ClientToServerMessages,
  Room,
  ServerToClientMessages,
} from '@stacks/stacks-blockchain-api-types';
import { parseDbBlock, parseDbMempoolTx, parseDbTx } from '../controllers/db-controller';
import { logger } from '../../helpers';

export function createSocketIORouter(db: DataStore, server: http.Server) {
  const io = new SocketIOServer<ClientToServerMessages, ServerToClientMessages>(server, {
    cors: { origin: '*' },
  });
  io.on('connection', socket => {
    const subscriptions = socket.handshake.query['subscriptions'];
    if (subscriptions) {
      const rooms = [...[subscriptions]].flat().flatMap(r => r.split(','));
      rooms.forEach(room => socket.join(room));
    }
    socket.on('subscribe', (...rooms) => {
      void socket.join(rooms);
    });
    socket.on('unsubscribe', (...rooms) => {
      rooms.forEach(room => void socket.leave(room));
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

  db.on('blockUpdate', (dbBlock, txIds) => {
    // Only parse and emit data if there are currently subscriptions to the blocks room
    if (adapter.rooms.has('blocks')) {
      const block = parseDbBlock(dbBlock, txIds);
      io.to('blocks').emit('block', block);
    }
  });

  db.on('txUpdate', dbTx => {
    // Only parse and emit data if there are currently subscriptions to the mempool room
    if (adapter.rooms.has('mempool')) {
      // only watch for mempool txs
      if ('receipt_time' in dbTx) {
        // do not send updates for dropped/pruned mempool txs
        if (!dbTx.pruned) {
          const tx = parseDbMempoolTx(dbTx);
          io.to('mempool').emit('mempool', tx);
        }
      }
    }
  });

  db.on('addressUpdate', addressUpdate => {
    // Check if there are any subscribers for this address
    const addrKey: AddressTransactionsRoom = `address-transactions:${addressUpdate.address}` as const;
    if (adapter.rooms.has(addrKey)) {
      addressUpdate.txs.forEach((stxEvents, dbTx) => {
        const parsedTx = parseDbTx(dbTx);
        let stxSent = 0n;
        let stxReceived = 0n;
        const stxTransfers: AddressTransactionWithTransfers['stx_transfers'] = [];
        Array.from(stxEvents).forEach(event => {
          if (event.recipient === addressUpdate.address) {
            stxReceived += event.amount;
          }
          if (event.sender === addressUpdate.address) {
            stxSent += event.amount;
          }
          stxTransfers.push({
            amount: event.amount.toString(),
            sender: event.sender,
            recipient: event.recipient,
          });
        });
        if (dbTx.sender_address === addressUpdate.address) {
          stxSent += dbTx.fee_rate;
        }
        const result: AddressTransactionWithTransfers = {
          tx: parsedTx,
          stx_sent: stxSent.toString(),
          stx_received: stxReceived.toString(),
          stx_transfers: stxTransfers,
        };
        io.to(addrKey).emit('address-transaction', addressUpdate.address, result);
      });
    }
  });

  return io;
}
