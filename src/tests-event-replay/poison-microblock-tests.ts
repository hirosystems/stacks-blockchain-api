import { ChainID } from '@stacks/transactions';
import * as fs from 'fs';
import { getBnsGenesisBlockFromBlockMessage, getGenesisBlockData } from '../event-replay/helpers';
import { PgSqlClient } from '../datastore/connection';
import { getPgClientConfig } from '../datastore/connection-legacy';
import { databaseHasData, getRawEventRequests } from '../datastore/event-requests';
import { cycleMigrations, dangerousDropAllTables, runMigrations } from '../datastore/migrations';
import { PgWriteStore } from '../datastore/pg-write-store';
import { exportEventsAsTsv, importEventsFromTsv } from '../event-replay/event-replay';
import { IBD_PRUNABLE_ROUTES, startEventServer } from '../event-stream/event-server';
import { getIbdBlockHeight, httpPostRequest } from '../helpers';
import { useWithCleanup } from '../tests/test-helpers';

describe('poison microblock for height 80743', () => {
  let db: PgWriteStore;

  beforeEach(async () => {
    process.env.PG_DATABASE = 'postgres';
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
  });

  afterEach(async () => {
    await db?.close();
  });

  test('test that it does not give 500 error', async () => {
    await importEventsFromTsv(
      'src/tests-event-replay/tsv/poisonmicroblock.tsv',
      'archival',
      true,
      true
    );
    const chainTip = await db.getUnanchoredChainTip();
    expect(chainTip.found).toBe(true);
    expect(chainTip.result?.blockHeight).toBe(1);
    expect(chainTip.result?.indexBlockHash).toBe(
      '0x05ca75b9949195da435e6e36d731dbaa10bb75fda576a52263e25164990bfdaa'
    );
    expect(chainTip.result?.blockHash).toBe(
      '0x6b83b44571365e6e530d679536578c71d6c376b07666f3671786b6fd8fac049c'
    );
  });
});
