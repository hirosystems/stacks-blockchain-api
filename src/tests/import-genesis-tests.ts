import { importV1TokenOfferingData } from '../import-v1';
import { cycleMigrations, PgDataStore, runMigrations } from '../datastore/postgres-store';

describe('import genesis data tests', () => {
  let db: PgDataStore;

  beforeEach(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgDataStore.connect();
  });

  test('import token offering data', async () => {
    const initialDbConfigState = await db.getConfigState();
    expect(initialDbConfigState.token_offering_imported).toBe(false);
    await importV1TokenOfferingData(db);
    const newDbConfigState = await db.getConfigState();
    expect(newDbConfigState.token_offering_imported).toBe(true);
  });

  afterEach(async () => {
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
