import { logger } from '../../logger';
import { PgWriteStore } from '../../datastore/pg-write-store';

const MIGRATIONS_TABLE = 'pgmigrations';

(async () => {
  const db = await PgWriteStore.connect({
    usageName: 'post-event-replay',
    skipMigrations: true,
    withNotifier: false,
    isEventReplay: true,
  });

  // Re-enable indexes
  const dbName = db.sql.options.database;
  const tableSchema = db.sql.options.connection.search_path ?? 'public';
  const tablesQuery = await db.sql<{ tablename: string }[]>`
    SELECT tablename FROM pg_catalog.pg_tables
    WHERE tablename != ${MIGRATIONS_TABLE}
    AND schemaname = ${tableSchema}`;
  if (tablesQuery.length === 0) {
    const errorMsg = `No tables found in database '${dbName}', schema '${tableSchema}'`;
    console.error(errorMsg);
    throw new Error(errorMsg);
  }
  const tables: string[] = tablesQuery.map((r: { tablename: string }) => r.tablename);

  logger.info({ component: 'event-replay' }, 'Re-enabling indexes and constraints on tables');
  await db.toggleTableIndexes(db.sql, tables, true);
  logger.info({ component: 'event-replay' }, `Indexes re-enabled on tables: ${tables.join(', ')}`);

  // Refreshing materialized views
  logger.info({ component: 'event-replay' }, `Refreshing materialized views`);
  await db.finishEventReplay();
})().catch(err => {
  throw err;
});
