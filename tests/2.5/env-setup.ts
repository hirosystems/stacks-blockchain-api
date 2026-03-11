import { StacksTestnet } from '@stacks/network';
import { ChainID } from '@stacks/transactions';
import { RPCClient } from 'rpc-bitcoin';
import { startApiServer } from '../../src/api/init';
import { StacksCoreRpcClient } from '../../src/core-rpc/client';
import { PgWriteStore } from '../../src/datastore/pg-write-store';
import { TestEnvContext } from '../utils/test-helpers';
import { ENV } from '../../src/env';

let testEnv: TestEnvContext;

beforeAll(async () => {
  console.log('Jest - setup..');
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'test';
  }
  ENV.PG_DATABASE = 'postgres';
  ENV.STACKS_CHAIN_ID = '0x80000000';

  const db = await PgWriteStore.connect({ usageName: 'tests' });
  const api = await startApiServer({ datastore: db, writeDatastore: db, chainId: ChainID.Testnet });
  const client = new StacksCoreRpcClient();
  const stacksNetwork = new StacksTestnet({ url: `http://${client.endpoint}` });

  const bitcoinRpcClient = new RPCClient({
    url: ENV.BTC_RPC_HOST,
    port: ENV.BTC_RPC_PORT,
    user: ENV.BTC_RPC_USER,
    pass: ENV.BTC_RPC_PW ?? '',
    timeout: 120000,
    wallet: 'main',
  });

  testEnv = {
    db,
    api,
    client,
    stacksNetwork,
    bitcoinRpcClient,
  };
  Object.assign(global, { testEnv });

  console.log('Jest - setup done');
});

afterAll(async () => {
  console.log('Jest - teardown..');
  await testEnv.api.forceKill();
  await testEnv.db?.close({ timeout: 0 });
  console.log('Jest - teardown done');
});
