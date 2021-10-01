import { io } from 'socket.io-client';
import { ChainID } from '@stacks/common';
import { PoolClient } from 'pg';
import { ApiServer, startApiServer } from '../api/init';
import { cycleMigrations, runMigrations, PgDataStore } from '../datastore/postgres-store';
import { DbBlock, DbMicroblockPartial } from 'src/datastore/common';
import { waiter, Waiter } from 'src/helpers';
import { Microblock } from 'docs/generated';

describe('socket-io', () => {
  let apiServer: ApiServer;
  let db: PgDataStore;
  let dbClient: PoolClient;

  beforeEach(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgDataStore.connect();
    dbClient = await db.pool.connect();
    apiServer = await startApiServer({
      datastore: db,
      chainId: ChainID.Testnet,
      httpLogLevel: 'silly',
    });
  });

  test('socket-io > microblock updates', async () => {
    const address = apiServer.address;
    const socket = io(`http://${address}`, { query: { subscriptions: 'microblock' } });

    const block: DbBlock = {
      block_hash: '0x1234',
      index_block_hash: '0xdeadbeef',
      parent_index_block_hash: '0x00',
      parent_block_hash: '0xff0011',
      parent_microblock_hash: '',
      block_height: 1,
      burn_block_time: 94869286,
      burn_block_hash: '0x1234',
      burn_block_height: 123,
      miner_txid: '0x4321',
      canonical: true,
      parent_microblock_sequence: 0,
      execution_cost_read_count: 0,
      execution_cost_read_length: 0,
      execution_cost_runtime: 0,
      execution_cost_write_count: 0,
      execution_cost_write_length: 0,
    };
    const mb1: DbMicroblockPartial = {
      microblock_hash: '0xff01',
      microblock_sequence: 0,
      microblock_parent_hash: block.block_hash,
      parent_index_block_hash: block.index_block_hash,
      parent_burn_block_height: 123,
      parent_burn_block_hash: '0xaa',
      parent_burn_block_time: 1626122935,
    };

    const updateWaiter: Waiter<Microblock> = waiter();
    socket.on('microblock', microblock => {
      updateWaiter.finish(microblock);
    });
    await db.updateMicroblocks({ microblocks: [mb1], txs: [] });

    const result = await updateWaiter;
    expect(result.microblock_hash).toEqual('0xff01');
    socket.emit('unsubscribe', 'microblock');
  });

  afterEach(async () => {
    await apiServer.terminate();
    dbClient.release();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
