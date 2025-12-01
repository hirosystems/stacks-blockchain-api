import { importV1TokenOfferingData } from '../../src/import-v1';
import { bitcoinToStacksAddress } from '@hirosystems/stacks-encoding-native-js';
import { PgWriteStore } from '../../src/datastore/pg-write-store';
import { migrate } from '../utils/test-helpers';

describe('import genesis data tests', () => {
  let db: PgWriteStore;

  beforeEach(async () => {
    await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
  });

  afterEach(async () => {
    await db?.close();
    await migrate('down');
  });

  test('import token offering data', async () => {
    const initialDbConfigState = await db.getConfigState();
    expect(initialDbConfigState.token_offering_imported).toBe(false);
    await importV1TokenOfferingData(db);
    const newDbConfigState = await db.getConfigState();
    expect(newDbConfigState.token_offering_imported).toBe(true);

    const addr1 = 'SP04MFJ3RWTADV6ZWTWD68DBZ14EJSDXT50Q7TE6';
    const res1 = await db.getTokenOfferingLocked(addr1, 0);
    expect(res1?.result?.total_locked).toEqual('33115155552');

    const addr2 = 'SM2M7XTPCJK6S5XG7JKH4SGYDY9W49ZQ962MC4XPM';
    const res2 = await db.getTokenOfferingLocked(addr2, 0);
    expect(res2?.result?.total_locked).toEqual('111111111108');

    const addr3 = 'SM37EFPD9ZVR3YRJE7673MJ3W0T350JM1HVZVCDC3';
    const res3 = await db.getTokenOfferingLocked(addr3, 0);
    expect(res3?.result?.total_locked).toEqual('111111109');

    const addr4 = 'SM260QHD6ZM2KKPBKZB8PFE5XWP0MHSKTD1B7BHYR';
    const res4 = await db.getTokenOfferingLocked(addr4, 0);
    expect(res4?.result?.total_locked).toEqual('1666666664');
  });
});

describe('fast b58 to c32 address conversion', () => {
  test('b58 to c32 address', () => {
    const addrs = [
      ['112XwWYtXmVGhwKPZAijeDDxeiQzAhvyDi', 'SP04MFJ3RWTADV6ZWTWD68DBZ14EJSDXT50Q7TE6'],
      ['1zGLA1arpjhhrXeH8QYFXW5eJX1vARGwB', 'SP5D90E31EM8BCXSYBPFDASDFM5TGHFT4SS6B0QB'],
      ['31hq3ykKrVrhExuCFbhDoARMo33gEsoVaw', 'SM02ENSM1ZD4EKE6D3AB0JXTJMH7N4DPK733G27X'],
      ['3QuovALTyVTTvR1tBB1hrHLfAQrA61hPsZ', 'SM3ZBCHS6W603C6QJJPQFVC49QE9VQ1ZVFQY1DZX7'],
    ];
    addrs.forEach(([b58, c32]) => {
      const converted = bitcoinToStacksAddress(b58);
      expect(converted).toEqual(c32);
    });
  });
});
