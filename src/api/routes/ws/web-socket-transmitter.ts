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
import { WsRpcChannel } from './channels/ws-rpc-channel';
import { parseNftEvent } from '../../../datastore/helpers';
import { logger } from '../../../helpers';
import { sqlTransaction } from 'src/datastore/connection';

/**
 * This object matches real time update `WebSocketTopics` subscriptions with internal
 * `PgStoreEventEmitter` notifications. If a match is found, the relevant data is queried from the
 * database and returned to users using all available WebSocket channels.
 */
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
    this.db.eventEmitter.addListener('nftEventUpdate', (txId, eventIndex) =>
      this.nftEventUpdate(txId, eventIndex)
    );
    this.db.eventEmitter.addListener('txUpdate', txId => this.txUpdate(txId));
    this.db.eventEmitter.addListener('addressUpdate', (address, blockHeight) =>
      this.addressUpdate(address, blockHeight)
    );

    this.channels.push(new SocketIOChannel(this.server));
    this.channels.push(new WsRpcChannel(this.server));
    this.channels.forEach(c => c.connect());
  }

  close(callback: (err?: Error | undefined) => void) {
    Promise.all(
      this.channels.map(
        c =>
          new Promise<void>((resolve, reject) => {
            c.close(error => {
              if (error) {
                reject(error);
              } else {
                resolve();
              }
            });
          })
      )
    )
      .then(_ => callback())
      .catch(error => callback(error));
  }

  private async blockUpdate(blockHash: string) {
    if (this.channels.find(c => c.hasListeners('block'))) {
      try {
        const blockQuery = await getBlockFromDataStore(this.db.sql, {
          blockIdentifer: { hash: blockHash },
          db: this.db,
        });
        if (blockQuery.found) {
          this.channels.forEach(c => c.send('block', blockQuery.result));
        }
      } catch (error) {
        logger.error(error);
      }
    }
  }

  private async microblockUpdate(microblockHash: string) {
    if (this.channels.find(c => c.hasListeners('microblock'))) {
      try {
        const microblockQuery = await getMicroblockFromDataStore(this.db.sql, {
          db: this.db,
          microblockHash: microblockHash,
        });
        if (microblockQuery.found) {
          this.channels.forEach(c => c.send('microblock', microblockQuery.result));
        }
      } catch (error) {
        logger.error(error);
      }
    }
  }

  private async txUpdate(txId: string) {
    if (this.channels.find(c => c.hasListeners('mempool'))) {
      try {
        const mempoolTxs = await getMempoolTxsFromDataStore(this.db.sql, this.db, {
          txIds: [txId],
          includeUnanchored: true,
        });
        if (mempoolTxs.length > 0) {
          this.channels.forEach(c => c.send('mempoolTransaction', mempoolTxs[0]));
        }
      } catch (error) {
        logger.error(error);
      }
    }

    if (this.channels.find(c => c.hasListeners('transaction', txId))) {
      try {
        const result = await sqlTransaction(this.db.sql, async sql => {
          // Look at the `txs` table first so we always prefer the confirmed transaction.
          const txQuery = await getTxFromDataStore(sql, this.db, {
            txId: txId,
            includeUnanchored: true,
          });
          if (txQuery.found) {
            return txQuery.result;
          } else {
            // Tx is not yet confirmed, look at `mempool_txs`.
            const mempoolTxs = await getMempoolTxsFromDataStore(sql, this.db, {
              txIds: [txId],
              includeUnanchored: true,
            });
            if (mempoolTxs.length > 0) {
              return mempoolTxs[0];
            }
          }
        });
        if (result) {
          this.channels.forEach(c => c.send('transaction', result));
        }
      } catch (error) {
        logger.error(error);
      }
    }
  }

  private async nftEventUpdate(txId: string, eventIndex: number) {
    try {
      const nftEvent = await this.db.getNftEvent(this.db.sql, { txId, eventIndex });
      if (!nftEvent.found) {
        return;
      }
      const assetIdentifier = nftEvent.result.asset_identifier;
      const value = nftEvent.result.value;
      const event = parseNftEvent(nftEvent.result);

      if (this.channels.find(c => c.hasListeners('nftEvent'))) {
        this.channels.forEach(c => c.send('nftEvent', event));
      }
      if (this.channels.find(c => c.hasListeners('nftAssetEvent', assetIdentifier, value))) {
        this.channels.forEach(c => c.send('nftAssetEvent', assetIdentifier, value, event));
      }
      if (this.channels.find(c => c.hasListeners('nftCollectionEvent', assetIdentifier))) {
        this.channels.forEach(c => c.send('nftCollectionEvent', assetIdentifier, event));
      }
    } catch (error) {
      logger.error(error);
    }
  }

  private async addressUpdate(address: string, blockHeight: number) {
    if (this.channels.find(c => c.hasListeners('principalTransactions', address))) {
      try {
        const dbTxsQuery = await this.db.getAddressTxsWithAssetTransfers(this.db.sql, {
          stxAddress: address,
          blockHeight: blockHeight,
          atSingleBlock: true,
        });
        if (dbTxsQuery.total == 0) {
          return;
        }
        const addressTxs = dbTxsQuery.results;
        for (const addressTx of addressTxs) {
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
          this.channels.forEach(c => c.send('principalTransaction', address, result));
        }
      } catch (error) {
        logger.error(error);
      }
    }

    if (this.channels.find(c => c.hasListeners('principalStxBalance', address))) {
      try {
        const balance = await sqlTransaction(this.db.sql, async sql => {
          const stxBalanceResult = await this.db.getStxBalanceAtBlock(sql, address, blockHeight);
          const tokenOfferingLocked = await this.db.getTokenOfferingLocked(
            sql,
            address,
            blockHeight
          );
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
          return balance;
        });
        this.channels.forEach(c => c.send('principalStxBalance', address, balance));
      } catch (error) {
        logger.error(error);
      }
    }
  }
}
