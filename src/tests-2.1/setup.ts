import { loadDotEnv, timeout } from '../helpers';
import { StacksCoreRpcClient } from '../core-rpc/client';
import { PgWriteStore } from '../datastore/pg-write-store';
import { cycleMigrations, runMigrations } from '../datastore/migrations';
import { EventStreamServer, startEventServer } from '../event-stream/event-server';
import { ApiServer, startApiServer } from '../api/init';
import { ChainID } from '@stacks/transactions';

export interface TestEnvContext {
  db: PgWriteStore;
  eventServer: EventStreamServer;
  api: ApiServer;
  client: StacksCoreRpcClient;
}

async function standByForPox2ToBeReady(client: StacksCoreRpcClient): Promise<void> {
  let tries = 0;
  while (true) {
    try {
      tries++;
      const poxInfo = await client.getPox();
      if (poxInfo.contract_id.includes('pox-2')) {
        return;
      }
      await timeout(500);
    } catch (error) {
      console.log('Error getting pox info on try ' + tries, error);
      await timeout(500);
    }
  }
}

let testEnv: TestEnvContext;

beforeAll(async () => {
  console.log('Jest - setup..');
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'test';
  }
  loadDotEnv();

  process.env.PG_DATABASE = 'postgres';
  process.env.STACKS_CHAIN_ID = '0x80000000';

  await cycleMigrations();
  const db = await PgWriteStore.connect({ usageName: 'tests' });
  const eventServer = await startEventServer({ datastore: db, chainId: ChainID.Testnet });
  const api = await startApiServer({ datastore: db, chainId: ChainID.Testnet });
  const client = new StacksCoreRpcClient();

  await standByForPox2ToBeReady(client);

  testEnv = {
    db,
    eventServer,
    api,
    client,
  };
  Object.assign(global, { testEnv });

  console.log('Jest - setup done');
});

afterAll(async () => {
  console.log('Jest - teardown..');
  await new Promise<void>(resolve => testEnv.eventServer.close(() => resolve()));
  await testEnv.api.terminate();
  await testEnv.db?.close();
  await runMigrations(undefined, 'down');
  console.log('Jest - teardown done');
});
