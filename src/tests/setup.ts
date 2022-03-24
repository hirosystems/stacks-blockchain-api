import { loadDotEnv } from '../helpers';
import { StacksCoreRpcClient } from '../core-rpc/client';

// ts-unused-exports:disable-next-line
export default async (): Promise<void> => {
  console.log('Jest - setup..');
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'test';
  }
  loadDotEnv();
  process.env.PG_DATABASE = 'postgres';
  console.log('Waiting for RPC connection to core node..');
  await new StacksCoreRpcClient().waitForConnection(60000);
  console.log('Jest - setup done');
};
