import * as supertest from 'supertest';
import { PgSqlClient } from '@hirosystems/api-toolkit';
import { ChainID } from '@stacks/common';
import { ApiServer, startApiServer } from '../api/init';
import { PgWriteStore } from '../datastore/pg-write-store';
import { importEventsFromTsv } from '../event-replay/event-replay';

describe('Signers', () => {
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
      ],
      total: 3,
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
  });
});
