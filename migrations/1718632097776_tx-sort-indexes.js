/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.createIndex('txs', 'burn_block_time');
  pgm.createIndex('txs', 'fee_rate');
};

/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.down = pgm => {
  pgm.dropIndex('txs', 'burn_block_time');
  pgm.dropIndex('txs', 'fee_rate');
};
