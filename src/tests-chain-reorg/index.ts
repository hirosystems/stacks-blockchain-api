import { ChainID } from '@stacks/transactions';
import { bnsNameCV, httpPostRequest } from '../helpers';
import { EventStreamServer, startEventServer } from '../event-stream/event-server';
import { TestBlockBuilder, TestMicroblockStreamBuilder } from '../test-utils/test-builders';
import { DbAssetEventTypeId, DbBnsZoneFile } from '../datastore/common';
import { PgWriteStore } from '../datastore/pg-write-store';
import { cycleMigrations, runMigrations } from '../datastore/migrations';
import { PgSqlClient } from '../datastore/connection';

describe('Chain Re-org', () => {
  let db: PgWriteStore;
  let client: PgSqlClient;
  let eventServer: EventStreamServer;

  beforeEach(async () => {
    process.env.PG_DATABASE = 'postgres';
    await cycleMigrations();
    db = await PgWriteStore.connect({ usageName: 'tests', withNotifier: false });
    client = db.sql;
    eventServer = await startEventServer({
      datastore: db,
      chainId: ChainID.Mainnet,
      serverHost: '127.0.0.1',
      serverPort: 0,
      httpLogLevel: 'debug',
    });
  });

  test("Txs in a block that gets re-org'ed that aren't also in the mempool get inserted into the mempool table", () => {
    // I need a block that gets reorged
    // This block has to have transactions in it that aren't in the mempool





  });
});
