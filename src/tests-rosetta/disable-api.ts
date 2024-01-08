import * as supertest from 'supertest';
import { PgSqlClient } from "@hirosystems/api-toolkit";
import { ChainID } from "@stacks/common";
import { ApiServer, startApiServer } from "../api/init";
import { PgWriteStore } from "../datastore/pg-write-store";
import { migrate } from "../test-utils/test-helpers";

describe('Rosetta API toggle', () => {
  let db: PgWriteStore;
  let client: PgSqlClient;
  let api: ApiServer;

  beforeEach(async () => {
    process.env.STACKS_CHAIN_ID = '0x80000000';
    await migrate('up');
    db = await PgWriteStore.connect({ usageName: 'tests' });
    client = db.sql;
    process.env.STACKS_API_ENABLE_ROSETTA = '0';
    api = await startApiServer({ datastore: db, chainId: ChainID.Testnet });
  });

  test('rosetta is disabled', async () => {
    const query1 = await supertest(api.server).post(`/rosetta/v1/network/list`);
    expect(query1.status).toBe(404);
  });

  afterEach(async () => {
    await api.terminate();
    process.env.STACKS_API_ENABLE_ROSETTA = '1';
    await db?.close();
    await migrate('down');
  });
});
