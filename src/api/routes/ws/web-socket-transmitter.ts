import * as http from 'http';
import PQueue from 'p-queue';
import type { AddressStxBalanceResponse, AddressTransactionWithTransfers } from 'client/src/types';
import {
  getBlockFromDataStore,
  getMempoolTxsFromDataStore,
  getMicroblockFromDataStore,
  getTxFromDataStore,
  parseDbTx,
} from '../../controllers/db-controller';
import { PgStore } from '../../../datastore/pg-store';
import { ListenerType, WebSocketChannel, WebSocketPayload } from './web-socket-channel';
import { SocketIOChannel } from './channels/socket-io-channel';
import { WsRpcChannel } from './channels/ws-rpc-channel';
import { parseNftEvent } from '../../../datastore/helpers';
import { logger } from '../../../logger';

export function getWsPingIntervalMs(): number {
  return parseInt(process.env['STACKS_API_WS_PING_INTERVAL'] ?? '5') * 1000;
}

export function getWsPingTimeoutMs(): number {
  return parseInt(process.env['STACKS_API_WS_PING_TIMEOUT'] ?? '5') * 1000;
}

export function getWsMessageTimeoutMs(): number {
  return parseInt(process.env['STACKS_API_WS_MESSAGE_TIMEOUT'] ?? '5') * 1000;
}

function getWsUpdateQueueTimeoutMs(): number {
  return parseInt(process.env['STACKS_API_WS_UPDATE_QUEUE_TIMEOUT'] ?? '5') * 1000;
}

/**
 * This object matches real time update `WebSocketTopics` subscriptions with internal
 * `PgStoreEventEmitter` notifications. If a match is found, the relevant data is queried from the
 * database and returned to users using all available WebSocket channels.
 */
export class WebSocketTransmitter {
  readonly db: PgStore;
  readonly server: http.Server;
  private channels: WebSocketChannel[] = [];
  private queue: PQueue;

  constructor(db: PgStore, server: http.Server) {
    this.db = db;
    this.server = server;
    // This queue will send all messages through web socket channels, one at a time.
    this.queue = new PQueue({
      autoStart: true,
      concurrency: 1,
      timeout: getWsUpdateQueueTimeoutMs(),
      throwOnTimeout: true,
    });
  }

  connect() {
    this.db.eventEmitter.addListener('blockUpdate', blockHash =>
      this.queue
        .add(() => this.blockUpdate(blockHash))
        .catch(error => logger.error(error, 'WebSocketTransmitter blockUpdate error'))
    );
    this.db.eventEmitter.addListener('microblockUpdate', microblockHash =>
      this.queue
        .add(() => this.microblockUpdate(microblockHash))
        .catch(error => logger.error(error, 'WebSocketTransmitter microblockUpdate error'))
    );
    this.db.eventEmitter.addListener('nftEventUpdate', (txId, eventIndex) =>
      this.queue
        .add(() => this.nftEventUpdate(txId, eventIndex))
        .catch(error => logger.error(error, 'WebSocketTransmitter nftEventUpdate error'))
    );
    this.db.eventEmitter.addListener('txUpdate', txId =>
      this.queue
        .add(() => this.txUpdate(txId))
        .catch(error => logger.error(error, 'WebSocketTransmitter txUpdate error'))
    );
    this.db.eventEmitter.addListener('addressUpdate', (address, blockHeight) =>
      this.queue
        .add(() => this.addressUpdate(address, blockHeight))
        .catch(error => logger.error(error, 'WebSocketTransmitter addressUpdate error'))
    );

    this.channels.push(new SocketIOChannel(this.server));
    this.channels.push(new WsRpcChannel(this.server));
    this.channels.forEach(c => c.connect());
  }

