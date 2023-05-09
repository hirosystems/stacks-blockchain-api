import { loadDotEnv } from '../helpers';
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
  const db = await PgWriteStore.connect({ skipMigrations: true, usageName: 'tests' });
  const globalServices: GlobalServices = {
    db: db,
  };
  Object.assign(global, globalServices);
  console.log('Jest - setup done');
};
