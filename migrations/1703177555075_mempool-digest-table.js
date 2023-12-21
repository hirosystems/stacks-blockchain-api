/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.dropMaterializedView('mempool_digest');
  pgm.createTable('mempool_digest', {
    id: {
      type: 'bool',
      primaryKey: true,
      default: true,
    },
    digest: {
      type: 'text',
    },
    tx_count: {
      type: 'int',
      notNull: true,
      default: 0,
    }
  });
  pgm.addConstraint('mempool_digest', 'mempool_digest_one_row', 'CHECK(id)');
  pgm.sql(`
    INSERT INTO mempool_digest (digest, tx_count)
    VALUES (
      (
        SELECT COALESCE(to_hex(bit_xor(tx_short_id)), '0') AS digest
        FROM (
          SELECT ('x' || encode(tx_id, 'hex'))::bit(64)::bigint tx_short_id
          FROM mempool_txs
          WHERE pruned = false
        ) m
      ),
      (SELECT COUNT(*)::int FROM mempool_txs WHERE pruned = FALSE)
    )
  `);
};

exports.down = pgm => {
  pgm.dropTable('mempool_digest');
  pgm.createMaterializedView('mempool_digest', {}, `
    SELECT COALESCE(to_hex(bit_xor(tx_short_id)), '0') AS digest
    FROM (
      SELECT ('x' || encode(tx_id, 'hex'))::bit(64)::bigint tx_short_id
      FROM mempool_txs
      WHERE pruned = false
    ) m
  `);
  pgm.createIndex('mempool_digest', 'digest', { unique: true });
};
