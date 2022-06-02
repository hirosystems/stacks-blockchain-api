import {
  getBlockFromDataStore,
  getMicroblockFromDataStore,
} from '../../../api/controllers/db-controller';
import { PgStore } from '../../../datastore/pg-store';

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
    //
  }

  private async addressUpdate(address: string, blockHeight: number) {
    //
  }
}
