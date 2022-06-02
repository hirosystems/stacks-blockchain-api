import * as http from 'http';
import { AddressStxBalanceResponse, AddressTransactionWithTransfers } from 'docs/generated';
import {
  getBlockFromDataStore,
  getMempoolTxsFromDataStore,
  getMicroblockFromDataStore,
  getTxFromDataStore,
  parseDbTx,
} from '../../controllers/db-controller';
import { PgStore } from '../../../datastore/pg-store';
import { WebSocketChannel } from './web-socket-channel';
import { SocketIOChannel } from './channels/socket-io-channel';

export class WebSocketTransmitter {
  readonly db: PgStore;
  readonly server: http.Server;
  private channels: WebSocketChannel[] = [];

  constructor(db: PgStore, server: http.Server) {
    this.db = db;
    this.server = server;
  }

  connect() {
    this.db.eventEmitter.addListener('blockUpdate', blockHash => this.blockUpdate(blockHash));
    this.db.eventEmitter.addListener('microblockUpdate', microblockHash =>
      this.microblockUpdate(microblockHash)
    );
    this.db.eventEmitter.addListener('txUpdate', txId => this.txUpdate(txId));
    this.db.eventEmitter.addListener('addressUpdate', (address, blockHeight) =>
      this.addressUpdate(address, blockHeight)
    );

    this.channels.push(new SocketIOChannel(this.server));
    this.channels.map(c => c.connect());
  }

  close(callback?: (err?: Error | undefined) => void) {
    // FIXME: callback
    this.channels.map(c => c.close());
  }

  private async blockUpdate(blockHash: string) {
    if (this.channels.filter(c => c.hasListeners('block'))) {
      const blockQuery = await getBlockFromDataStore({
        blockIdentifer: { hash: blockHash },
        db: this.db,
      });
      if (blockQuery.found) {
        this.channels.map(c => c.send('block', blockQuery.result));
      }
    }
  }

  private async microblockUpdate(microblockHash: string) {
    if (this.channels.filter(c => c.hasListeners('microblock'))) {
      const microblockQuery = await getMicroblockFromDataStore({
        db: this.db,
        microblockHash: microblockHash,
      });
      if (microblockQuery.found) {
        this.channels.map(c => c.send('microblock', microblockQuery.result));
      }
    }
  }

  private async txUpdate(txId: string) {
    if (this.channels.filter(c => c.hasListeners('mempool'))) {
      const mempoolTxs = await getMempoolTxsFromDataStore(this.db, {
        txIds: [txId],
        includeUnanchored: true,
      });
      if (mempoolTxs.length > 0) {
        this.channels.map(c => c.send('mempoolTransaction', mempoolTxs[0]));
      }
    }

    if (this.channels.filter(c => c.hasListeners('transaction', txId))) {
      const mempoolTxs = await getMempoolTxsFromDataStore(this.db, {
        txIds: [txId],
        includeUnanchored: true,
      });
      if (mempoolTxs.length > 0) {
        // prometheus?.sendEvent('transaction');
        // io.to(mempoolTopic).emit('transaction', mempoolTxs[0]);
      } else {
        const txQuery = await getTxFromDataStore(this.db, {
          txId: txId,
          includeUnanchored: true,
        });
        if (txQuery.found) {
          // prometheus?.sendEvent('transaction');
          // io.to(mempoolTopic).emit('transaction', txQuery.result);
        }
      }
    }
  }

  private async addressUpdate(address: string, blockHeight: number) {
    if (
      this.channels.filter(
        c =>
          c.hasListeners('principalTransactions', address) ||
          c.hasListeners('principalStxBalance', address)
      )
    ) {
      const dbTxsQuery = await this.db.getAddressTxsWithAssetTransfers({
        stxAddress: address,
        blockHeight: blockHeight,
        atSingleBlock: true,
      });
      if (dbTxsQuery.total == 0) {
        return;
      }
      const addressTxs = dbTxsQuery.results;
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
        // prometheus?.sendEvent('address-transaction');
        // io.to(addrTxTopic).emit('address-transaction', address, result);
        // io.to(addrTxTopic).emit(addrTxTopic, address, result);
      });

      // Get latest balance (in case multiple txs come in from different blocks)
      // const blockHeights = addressTxs.map(tx => tx.tx.block_height);
      // const latestBlock = Math.max(...blockHeights);
      const stxBalanceResult = await this.db.getStxBalanceAtBlock(address, blockHeight);
      const tokenOfferingLocked = await this.db.getTokenOfferingLocked(address, blockHeight);
      const balance: AddressStxBalanceResponse = {
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
        balance.token_offering_locked = tokenOfferingLocked.result;
      }
      // return result;
      // getAddressStxBalance(address, latestBlock)
      //   .then(balance => {
      //     prometheus?.sendEvent('address-stx-balance');
      //     io.to(addrStxBalanceTopic).emit('address-stx-balance', address, balance);
      //     io.to(addrStxBalanceTopic).emit(addrStxBalanceTopic, address, balance);
      //   })
      //   .catch(error => {
      //     logError(`[socket.io] Error querying STX balance update for ${address}`, error);
      //   });
    }
  }
}
