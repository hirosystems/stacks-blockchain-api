/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
async function isBitXorAvailable(pgm) {
  try {
    await pgm.db.query('SELECT bit_xor(1)');
    return true;
  } catch (error) {
    if (error.code === '42883' /* UNDEFINED_FUNCTION */) {
      return false;
    }
    throw error;
  }
}

/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = async pgm => {
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

  pgm.createIndex('mempool_digest', 'digest', { unique: true });
}

/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.down = pgm => {
  pgm.dropIndex('mempool_digest', 'digest', { unique: true, ifExists: true });
  pgm.dropMaterializedView('mempool_digest');
}
