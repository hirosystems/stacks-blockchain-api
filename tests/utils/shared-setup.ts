import { StacksCoreRpcClient } from '../../src/core-rpc/client';
import { loadDotEnv } from '../../src/helpers';
import { PgWriteStore } from '../../src/datastore/pg-write-store';
import {
  DummyEventMessageHandler,
  EventStreamServer,
  startEventServer,
} from '../../src/event-stream/event-server';
import { ChainID } from '@stacks/common';
import * as isCI from 'is-ci';
import { migrate } from './test-helpers';
import { timeout } from '@hirosystems/api-toolkit';

interface GlobalTestEnv {
  db: PgWriteStore;
  eventServer: EventStreamServer;
}

async function standByForPoxToBeReady(client: StacksCoreRpcClient): Promise<void> {
  let tries = 0;
  while (true) {
    try {
      tries++;
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

export async function defaultSetupInit(
  args: { dummyEventHandler: boolean } = { dummyEventHandler: false }
) {
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'test';
  }
  loadDotEnv();
  process.env.PG_DATABASE = 'postgres';
  process.env.STACKS_CHAIN_ID = '0x80000000';

  await migrate('up');
  const db = await PgWriteStore.connect({ usageName: 'tests' });
  const eventServer = await startEventServer({
    datastore: db,
    chainId: ChainID.Testnet,
    messageHandler: args?.dummyEventHandler ? DummyEventMessageHandler : undefined,
  });

  const client = new StacksCoreRpcClient();
  await standByForPoxToBeReady(client);

  const testEnv: GlobalTestEnv = {
    db: db,
    eventServer: eventServer,
  };
  Object.assign(global, { globalTestEnv: testEnv });
}

export async function defaultSetupTeardown() {
  const testEnv: GlobalTestEnv = (global as any).globalTestEnv;
  await testEnv.eventServer.closeAsync();
  await testEnv.db.close();
  await migrate('down');

  // If running in CI setup the "why am I still running?" log to detect stuck Jest tests
  if (isCI) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const whyIsNodeRunning = require('why-is-node-running');
    let whyRunInterval = 1000;
    setInterval(() => {
      console.log('\n\n\n\n_____WHY IS NODE RUNNING_____');
      whyIsNodeRunning();
    }, (whyRunInterval *= 2)).unref();
  }
}
