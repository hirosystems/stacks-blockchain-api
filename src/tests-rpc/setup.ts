import { cycleMigrations } from '../datastore/migrations';
import { StacksCoreRpcClient } from '../core-rpc/client';
import { loadDotEnv, timeout } from '../helpers';
import { PgWriteStore } from '../datastore/pg-write-store';
import { EventStreamServer, startEventServer } from '../event-stream/event-server';
import { ChainID } from '@stacks/common';

export interface GlobalTestEnv {
  db: PgWriteStore;
  eventServer: EventStreamServer;
}

async function standByForPoxToBeReady(client: StacksCoreRpcClient): Promise<void> {
  let tries = 0;
  while (true) {
    try {
      tries++;
      const poxInfo = await client.getPox();
      if (!poxInfo.contract_id.includes('pox-3')) {
        throw new Error(`Unexpected PoX version: ${poxInfo.contract_id}`);
      }
      break;
    } catch (error) {
      console.log(`Waiting on PoX-3 to be ready, retrying after ${error}`);
      await timeout(500);
    }
  }
}

// ts-unused-exports:disable-next-line
export default async () => {
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

  const client = new StacksCoreRpcClient();
  await standByForPoxToBeReady(client);

  const testEnv: GlobalTestEnv = {
    db: db,
    eventServer: eventServer,
  };
  Object.assign(global, { globalTestEnv: testEnv });

  console.log('Jest - setup done');
};
