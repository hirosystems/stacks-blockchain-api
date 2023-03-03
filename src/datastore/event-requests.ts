import { pipelineAsync } from '../helpers';
import { Readable, Writable } from 'stream';
import { DbRawEventRequest } from './common';
import { connectPostgres, PgServer } from './connection';
import { connectPgPool, connectWithRetry } from './connection-legacy';
import * as pgCopyStreams from 'pg-copy-streams';
import * as PgCursor from 'pg-cursor';
import * as readline from 'readline';

export async function exportRawEventRequests(targetStream: Writable): Promise<void> {
  const pool = await connectPgPool({
    usageName: 'export-raw-events',
    pgServer: PgServer.primary,
  });
  const client = await connectWithRetry(pool);
  try {
    const copyQuery = pgCopyStreams.to(
      `
      COPY (SELECT id, receive_timestamp, event_path, payload FROM event_observer_requests ORDER BY id ASC)
      TO STDOUT ENCODING 'UTF8'
      `
    );
    const queryStream = client.query(copyQuery);
    await pipelineAsync(queryStream, targetStream);
  } finally {
    client.release();
    await pool.end();
  }
}

export async function* getRawEventRequests(
  readStream: Readable
): AsyncGenerator<DbRawEventRequest, void, unknown> {
  const rl = readline.createInterface({
    input: readStream,
    crlfDelay: Infinity,
  });
  try {
    for await (const line of rl) {
      const columns = line.split('\t');
      const rawRequest: DbRawEventRequest = {
        event_path: columns[2],
        payload: columns[3],
      };
      yield rawRequest;
    }
  } finally {
    rl.close();
  }
}

/**
 * Check the `pg_class` table for any data structures contained in the database. We will consider
 * any and all results here as "data" contained in the DB, since anything that is not a completely
 * empty DB could lead to strange errors when running the API. See:
 * https://www.postgresql.org/docs/current/catalog-pg-class.html
 * @returns `boolean` if the DB has data
 */
export async function databaseHasData(args?: {
  ignoreMigrationTables?: boolean;
}): Promise<boolean> {
  const sql = await connectPostgres({
    usageName: 'contains-data-check',
    pgServer: PgServer.primary,
  });
  try {
    const ignoreMigrationTables = args?.ignoreMigrationTables ?? false;
    const result = await sql<{ count: number }[]>`
      SELECT COUNT(*)
      FROM pg_class c
      JOIN pg_namespace s ON s.oid = c.relnamespace
      WHERE s.nspname = ${sql.options.connection.search_path}
      ${ignoreMigrationTables ? sql`AND c.relname NOT LIKE 'pgmigrations%'` : sql``}
    `;
    return result.count > 0 && result[0].count > 0;
  } catch (error: any) {
    if (error.message?.includes('does not exist')) {
      return false;
    }
    throw error;
  } finally {
    await sql.end();
  }
}
