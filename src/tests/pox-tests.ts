import * as supertest from 'supertest';
import { PgSqlClient } from '@hirosystems/api-toolkit';
import { ChainID } from '@stacks/common';
import { ApiServer, startApiServer } from '../api/init';
import { PgWriteStore } from '../datastore/pg-write-store';
import { importEventsFromTsv } from '../event-replay/event-replay';

describe('PoX tests', () => {
  let db: PgWriteStore;
  let client: PgSqlClient;
  let api: ApiServer;

  beforeEach(async () => {
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
  });

  test('api', async () => {
    await importEventsFromTsv('src/tests/tsv/epoch-3-transition.tsv', 'archival', true, true);
    const cycles = await supertest(api.server).get(`/extended/v2/pox/cycles`);
    expect(cycles.status).toBe(200);
    expect(cycles.type).toBe('application/json');
    expect(JSON.parse(cycles.text)).toStrictEqual({
      limit: 20,
      offset: 0,
      results: [
        {
          block_height: 50,
          cycle_number: 14,
          index_block_hash: '0xf5be33abc4e508bdaf2191e88339372edcb3358c44e2a31e1b9b44f2880dde09',
          total_signers: 3,
          total_stacked_amount: '1372502700000000000',
          total_weight: 9,
        },
        {
          block_height: 22,
          cycle_number: 13,
          index_block_hash: '0x5077c7d971dd83cd3ba19dca579e3cc8dcf17913186b66093c94520e50d3b7b2',
          total_signers: 3,
          total_stacked_amount: '1372502700000000000',
          total_weight: 9,
        },
        {
          block_height: 13,
          cycle_number: 12,
          index_block_hash: '0x62d06851fe03f17cb45a488ae70bd8e0c5c308c523f37814ad4df36bd2108713',
          total_signers: 3,
          total_stacked_amount: '1372502700000000000',
          total_weight: 9,
        },
        {
          block_height: 6,
          cycle_number: 11,
          index_block_hash: '0xe1fb9b3beaa302392d183151d3e5394f86eb64c3d46616b8ec18f5ebe734c4cb',
          total_signers: 0,
          total_stacked_amount: '0',
          total_weight: 0,
        },
      ],
      total: 4,
    });
    const cycle = await supertest(api.server).get(`/extended/v2/pox/cycles/14`);
    expect(cycle.status).toBe(200);
    expect(cycle.type).toBe('application/json');
    expect(JSON.parse(cycle.text)).toStrictEqual({
      block_height: 50,
      cycle_number: 14,
      index_block_hash: '0xf5be33abc4e508bdaf2191e88339372edcb3358c44e2a31e1b9b44f2880dde09',
      total_signers: 3,
      total_stacked_amount: '1372502700000000000',
      total_weight: 9,
    });
    const signers = await supertest(api.server).get(`/extended/v2/pox/cycles/14/signers`);
    expect(signers.status).toBe(200);
    expect(signers.type).toBe('application/json');
    expect(JSON.parse(signers.text)).toStrictEqual({
      limit: 100,
      offset: 0,
      results: [
        {
          signing_key: '0x038e3c4529395611be9abf6fa3b6987e81d402385e3d605a073f42f407565a4a3d',
          stacked_amount: '686251350000000000',
          stacked_amount_percent: 50,
          weight: 5,
          weight_percent: 55.55555555555556,
        },
        {
          signing_key: '0x029874497a7952483aa23890e9d0898696f33864d3df90939930a1f45421fe3b09',
          stacked_amount: '457500900000000000',
          stacked_amount_percent: 33.333333333333336,
          weight: 3,
          weight_percent: 33.33333333333333,
        },
        {
          signing_key: '0x02dcde79b38787b72d8e5e0af81cffa802f0a3c8452d6b46e08859165f49a72736',
          stacked_amount: '228750450000000000',
          stacked_amount_percent: 16.666666666666668,
          weight: 1,
          weight_percent: 11.11111111111111,
        },
      ],
      total: 3,
    });
    const signer = await supertest(api.server).get(
      `/extended/v2/pox/cycles/14/signers/0x038e3c4529395611be9abf6fa3b6987e81d402385e3d605a073f42f407565a4a3d`
    );
    expect(signer.status).toBe(200);
    expect(signer.type).toBe('application/json');
    expect(JSON.parse(signer.text)).toStrictEqual({
      signing_key: '0x029874497a7952483aa23890e9d0898696f33864d3df90939930a1f45421fe3b09',
      stacked_amount: '457500900000000000',
      stacked_amount_percent: 33.333333333333336,
      weight: 3,
      weight_percent: 33.33333333333333,
    });
    const stackers = await supertest(api.server).get(
      `/extended/v2/pox/cycles/14/signers/0x038e3c4529395611be9abf6fa3b6987e81d402385e3d605a073f42f407565a4a3d/stackers`
    );
    expect(stackers.status).toBe(200);
    expect(stackers.type).toBe('application/json');
    expect(JSON.parse(stackers.text)).toStrictEqual({
      limit: 100,
      offset: 0,
      results: [
        {
          pox_address: '15Z2sAvjgVDpcBh4vx9g2XKU8FVHYcXNaj',
          stacked_amount: '686251350000000000',
          stacker_address: 'STRYYQQ9M8KAF4NS7WNZQYY59X93XEKR31JP64CP',
        },
      ],
      total: 1,
    });
  });
});
