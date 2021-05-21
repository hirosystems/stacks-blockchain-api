import { loadDotEnv } from '../helpers';
import { StacksCoreRpcClient } from '../core-rpc/client';
import { PgDataStore } from '../datastore/postgres-store';

export interface GlobalServices {
  db: PgDataStore;
}

export default async (): Promise<void> => {
  console.log('Jest - setup..');
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'test';
  }
  loadDotEnv();
  console.log('Waiting for postgres connection..');
  const db = await PgDataStore.connect(true);
  const globalServices: GlobalServices = {
    db: db,
  };
  Object.assign(global, globalServices);
  console.log('Jest - setup done');
};
