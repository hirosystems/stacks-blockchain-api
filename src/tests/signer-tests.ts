import * as supertest from 'supertest';
import { PgSqlClient } from '@hirosystems/api-toolkit';
import { ChainID } from '@stacks/common';
import { ApiServer, startApiServer } from '../api/init';
import { migrate } from '../test-utils/test-helpers';
import { PgWriteStore } from '../datastore/pg-write-store';
import { importEventsFromTsv } from '../event-replay/event-replay';

describe('Signers', () => {
  let db: PgWriteStore;
  let client: PgSqlClient;
  let api: ApiServer;

  beforeEach(async () => {
    // await migrate('up');
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: true,
      skipMigrations: true,
    });
    client = db.sql;
    api = await startApiServer({ datastore: db, chainId: ChainID.Mainnet });
  });

  afterEach(async () => {
    await api.terminate();
    await db?.close();
    // await migrate('down');
  });

  test('api', async () => {
    await importEventsFromTsv('src/tests/tsv/epoch-3-transition.tsv', 'archival', true, true);
    const signers = await supertest(api.server).get(`/extended/v1/signers/cycle/12`);
    expect(signers.status).toBe(200);
    expect(signers.type).toBe('application/json');
    /*
    /extended/v2/pox/cycles
    /extended/v2/pox/cycles/:number
    /extended/v2/pox/cycles/next
    /extended/v2/pox/cycles/:number/signers
    /extended/v2/pox/cycles/:number/signers/:key/stackers
    /extended/v2/pox/cycles/:number/signers/:key/stackers/:address/delegates     *pools only

    /extended/v2/pox/signers/:key
    /extended/v2/pox/stackers/:address
    */
    expect(JSON.parse(signers.text)).toStrictEqual({
      cycle_number: 12,
      index_block_hash: '0x62d06851fe03f17cb45a488ae70bd8e0c5c308c523f37814ad4df36bd2108713',
      signer_count: 3,
      signers: [
        {
          signing_key: '0x038e3c4529395611be9abf6fa3b6987e81d402385e3d605a073f42f407565a4a3d',
          stacked_amount: '686251350000000000',
          stacked_amount_percent: 50,
          stackers: [
            {
              amount: '686251350000000000',
              pox_addr: '15Z2sAvjgVDpcBh4vx9g2XKU8FVHYcXNaj',
              stacker: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP',
            },
          ],
          weight: 5,
          weight_percent: 55.55555555555556,
        },
        {
          signing_key: '0x029874497a7952483aa23890e9d0898696f33864d3df90939930a1f45421fe3b09',
          stacked_amount: '457500900000000000',
          stacked_amount_percent: 33.333333333333336,
          stackers: [
            {
              amount: '457500900000000000',
              pox_addr: '13niVygM7QGg3rJpFjFdHZyX93N58Du4Gq',
              stacker: 'STF9B75ADQAVXQHNEQ6KGHXTG7JP305J2GRWF3A2',
            },
          ],
          weight: 3,
          weight_percent: 33.33333333333333,
        },
        {
          signing_key: '0x02dcde79b38787b72d8e5e0af81cffa802f0a3c8452d6b46e08859165f49a72736',
          stacked_amount: '228750450000000000',
          stacked_amount_percent: 16.666666666666668,
          stackers: [
            {
              amount: '228750450000000000',
              pox_addr: '18QkiTKcEbKmdFB2c57tKHu19HH2q1beCS',
              stacker: 'ST18MDW2PDTBSCR1ACXYRJP2JX70FWNM6YY2VX4SS',
            },
          ],
          weight: 1,
          weight_percent: 11.11111111111111,
        },
      ],
      total_stacked: '1372502700000000000',
      total_weight: 9,
    });
  });
});
