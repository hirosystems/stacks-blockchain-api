import { loadDotEnv, timeout } from '../helpers';
import { StacksCoreRpcClient } from '../core-rpc/client';
import { PgWriteStore } from '../datastore/pg-write-store';
import { cycleMigrations, runMigrations } from '../datastore/migrations';
import { EventStreamServer, startEventServer } from '../event-stream/event-server';
import { ApiServer, startApiServer } from '../api/init';
import { ChainID } from '@stacks/transactions';
import { StacksNetwork, StacksTestnet } from '@stacks/network';

export interface GlobalTestEnv {
  db: PgWriteStore;
  eventServer: EventStreamServer;
}

async function standByForPoxToBeReady(client: StacksCoreRpcClient): Promise<void> {
  let tries = 0;
  while (true) {
    try {
      tries++;
      await client.getPox();
      return;
    } catch (error) {
      console.log(`Waiting on /v2/pox endpoint to be ready, retrying after ${error}`);
      await timeout(500);
    }
  }
}

// ts-unused-exports:disable-next-line
export default async (): Promise<void> => {
  console.log('Jest - global setup..');
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'test';
  }
  loadDotEnv();
  process.env.PG_DATABASE = 'postgres';
  process.env.STACKS_CHAIN_ID = '0x80000000';

  await cycleMigrations();
  const db = await PgWriteStore.connect({ usageName: 'tests' });
  const eventServer = await startEventServer({ datastore: db, chainId: ChainID.Testnet });

  const client = new StacksCoreRpcClient();
  await standByForPoxToBeReady(client);

  const testEnv: GlobalTestEnv = {
    db: db,
    eventServer: eventServer,
  };
  Object.assign(global, { globalTestEnv: testEnv });

  console.log('Jest - global setup done');
};
