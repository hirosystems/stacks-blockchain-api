import * as tty from 'tty';

import { PgWriteStore } from '../../datastore/pg-write-store';
import { cycleMigrations, dangerousDropAllTables } from '../../datastore/migrations';
import { logger } from '../../logger';
import { createTimeTracker } from './helpers';
import { insertNewBurnBlockEvents } from './importers/new_burn_block_importer';
import { insertNewBlockEvents } from './importers/new_block_importer';
import { DatasetStore } from './dataset/store';

const MIGRATIONS_TABLE = 'pgmigrations';

const run = async (wipeDB: boolean = false, disableIndexes: boolean = false) => {
  const timeTracker = createTimeTracker();

  const db = await PgWriteStore.connect({
    usageName: 'import-events',
    skipMigrations: true,
    withNotifier: false,
    isEventReplay: true,
  });

  const dataset = await DatasetStore.connect();

  if (wipeDB) {
    await dangerousDropAllTables({ acknowledgePotentialCatastrophicConsequences: 'yes' });
  }

  try {
    await cycleMigrations({ dangerousAllowDataLoss: true, checkForEmptyData: true });
  } catch (error) {
    logger.error(error);
    throw new Error(
      `DB migration cycle failed, possibly due to an incompatible API version upgrade. Add --wipe-db --force or perform a manual DB wipe before importing.`
    );
  }

  let tables: string[] = [];
  if (disableIndexes) {
    // Get DB tables
    const dbName = db.sql.options.database; // stacks-blockchain-api
    const tableSchema = db.sql.options.connection.search_path ?? 'public';
    const tablesQuery = await db.sql<{ tablename: string }[]>`
      SELECT tablename FROM pg_catalog.pg_tables
      WHERE tablename != ${MIGRATIONS_TABLE}
      AND schemaname = ${tableSchema}`;
    if (tablesQuery.length === 0) {
      const errorMsg = `No tables found in database '${dbName}', schema '${tableSchema}'`;
      logger.error(errorMsg);
      throw new Error(errorMsg);
    }
    tables = tablesQuery.map(r => r.tablename);

    // Disable indexing and constraints on tables to speed up insertion
    logger.info(`Disable indexes on tables: ${tables.join(', ')}`);
    db.toggleTableIndexes(db.sql, tables, false);
  }

  try {
    await Promise.all([
      insertNewBurnBlockEvents(db, dataset, timeTracker),
      insertNewBlockEvents(db, dataset, timeTracker)
    ]);
  } catch (err) {
    throw err;
  } finally {
    if (disableIndexes) {
      logger.info(`Enable indexes on tables: ${tables.join(', ')}`);
      db.toggleTableIndexes(db.sql, tables, true);
    }

    if (true || tty.isatty(1)) {
      console.log('Tracked function times:');
      console.table(timeTracker.getDurations(3));
    } else {
      logger.info(`Tracked function times`, timeTracker.getDurations(3));
    }
  }
}

export { run };
