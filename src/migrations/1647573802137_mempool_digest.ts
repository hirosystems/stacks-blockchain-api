/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

async function pgServerMajorVersion(pgm: MigrationBuilder): Promise<number | undefined> {
  const result = await pgm.db.query(`SHOW server_version`);
  if (result.rowCount === 0) {
    return;
  }
  return parseInt(result.rows[0].server_version
    .split(' ')[0] // Remove additional info e.g. "(Debian 11.12-1.pgdg100+1)"
    .split('.')[0] // Take only the major version e.g. "14" from "14.2"
  );
}

export async function up(pgm: MigrationBuilder): Promise<void> {
  const serverVersion = await pgServerMajorVersion(pgm);
  // The `bit_xor` function is available starting at PostgreSQL 14.
  if (serverVersion && serverVersion >= 14) {
    pgm.createMaterializedView('mempool_digest', {}, `
      SELECT to_hex(bit_xor(tx_short_id)) AS digest
      FROM (
          SELECT ('x' || encode(tx_id, 'hex'))::bit(64)::bigint tx_short_id
          FROM mempool_txs
          WHERE pruned = false
      ) m
    `);
  } else {
    // TODO: Create a backwards-compatible view.
    // We could use postgres' `digest` function here, but that requires enabling the `pgcrypto`
    // extension which might not be possible for some users.
    pgm.createMaterializedView('mempool_digest', {}, `SELECT NULL AS digest`);
  }
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropMaterializedView('mempool_digest');
}
