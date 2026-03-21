import { ChainID } from '@stacks/transactions';
import { ENV } from '../../src/env';
import { EventStreamServer, startEventServer } from '../../src/event-stream/event-server';
import { migrate } from '../test-helpers';
import { PgWriteStore } from '../../src/datastore/pg-write-store';
import { ApiServer, startApiServer } from '../../src/api/init';
import { StacksCoreRpcClient } from '../../src/core-rpc/client';
import { timeout } from '@stacks/api-toolkit';
import { StacksNetwork, StacksTestnet } from '@stacks/network';
import { RPCClient } from 'rpc-bitcoin';

export interface TestEnvContext {
  db: PgWriteStore;
  eventServer: EventStreamServer;
  api: ApiServer;
  client: StacksCoreRpcClient;
  stacksNetwork: StacksNetwork;
  bitcoinRpcClient: RPCClient;
}

async function standByForPoxToBeReady(client: StacksCoreRpcClient): Promise<void> {
  while (true) {
    try {
      const poxInfo = await client.getPox();
      if (!poxInfo.contract_id.includes('pox-4')) {
        throw new Error(`Unexpected PoX version: ${poxInfo.contract_id}`);
      }
      break;
    } catch (error) {
      console.log(`Waiting on PoX-4 to be ready, retrying after ${error}`);
      await timeout(500);
    }
  }
}

export async function getTestEnv(): Promise<TestEnvContext> {
  ENV.PG_DATABASE = 'postgres';
  ENV.STACKS_CHAIN_ID = '0x80000000';

  await migrate('up');
  const db = await PgWriteStore.connect({ usageName: 'tests' });
  const eventServer = await startEventServer({
    datastore: db,
    chainId: ChainID.Testnet,
  });
  const api = await startApiServer({ datastore: db, writeDatastore: db, chainId: ChainID.Testnet });
  const client = new StacksCoreRpcClient();
  await standByForPoxToBeReady(client);

  const stacksNetwork = new StacksTestnet({ url: `http://${client.endpoint}` });

  const bitcoinRpcClient = new RPCClient({
    url: ENV.BTC_RPC_HOST,
    port: ENV.BTC_RPC_PORT,
    user: ENV.BTC_RPC_USER,
    pass: ENV.BTC_RPC_PW ?? '',
    timeout: 120000,
    wallet: 'main',
  });

  const testEnv: TestEnvContext = {
    db,
    eventServer,
    client,
    stacksNetwork,
    bitcoinRpcClient,
    api,
  };

  return testEnv;
}

export async function stopTestEnv(testEnv: TestEnvContext): Promise<void> {
  await testEnv.api.forceKill();
  await testEnv.eventServer.closeAsync();
  await testEnv.db?.close({ timeout: 0 });
}
