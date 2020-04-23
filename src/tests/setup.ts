import { loadDotEnv } from '../helpers';
import { MemoryDataStore } from '../datastore/memory-store';
import { startEventSocketServer } from '../event-stream/socket-server';
import { StacksCoreRpcClient } from '../core-rpc/client';

export default async (): Promise<void> => {
  console.log('Jest - setup..');
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'test';
  }
  loadDotEnv();
  const server = await startEventSocketServer(new MemoryDataStore(), () => {});
  Object.assign(global, { server: server });
  console.log('Waiting for RPC connection to core node..');
  await new StacksCoreRpcClient().waitForConnection(60000);
  console.log('Jest - setup done');
};
