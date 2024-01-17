import { loadDotEnv } from '../helpers';
import { StacksCoreRpcClient } from '../core-rpc/client';
import { PgWriteStore } from '../datastore/pg-write-store';

export interface GlobalServices {
  db: PgWriteStore;
}
// ts-unused-exports:disable-next-line
export default async (): Promise<void> => {
  console.log('Jest - setup..');
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'test';
  }
  loadDotEnv();
  process.env.PG_DATABASE = 'postgres';
  const db = await PgWriteStore.connect({ skipMigrations: true, usageName: 'tests' });
  const globalServices: GlobalServices = {
    db: db,
  };
  Object.assign(global, globalServices);
  console.log('Jest - setup done');
};
