import { pipelineAsync } from '../helpers';
import { Readable, Writable } from 'stream';
import { DbRawEventRequest } from './common';
import { connectPostgres, PgServer } from './connection';
import { connectPgPool, connectWithRetry } from './connection-legacy';
import * as pgCopyStreams from 'pg-copy-streams';
import * as PgCursor from 'pg-cursor';

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
  readStream: Readable,
  onStatusUpdate?: (msg: string) => void
): AsyncGenerator<DbRawEventRequest[], void, unknown> {
  // 1. Pipe input stream into a temp table
  // 2. Use `pg-cursor` to async read rows from temp table (order by `id` ASC)
  // 3. Drop temp table
  // 4. Close db connection
  const pool = await connectPgPool({
    usageName: 'get-raw-events',
    pgServer: PgServer.primary,
  });
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`
        CREATE TEMPORARY TABLE temp_event_observer_requests(
          id bigint PRIMARY KEY,
          receive_timestamp timestamptz NOT NULL,
          event_path text NOT NULL,
          payload jsonb NOT NULL
        ) ON COMMIT DROP
      `);
      // Use a `temp_raw_tsv` table first to store the raw TSV data as it might come with duplicate
      // rows which would trigger the `PRIMARY KEY` constraint in `temp_event_observer_requests`.
      // We will "upsert" from the former to the latter before event ingestion.
      await client.query(`
        CREATE TEMPORARY TABLE temp_raw_tsv
        (LIKE temp_event_observer_requests)
        ON COMMIT DROP
      `);
      onStatusUpdate?.('Importing raw event requests into temporary table...');
      const importStream = client.query(pgCopyStreams.from(`COPY temp_raw_tsv FROM STDIN`));
      await pipelineAsync(readStream, importStream);
      onStatusUpdate?.('Removing any duplicate raw event requests...');
      await client.query(`
        INSERT INTO temp_event_observer_requests
        SELECT *
        FROM temp_raw_tsv
        ON CONFLICT DO NOTHING;
      `);
      const totallengthQuery = await client.query<{ count: string }>(
        `SELECT COUNT(id) count FROM temp_event_observer_requests`
      );
      const totallength = parseInt(totallengthQuery.rows[0].count);
      let lastStatusUpdatePercent = 0;
      onStatusUpdate?.('Streaming raw event requests from temporary table...');
      const cursor = new PgCursor<{ id: string; event_path: string; payload: string }>(
        `
        SELECT id, event_path, payload::text
        FROM temp_event_observer_requests
        ORDER BY id ASC
        `
      );
      const cursorQuery = client.query(cursor);
      const rowBatchSize = 100;
      let rowsReadCount = 0;
      let rows: DbRawEventRequest[] = [];
      do {
        rows = await new Promise<DbRawEventRequest[]>((resolve, reject) => {
          cursorQuery.read(rowBatchSize, (error, rows) => {
            if (error) {
              reject(error);
            } else {
              rowsReadCount += rows.length;
              if ((rowsReadCount / totallength) * 100 > lastStatusUpdatePercent + 1) {
                lastStatusUpdatePercent = Math.floor((rowsReadCount / totallength) * 100);
                onStatusUpdate?.(
                  `Raw event requests processed: ${lastStatusUpdatePercent}% (${rowsReadCount} / ${totallength})`
                );
              }
              resolve(rows);
            }
          });
        });
        if (rows.length > 0) {
          yield rows;
        }
      } while (rows.length > 0);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
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
