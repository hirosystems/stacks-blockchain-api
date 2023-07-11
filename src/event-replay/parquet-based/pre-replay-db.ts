import { logger } from '../../logger';
import { cycleMigrations, dangerousDropAllTables } from '../../datastore/migrations';
import { PgWriteStore } from '../../datastore/pg-write-store';

const MIGRATIONS_TABLE = 'pgmigrations';

(async () => {
  const db = await PgWriteStore.connect({
    usageName: 'pre-event-replay',
    skipMigrations: true,
    withNotifier: false,
    isEventReplay: true,
  });

  logger.info({ component: 'event-replay' }, 'Cleaning up the Database');
  await dangerousDropAllTables({ acknowledgePotentialCatastrophicConsequences: 'yes' });

  logger.info({ component: 'event-replay' }, 'Migrating tables');
  try {
    await cycleMigrations({ dangerousAllowDataLoss: true, checkForEmptyData: true });
  } catch (error) {
    logger.error(error);
    throw new Error('DB migration cycle failed');
  }

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

  logger.info(
    { component: 'event-replay' },
    'Disabling indexes and constraints to speed up insertion'
  );
  await db.toggleTableIndexes(db.sql, tables, false);
  logger.info({ component: 'event-replay' }, `Indexes disabled on tables: ${tables.join(', ')}`);
})().catch(err => {
  throw err;
});
