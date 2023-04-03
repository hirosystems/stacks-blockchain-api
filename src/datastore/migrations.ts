import * as path from 'path';
import PgMigrate, { RunnerOption } from 'node-pg-migrate';
import { Client, QueryResultRow } from 'pg';
import * as PgCursor from 'pg-cursor';
import {
  APP_DIR,
  clarityValueToCompactJson,
  isDevEnv,
  isTestEnv,
  logError,
  logger,
  REPO_DIR,
} from '../helpers';
import { getPgClientConfig, PgClientConfig } from './connection-legacy';
import { connectPostgres, PgServer } from './connection';
import { databaseHasData } from './event-requests';

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
    await completeSqlMigrations(client, clientConfig);
  } catch (error) {
    logError(`Error running pg-migrate`, error);
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

// Function to finish running sql migrations that are too complex for the node-pg-migrate library.
async function completeSqlMigrations(client: Client, clientConfig: PgClientConfig) {
  try {
    await client.query('BEGIN');
    await complete_1680181889941_contract_log_json(client, clientConfig);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function* pgCursorQuery<R extends QueryResultRow = any>(args: {
  clientConfig: PgClientConfig;
  queryText: string;
  queryValues?: any[];
  batchSize: number;
}) {
  const cursorClient = new Client(args.clientConfig);
  try {
    await cursorClient.connect();
    const cursor = new PgCursor<R>(args.queryText, args.queryValues);
    const cursorQuery = cursorClient.query(cursor);
    let rows: R[] = [];
    do {
      rows = await new Promise((resolve, reject) => {
        cursorQuery.read(args.batchSize, (error, rows) => (error ? reject(error) : resolve(rows)));
      });
      yield* rows;
    } while (rows.length > 0);
  } finally {
    await cursorClient.end();
  }
}

async function complete_1680181889941_contract_log_json(
  client: Client,
  clientConfig: PgClientConfig
) {
  // Determine if this migration has already been run by checking if the bew column is nullable.
  const result = await client.query(`
    SELECT is_nullable FROM information_schema.columns
    WHERE table_name = 'contract_logs' AND column_name = 'value_json'
  `);
  const migrationNeeded = result.rows[0].is_nullable === 'YES';
  if (!migrationNeeded) {
    return;
  }
  logger.info(`Running migration 1680181889941_contract_log_json..`);

  const contractLogsCursor = pgCursorQuery<{ id: string; value: string }>({
    clientConfig,
    queryText: 'SELECT id, value FROM contract_logs',
    batchSize: 1000,
  });

  const rowCountQuery = await client.query<{ count: number }>(
    'SELECT COUNT(*)::integer FROM contract_logs'
  );
  const totalRowCount = rowCountQuery.rows[0].count;
  let rowsProcessed = 0;
  let lastPercentComplete = 0;
  const percentLogInterval = 3;

  for await (const row of contractLogsCursor) {
    const clarityValJson = JSON.stringify(clarityValueToCompactJson(row.value));
    await client.query({
      name: 'update_contract_log_json',
      text: 'UPDATE contract_logs SET value_json = $1 WHERE id = $2',
      values: [clarityValJson, row.id],
    });
    rowsProcessed++;
    const percentComplete = Math.round((rowsProcessed / totalRowCount) * 100);
    if (percentComplete > lastPercentComplete + percentLogInterval) {
      lastPercentComplete = percentComplete;
      logger.info(`Running migration 1680181889941_contract_log_json.. ${percentComplete}%`);
    }
  }

  logger.info(`Running migration 1680181889941_contract_log_json.. set NOT NULL`);
  await client.query(`ALTER TABLE contract_logs ALTER COLUMN value_json SET NOT NULL`);

  logger.info('Running migration 1680181889941_contract_log_json.. creating jsonb_path_ops index');
  await client.query(
    `CREATE INDEX contract_logs_jsonpathops_idx ON contract_logs USING GIN (value_json jsonb_path_ops)`
  );

  logger.info('Running migration 1680181889941_contract_log_json.. creating jsonb_ops index');
  await client.query(
    `CREATE INDEX contract_logs_jsonops_idx ON contract_logs USING GIN (value_json jsonb_ops)`
  );

  logger.info(`Running migration 1680181889941_contract_log_json.. 100%`);
}
