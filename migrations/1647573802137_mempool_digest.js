/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

async function isBitXorAvailable(pgm: MigrationBuilder) {
  try {
    await pgm.db.query('SELECT bit_xor(1)');
    return true;
  } catch (error: any) {
    if (error.code === '42883' /* UNDEFINED_FUNCTION */) {
      return false;
    }
    throw error;
  }
}

export async function up(pgm: MigrationBuilder): Promise<void> {
  if (await isBitXorAvailable(pgm)) {
    pgm.createMaterializedView('mempool_digest', {}, `
      SELECT COALESCE(to_hex(bit_xor(tx_short_id)), '0') AS digest
      FROM (
        SELECT ('x' || encode(tx_id, 'hex'))::bit(64)::bigint tx_short_id
        FROM mempool_txs
        WHERE pruned = false
      ) m
    `);
  } else {
    // Assume mempool cache is always invalid.
    // We could use postgres' `digest` function here, but that requires enabling the `pgcrypto`
    // extension which might not be possible for some users.
    pgm.createMaterializedView('mempool_digest', {}, `SELECT NULL AS digest`);
  }
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropMaterializedView('mempool_digest');
}
