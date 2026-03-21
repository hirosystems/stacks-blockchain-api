import { EventEmitter } from 'events';
import { DbConfigState, DbMempoolStats } from './common.js';

interface DataStoreEvents {
  txUpdate: (txId: string) => void;
  blockUpdate: (blockHash: string) => void;
  microblockUpdate: (microblockHash: string) => void;
  nftEventUpdate: (txId: string, eventIndex: number) => void;
  addressUpdate: (address: string, blockHeight: number) => void;
  nameUpdate: (info: string) => void;
  smartContractUpdate: (contractId: string) => void;
  smartContractLogUpdate: (txId: string, eventIndex: number) => void;
  tokensUpdate: (contractID: string) => void;
  tokenMetadataUpdateQueued: (queueId: number) => void;
  mempoolStatsUpdate: (mempoolStats: DbMempoolStats) => void;
  configStateUpdate: (configState: DbConfigState) => void;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface PgStoreEventEmitter {
  emit<K extends keyof DataStoreEvents>(event: K, ...args: Parameters<DataStoreEvents[K]>): boolean;
  on<K extends keyof DataStoreEvents>(event: K, listener: DataStoreEvents[K]): this;
  addListener<K extends keyof DataStoreEvents>(event: K, listener: DataStoreEvents[K]): this;
  removeListener<K extends keyof DataStoreEvents>(event: K, listener: DataStoreEvents[K]): this;
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class PgStoreEventEmitter extends EventEmitter {}
