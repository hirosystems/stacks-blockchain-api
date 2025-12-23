/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.createTable('principal_tx_counts', {
    principal: {
      type: 'text',
      notNull: true,
      primaryKey: true,
    },
    count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
  });
  pgm.sql(`
    INSERT INTO principal_tx_counts (principal, count)
    (SELECT principal, COUNT(*) AS count FROM principal_txs GROUP BY principal)
  `);
};

exports.down = pgm => {
  pgm.dropTable('principal_tx_counts');
};
