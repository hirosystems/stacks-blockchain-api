import { EventEmitter } from 'events';
import StrictEventEmitter from 'strict-event-emitter-types';
import { DbConfigState, DbMempoolStats } from './common';

type DataStoreEventEmitter = StrictEventEmitter<
  EventEmitter,
  {
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
>;

export class PgStoreEventEmitter extends (EventEmitter as { new (): DataStoreEventEmitter }) {}
