import { Server as SocketIOServer, Socket } from 'socket.io';
import * as http from 'http';
import { DataStore } from '../../datastore/common';
import {
  AddressStxBalanceResponse,
  AddressStxBalanceRoom,
  AddressTransactionsRoom,
  AddressTransactionWithTransfers,
  ClientToServerMessages,
  Room,
  ServerToClientMessages,
} from '@stacks/stacks-blockchain-api-types';
import { parseDbBlock, parseDbMempoolTx, parseDbTx } from '../controllers/db-controller';
import { logError, logger } from '../../helpers';

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

  db.on('addressUpdate', info => {
    // Check for any subscribers to tx updates related to this address
    const addrTxKey: AddressTransactionsRoom = `address-transactions:${info.address}` as const;
    if (adapter.rooms.has(addrTxKey)) {
      info.txs.forEach((stxEvents, dbTx) => {
        const parsedTx = parseDbTx(dbTx);
        let stxSent = 0n;
        let stxReceived = 0n;
        const stxTransfers: AddressTransactionWithTransfers['stx_transfers'] = [];
        Array.from(stxEvents).forEach(event => {
          if (event.recipient === info.address) {
            stxReceived += event.amount;
          }
          if (event.sender === info.address) {
            stxSent += event.amount;
          }
          stxTransfers.push({
            amount: event.amount.toString(),
            sender: event.sender,
            recipient: event.recipient,
          });
        });
        if (dbTx.sender_address === info.address) {
          stxSent += dbTx.fee_rate;
        }
        const result: AddressTransactionWithTransfers = {
          tx: parsedTx,
          stx_sent: stxSent.toString(),
          stx_received: stxReceived.toString(),
          stx_transfers: stxTransfers,
        };
        io.to(addrTxKey).emit('address-transaction', info.address, result);
      });
    }

    // Check for any subscribers to STX balance updates for this address
    const addrStxBalanceKey: AddressStxBalanceRoom = `address-stx-balance:${info.address}` as const;
    if (adapter.rooms.has(addrStxBalanceKey)) {
      // Get latest balance (in case multiple txs come in from different blocks)
      const blockHeights = Array.from(info.txs.keys()).map(tx => tx.block_height);
      const latestBlock = Math.max(...blockHeights);
      void getAddressStxBalance(info.address, latestBlock)
        .then(balance => {
          io.to(addrStxBalanceKey).emit('address-stx-balance', info.address, balance);
        })
        .catch(error => {
          logError(`[socket.io] Error querying STX balance update for ${info.address}`, error);
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
