/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  const serverVersion = await pgm.db.query(`SHOW server_version`);
  const majorVersion = parseInt(serverVersion.rows[0].server_version.split(' ')[0].split('.')[0]);
  if (majorVersion >= 14) {
    pgm.createMaterializedView('mempool_digest', {}, `
      SELECT to_hex(bit_xor(tx_short_id)) AS digest
      FROM (
          SELECT ('x' || encode(tx_id, 'hex'))::bit(64)::bigint tx_short_id
          FROM mempool_txs
          WHERE pruned = false
      ) m
    `);
  } else {
    pgm.createMaterializedView('mempool_digest', {}, `
      SELECT NULL AS digest
    `);
  }
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropMaterializedView('mempool_digest');
}
