/** @param { import("node-pg-migrate").MigrationBuilder } pgm */

const INDEX_METHOD = process.env.PG_IDENT_INDEX_TYPE;

exports.up = pgm => {
  pgm.createTable('faucet_requests', {
    id: {
      type: 'serial',
      primaryKey: true,
    },
    currency: {
      type: 'string',
      notNull: true,
    },
    address: {
      type: 'string',
      notNull: true,
    },
    ip: {
      type: 'string',
      notNull: true,
    },
    occurred_at: {
      type: 'bigint',
      notNull: true,
    },
  });

  pgm.createIndex('faucet_requests', 'address', { method: INDEX_METHOD });
}
