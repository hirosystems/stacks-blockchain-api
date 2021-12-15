import { loadDotEnv } from '../helpers';
import { StacksCoreRpcClient } from '../core-rpc/client';
import { PgDataStore } from '../datastore/postgres-store';

export interface GlobalServices {
  db: PgDataStore;
}

// ts-unused-exports:disable-next-line
export default async (): Promise<void> => {
  console.log('Jest - setup..');
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'test';
  }
  loadDotEnv();
  const db = await PgDataStore.connect(true);
  console.log('Waiting for RPC connection to core node..');
  await new StacksCoreRpcClient().waitForConnection(60000);
  const globalServices: GlobalServices = {
    db: db,
  };
  Object.assign(global, globalServices);
  console.log('Jest - setup done');
};