  close(callback: (err?: Error | undefined) => void) {
    this.queue.pause();
    this.queue.clear();
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

  private send<P extends keyof WebSocketPayload>(
    payload: P,
    ...args: ListenerType<WebSocketPayload[P]>
  ): Promise<void[]> {
    return Promise.all(this.channels.map(c => c.send(payload, ...args)));
  }

  private async blockUpdate(blockHash: string) {
    if (this.channels.find(c => c.hasListeners('block'))) {
      try {
        const blockQuery = await getBlockFromDataStore({
          blockIdentifer: { hash: blockHash },
          db: this.db,
        });
        if (blockQuery.found) {
          await this.send('block', blockQuery.result);
        }
      } catch (error) {
        logger.error(error);
      }
    }
  }

  private async microblockUpdate(microblockHash: string) {
    if (this.channels.find(c => c.hasListeners('microblock'))) {
      try {
        const microblockQuery = await getMicroblockFromDataStore({
          db: this.db,
          microblockHash: microblockHash,
        });
        if (microblockQuery.found) {
          await this.send('microblock', microblockQuery.result);
        }
      } catch (error) {
        logger.error(error);
      }
    }
  }

  private async txUpdate(txId: string) {
    if (this.channels.find(c => c.hasListeners('mempool'))) {
      try {
        const mempoolTxs = await getMempoolTxsFromDataStore(this.db, {
          txIds: [txId],
          includeUnanchored: true,
        });
        if (mempoolTxs.length > 0) {
          await this.send('mempoolTransaction', mempoolTxs[0]);
        }
      } catch (error) {
        logger.error(error);
      }
    }

    if (this.channels.find(c => c.hasListeners('transaction', txId))) {
      try {
        const result = await this.db.sqlTransaction(async sql => {
          // Look at the `txs` table first so we always prefer the confirmed transaction.
          const txQuery = await getTxFromDataStore(this.db, {
            txId: txId,
            includeUnanchored: true,
          });
          if (txQuery.found) {
            return txQuery.result;
          } else {
            // Tx is not yet confirmed, look at `mempool_txs`.
            const mempoolTxs = await getMempoolTxsFromDataStore(this.db, {
              txIds: [txId],
              includeUnanchored: true,
            });
            if (mempoolTxs.length > 0) {
              return mempoolTxs[0];
            }
          }
        });
        if (result) {
          await this.send('transaction', result);
        }
      } catch (error) {
        logger.error(error);
      }
    }
  }

  private async nftEventUpdate(txId: string, eventIndex: number) {
    try {
      const nftEvent = await this.db.getNftEvent({ txId, eventIndex });
      if (!nftEvent.found) {
        return;
      }
      const assetIdentifier = nftEvent.result.asset_identifier;
      const value = nftEvent.result.value;
      const event = parseNftEvent(nftEvent.result);

      if (this.channels.find(c => c.hasListeners('nftEvent'))) {
        await this.send('nftEvent', event);
      }
      if (this.channels.find(c => c.hasListeners('nftAssetEvent', assetIdentifier, value))) {
        await this.send('nftAssetEvent', assetIdentifier, value, event);
      }
      if (this.channels.find(c => c.hasListeners('nftCollectionEvent', assetIdentifier))) {
        await this.send('nftCollectionEvent', assetIdentifier, event);
      }
    } catch (error) {
      logger.error(error);
    }
  }

  private async addressUpdate(address: string, blockHeight: number) {
    if (this.channels.find(c => c.hasListeners('principalTransactions', address))) {
      try {
        const dbTxsQuery = await this.db.getAddressTxsWithAssetTransfers({
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
          await this.send('principalTransaction', address, result);
        }
      } catch (error) {
        logger.error(error);
      }
    }

    if (this.channels.find(c => c.hasListeners('principalStxBalance', address))) {
      try {
        const balance = await this.db.sqlTransaction(async sql => {
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
          return balance;
        });
        await this.send('principalStxBalance', address, balance);
      } catch (error) {
        logger.error(error);
      }
    }
  }
}
