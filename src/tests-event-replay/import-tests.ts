import { importEventsFromTsv } from '../event-replay/event-replay';
import { cycleMigrations, runMigrations } from '../datastore/migrations';
import { PgWriteStore } from '../datastore/pg-write-store';

describe('import/export tests', () => {
  let db: PgWriteStore;

  beforeEach(async () => {
    process.env.PG_DATABASE = 'postgres';
    // await cycleMigrations();
    db = await PgWriteStore.connect({
      usageName: 'tests',
      withNotifier: false,
      skipMigrations: true,
    });
  });

  test('event import and export', async () => {
    await importEventsFromTsv(
      'src/tests-event-replay/tsv/first-3-blocks.tsv',
      'archival',
      true,
      true
    );
    const chainTip = await db.getUnanchoredChainTip();
    expect(chainTip.found).toBe(true);
    expect(chainTip.result?.blockHeight).toBe(3);
  });

  afterEach(async () => {
    await db?.close();
    // await runMigrations(undefined, 'down');
  });
});
