import { pipeline } from 'node:stream/promises';
import { Readable } from 'stream';
import { DbRawEventRequest } from '../datastore/common';
import { getConnectionArgs, getConnectionConfig, PgServer } from '../datastore/connection';
import { connectPostgres } from '@stacks/api-toolkit';
import { createWriteStream } from 'node:fs';

export async function exportRawEventRequests(filePath: string, local: boolean): Promise<void> {
  const sql = await connectPostgres({
    usageName: `export-events`,
    connectionArgs: getConnectionArgs(PgServer.primary),
    connectionConfig: getConnectionConfig(PgServer.primary),
  });
  const copyQuery = sql`
    COPY (
      SELECT id, receive_timestamp, event_path, payload
      FROM event_observer_requests
      ORDER BY id ASC
    )`;
  if (local) {
    await sql`${copyQuery}
      TO '${sql.unsafe(filePath)}'
      WITH (FORMAT TEXT, DELIMITER E'\t', ENCODING 'UTF8')
    `;
  } else {
    const readableStream = await sql`${copyQuery}
      TO STDOUT
      WITH (FORMAT TEXT, DELIMITER E'\t', ENCODING 'UTF8')
    `.readable();
    await pipeline(readableStream, createWriteStream(filePath));
  }
  await sql.end();
}

export async function* getRawEventRequests(
  readStream: Readable,
  onStatusUpdate?: (msg: string) => void
): AsyncGenerator<DbRawEventRequest[], void, unknown> {
  const sql = await connectPostgres({
    usageName: 'get-raw-events',
    connectionArgs: getConnectionArgs(PgServer.primary),
    connectionConfig: getConnectionConfig(PgServer.primary),
  });
  const reserved = await sql.reserve();
  try {
    await reserved`
      CREATE TEMPORARY TABLE temp_event_observer_requests(
        id bigint PRIMARY KEY,
        receive_timestamp timestamptz NOT NULL,
        event_path text NOT NULL,
        payload jsonb NOT NULL
      )
    `;
    // Use a `temp_raw_tsv` table first to store the raw TSV data as it might come with duplicate
    // rows which would trigger the `PRIMARY KEY` constraint in `temp_event_observer_requests`.
    // We will "upsert" from the former to the latter before event ingestion.
    await reserved`
      CREATE TEMPORARY TABLE temp_raw_tsv
      (LIKE temp_event_observer_requests)
    `;
    onStatusUpdate?.('Importing raw event requests into temporary table...');
    const writable = await reserved`COPY temp_raw_tsv FROM STDIN`.writable();
    await pipeline(readStream, writable);
    onStatusUpdate?.('Removing any duplicate raw event requests...');
    await reserved`
      INSERT INTO temp_event_observer_requests
      SELECT *
      FROM temp_raw_tsv
      ON CONFLICT DO NOTHING
    `;
    const [{ count }] = await reserved<{ count: string }[]>`
      SELECT COUNT(id) count FROM temp_event_observer_requests
    `;
    const totalLength = parseInt(count);
    let lastStatusUpdatePercent = 0;
    onStatusUpdate?.('Streaming raw event requests from temporary table...');
    const rowBatchSize = 100;
    let rowsReadCount = 0;
    const cursor = reserved<DbRawEventRequest[]>`
      SELECT id, event_path, payload::text
      FROM temp_event_observer_requests
      ORDER BY id ASC
    `.cursor(rowBatchSize);
    for await (const rows of cursor) {
      rowsReadCount += rows.length;
      if ((rowsReadCount / totalLength) * 100 > lastStatusUpdatePercent + 1) {
        lastStatusUpdatePercent = Math.floor((rowsReadCount / totalLength) * 100);
        onStatusUpdate?.(
          `Raw event requests processed: ${lastStatusUpdatePercent}% (${rowsReadCount} / ${totalLength})`
        );
      }
      yield rows;
    }
  } finally {
    await reserved.release();
    await sql.end();
  }
}
