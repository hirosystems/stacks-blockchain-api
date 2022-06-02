import {
  AddressStxBalanceResponse,
  AddressTransactionWithTransfers,
  Block,
  MempoolTransaction,
  Microblock,
  Transaction,
} from 'docs/generated';
import {
  getBlockFromDataStore,
  getMempoolTxsFromDataStore,
  getMicroblockFromDataStore,
  getTxFromDataStore,
} from '../../../api/controllers/db-controller';
import { PgStore } from '../../../datastore/pg-store';

export interface WebSocketChannel {
  hasBlockListeners(): boolean;
  sendBlock(block: Block): void;

  hasMicroblockListeners(): boolean;
  sendMicroblock(microblock: Microblock): void;

  hasMempoolListeners(): boolean;
  sendMempoolTransaction(transaction: MempoolTransaction): void;

  hasTransactionListeners(txId: string): boolean;
  sendTransaction(transaction: Transaction | MempoolTransaction): void;

  hasPrincipalTransactionListeners(principal: string): boolean;
  sendPrincipalTransaction(principal: string, transaction: AddressTransactionWithTransfers): void;

  hasPrincipalStxBalanceListeners(principal: string): boolean;
  sendPrincipalStxBalance(principal: string, stxBalance: AddressStxBalanceResponse): void;
}

export class EventListener {
  readonly db: PgStore;

  constructor(db: PgStore) {
    this.db = db;
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
  }

  close() {
    //
  }

  private async blockUpdate(blockHash: string) {
    const blockQuery = await getBlockFromDataStore({
      blockIdentifer: { hash: blockHash },
      db: this.db,
    });
    if (!blockQuery.found) {
      return;
    }
    const block = blockQuery.result;
  }

  private async microblockUpdate(microblockHash: string) {
    const microblockQuery = await getMicroblockFromDataStore({
      db: this.db,
      microblockHash: microblockHash,
    });
    if (!microblockQuery.found) {
      return;
    }
    const microblock = microblockQuery.result;
  }

  private async txUpdate(txId: string) {
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

  private async addressUpdate(address: string, blockHeight: number) {
    //
  }
}
