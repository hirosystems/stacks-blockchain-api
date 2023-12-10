import { loadDotEnv } from '../helpers';
import { StacksCoreRpcClient } from '../core-rpc/client';
import { PgWriteStore } from '../datastore/pg-write-store';
import { EventStreamServer, startEventServer } from '../event-stream/event-server';
import { ChainID } from '@stacks/transactions';
import { migrate } from '../test-utils/test-helpers';
import { timeout } from '@hirosystems/api-toolkit';

export interface GlobalTestEnv {
  db: PgWriteStore;
  eventServer: EventStreamServer;
}

async function standByForPox4ToBeReady(client: StacksCoreRpcClient): Promise<void> {
  let tries = 0;
  while (true) {
    try {
      tries++;
      const poxInfo = await client.getPox();
      if (poxInfo.contract_id.includes('pox-4')) {
        console.log(`PoX-4 ready.`);
        return;
      }
      console.log(`Waiting on PoX-4 to be ready`);
      await timeout(500);
    } catch (error) {
      console.log(`Waiting on PoX-4 to be ready, retrying after ${error}`);
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

  await migrate('up');
  const db = await PgWriteStore.connect({ usageName: 'tests' });
  const eventServer = await startEventServer({ datastore: db, chainId: ChainID.Testnet });

  const client = new StacksCoreRpcClient();
  await standByForPox4ToBeReady(client);

  const testEnv: GlobalTestEnv = {
    db: db,
    eventServer: eventServer,
  };
  Object.assign(global, { globalTestEnv: testEnv });

  console.log('Jest - global setup done');
};
