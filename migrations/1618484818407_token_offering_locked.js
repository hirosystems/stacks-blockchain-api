/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.createTable('token_offering_locked', {
    id: {
      type: 'serial',
      primaryKey: true,
    },
    address: {
      type: 'string',
      notNull: true,
    },
    value: {
      type: 'bigint',
      notNull: true,
    },
    block: {
      type: 'integer',
      notNull: true,
    },
  });

  pgm.createIndex('token_offering_locked', 'address', { method: 'hash' });
}
