import { PgSqlClient } from '../connection';

function quotePgIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

type GinIndexRow = {
  schemaname: string;
  indexname: string;
};

export async function up(sql: PgSqlClient): Promise<void> {
  const ginIndexes = await sql<GinIndexRow[]>`
    SELECT
      schemaname,
      indexname
    FROM pg_indexes
    WHERE tablename = 'blocks'
      AND indexdef ILIKE '% USING gin %'
      AND schemaname NOT IN ('pg_catalog', 'information_schema')
  `;

  for (const { schemaname, indexname } of ginIndexes) {
    await sql.unsafe(
      `DROP INDEX CONCURRENTLY IF EXISTS ${quotePgIdentifier(schemaname)}.${quotePgIdentifier(indexname)}`
    );
  }
}

export async function down(_sql: PgSqlClient): Promise<void> {
  // Intentionally left empty.
  //
  // The removed GIN index on `blocks` was unused and expensive to maintain on an
  // append-heavy ingestion table. Recreating it would reintroduce write
  // amplification, index bloat, VACUUM pressure, and potential replication lag.
}