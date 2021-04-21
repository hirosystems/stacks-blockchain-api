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

    const addr1 = 'SP04MFJ3RWTADV6ZWTWD68DBZ14EJSDXT50Q7TE6';
    const res1 = await db.getTokenOfferingLocked(addr1);
    expect(res1?.result?.total_locked).toEqual('33115155552');

    const addr2 = 'SM2M7XTPCJK6S5XG7JKH4SGYDY9W49ZQ962MC4XPM';
    const res2 = await db.getTokenOfferingLocked(addr2);
    expect(res2?.result?.total_locked).toEqual('111111111108');

    const addr3 = 'SM37EFPD9ZVR3YRJE7673MJ3W0T350JM1HVZVCDC3';
    const res3 = await db.getTokenOfferingLocked(addr3);
    expect(res3?.result?.total_locked).toEqual('111111109');

    const addr4 = 'SM260QHD6ZM2KKPBKZB8PFE5XWP0MHSKTD1B7BHYR';
    const res4 = await db.getTokenOfferingLocked(addr4);
    expect(res4?.result?.total_locked).toEqual('1666666664');
  });

  afterEach(async () => {
    await db?.close();
    await runMigrations(undefined, 'down');
  });
});
