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
    process.env.IBD_MODE_UNTIL_BLOCK = '100';
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

  test('IBD mode blocks certain API routes', async () => {
    const newMemPoolTxPath = '/new_mempool_tx';
    const dropMemPoolTxPath = '/drop_mempool_tx';
    const newBurnBlockPath = '/new_burn_block';

    const newMemPoolTxPost = await supertest(api.server).post(newMemPoolTxPath).send(undefined);
    expect(newMemPoolTxPost.body).toBe(
      `${newMemPoolTxPath} is not available while IBM mode is active`
    );
    const dropMemPoolTxPost = await supertest(api.server).post(dropMemPoolTxPath).send(undefined);
    expect(dropMemPoolTxPost.body).toBe(
      `${dropMemPoolTxPath} is not available while IBM mode is active`
    );
    const newBurnBlockPost = await supertest(api.server).post(newBurnBlockPath).send(undefined);
    expect(newBurnBlockPost.body).toBe(
      `${newBurnBlockPath} is not available while IBM mode is active`
    );
  });

  test('IBM prevents refreshing materialized views', () => {
    expect(db.refreshMaterializedView('fizzbuzz', client)).toBe(undefined);
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
