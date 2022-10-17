import { loadDotEnv } from '../helpers';
import { StacksCoreRpcClient } from '../core-rpc/client';
import { PgWriteStore } from '../datastore/pg-write-store';
import { ApiServer, startApiServer } from '../api/init';
import { ChainID } from '@stacks/transactions';
import { StacksNetwork, StacksTestnet } from '@stacks/network';

export interface TestEnvContext {
  db: PgWriteStore;
  api: ApiServer;
  client: StacksCoreRpcClient;
  stacksNetwork: StacksNetwork;
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

  const db = await PgWriteStore.connect({ usageName: 'tests' });
  const api = await startApiServer({ datastore: db, chainId: ChainID.Testnet });
  const client = new StacksCoreRpcClient();
  const stacksNetwork = new StacksTestnet({ url: `http://${client.endpoint}` });

  testEnv = {
    db,
    api,
    client,
    stacksNetwork,
  };
  Object.assign(global, { testEnv });

  console.log('Jest - setup done');
});

afterAll(async () => {
  console.log('Jest - teardown..');
  await testEnv.api.terminate();
  await testEnv.db?.close();
  console.log('Jest - teardown done');
});
