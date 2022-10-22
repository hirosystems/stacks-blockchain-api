import * as supertest from 'supertest';
import { ChainID } from '@stacks/transactions';
import { startApiServer, ApiServer } from '../api/init';
import { PgWriteStore } from '../datastore/pg-write-store';
import { cycleMigrations, runMigrations } from '../datastore/migrations';
import { PgSqlClient } from '../datastore/connection';

describe('event_observer_requests', () => {
  let db: PgWriteStore;
  let client: PgSqlClient;
  let api: ApiServer;

  beforeEach(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
    client = db.sql;
    api = await startApiServer({ datastore: db, chainId: ChainID.Testnet, httpLogLevel: 'silly' });
  });

  test('If there is an event request error, then the event will not be recorded in the events_observer_request table', async () => {
    // const request1: CoreNodeBlockMessage = {
    //   block_hash: string;
    //   block_height: number;
    //   burn_block_time: number;
    //   burn_block_hash: string;
    //   burn_block_height: number;
    //   miner_txid: string;
    //   index_block_hash: string;
    //   parent_index_block_hash: string;
    //   parent_block_hash: string;
    //   parent_microblock: string;
    //   parent_microblock_sequence: number;
    //   parent_burn_block_hash: string;
    //   parent_burn_block_height: number;
    //   parent_burn_block_timestamp: number;
    //   events: CoreNodeEvent[];
    //   transactions: CoreNodeTxMessage[];
    //   matured_miner_rewards: {
    //     from_index_consensus_hash: string,
    //     from_stacks_block_hash: string,
    //     /** STX principal */
    //     recipient: string,
    //     /** String quoted micro-STX amount. */
    //     coinbase_amount: string;
    //     /** String quoted micro-STX amount. */
    //     tx_fees_anchored: string;
    //     /** String quoted micro-STX amount. */
    //     tx_fees_streamed_confirmed: string;
    //     /** String quoted micro-STX amount. */
    //     tx_fees_streamed_produced: string;
    //   }[];
    // };
    const rawEventRequestCountBefore = db.getRawEventCount();
    const post = await supertest(api.server).post('/new_block').send(undefined);
    expect(post.status).toBe(500);
    const rawEventRequestCountAfter = db.getRawEventCount();
    expect(rawEventRequestCountBefore).toEqual(rawEventRequestCountAfter);
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
