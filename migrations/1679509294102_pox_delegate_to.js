/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.createIndex('pox2_events', 'delegate_to');
}

/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.down = pgm => {
  pgm.dropIndex('pox2_events', 'delegate_to');
}
