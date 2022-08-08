import { EventEmitter } from 'events';
import StrictEventEmitter from 'strict-event-emitter-types';
import { DbMempoolStats } from './common';

type DataStoreEventEmitter = StrictEventEmitter<
  EventEmitter,
  {
    txUpdate: (txId: string) => void;
    blockUpdate: (blockHash: string) => void;
    microblockUpdate: (microblockHash: string) => void;
    nftEventUpdate: (txId: string, eventIndex: number) => void;
    addressUpdate: (address: string, blockHeight: number) => void;
    nameUpdate: (info: string) => void;
    tokensUpdate: (contractID: string) => void;
    tokenMetadataUpdateQueued: (queueId: number) => void;
    mempoolStatsUpdate: (mempoolStats: DbMempoolStats) => void;
  }
>;

export class PgStoreEventEmitter extends (EventEmitter as { new (): DataStoreEventEmitter }) {}
