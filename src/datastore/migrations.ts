import * as path from 'path';
import PgMigrate, { RunnerOption } from 'node-pg-migrate';
import { Client } from 'pg';
import { APP_DIR, isDevEnv, isTestEnv, REPO_DIR } from '../helpers';
import { getPgClientConfig, PgClientConfig } from './connection-legacy';
import { connectPostgres, PgServer } from './connection';
import { databaseHasData } from './event-requests';
import { logger } from '../logger';

const MIGRATIONS_TABLE = 'pgmigrations';
const MIGRATIONS_DIR = path.join(REPO_DIR, 'migrations');

export async function runMigrations(
  clientConfig: PgClientConfig = getPgClientConfig({ usageName: 'schema-migrations' }),
  direction: 'up' | 'down' = 'up',
  opts?: {
    // Bypass the NODE_ENV check when performing a "down" migration which irreversibly drops data.
    dangerousAllowDataLoss?: boolean;
  }
): Promise<void> {
  if (!opts?.dangerousAllowDataLoss && direction !== 'up' && !isTestEnv && !isDevEnv) {
    throw new Error(
      'Whoa there! This is a testing function that will drop all data from PG. ' +
        'Set NODE_ENV to "test" or "development" to enable migration testing.'
    );
  }
  const client = new Client(clientConfig);
  try {
    await client.connect();
    const runnerOpts: RunnerOption = {
      dbClient: client,
      ignorePattern: '.*map',
      dir: MIGRATIONS_DIR,
      direction: direction,
      migrationsTable: MIGRATIONS_TABLE,
      count: Infinity,
      logger: {
        info: msg => {},
        warn: msg => logger.warn(msg),
        error: msg => logger.error(msg),
      },
    };
    if (clientConfig.schema) {
      runnerOpts.schema = clientConfig.schema;
    }
    await PgMigrate(runnerOpts);
  } catch (error) {
    logger.error(error, 'Error running pg-migrate');
    throw error;
  } finally {
    await client.end();
  }
}

export async function cycleMigrations(opts?: {
  // Bypass the NODE_ENV check when performing a "down" migration which irreversibly drops data.
  dangerousAllowDataLoss?: boolean;
  checkForEmptyData?: boolean;
}): Promise<void> {
  const clientConfig = getPgClientConfig({ usageName: 'cycle-migrations' });

  await runMigrations(clientConfig, 'down', opts);
  if (opts?.checkForEmptyData && (await databaseHasData({ ignoreMigrationTables: true }))) {
    throw new Error('Migration down process did not completely remove DB tables');
  }
  await runMigrations(clientConfig, 'up', opts);
}

export async function dangerousDropAllTables(opts?: {
  acknowledgePotentialCatastrophicConsequences?: 'yes';
}) {
  if (opts?.acknowledgePotentialCatastrophicConsequences !== 'yes') {
    throw new Error('Dangerous usage error.');
  }
  const sql = await connectPostgres({
    usageName: 'dangerous-drop-all-tables',
    pgServer: PgServer.primary,
  });
  const schema = sql.options.connection.search_path;
  try {
    await sql.begin(async sql => {
      const relNamesQuery = async (kind: string) => sql<{ relname: string }[]>`
        SELECT relname
        FROM pg_class c
        JOIN pg_namespace s ON s.oid = c.relnamespace
        WHERE s.nspname = ${schema} AND c.relkind = ${kind}
      `;
      // Remove materialized views first and tables second.
      // Using CASCADE in these DROP statements also removes associated indexes and constraints.
      const views = await relNamesQuery('m');
      for (const view of views) {
        await sql`DROP MATERIALIZED VIEW IF EXISTS ${sql(view.relname)} CASCADE`;
      }
      const tables = await relNamesQuery('r');
      for (const table of tables) {
        await sql`DROP TABLE IF EXISTS ${sql(table.relname)} CASCADE`;
      }
    });
  } finally {
    await sql.end();
  }
}
