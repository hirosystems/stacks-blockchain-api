/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.createIndex('pox2_events', 'delegate_to');
  pgm.createIndex('pox2_events', 'unlock_burn_height');
}

/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.down = pgm => {
  pgm.dropIndex('pox2_events', 'delegate_to');
  pgm.dropIndex('pox2_events', 'unlock_burn_height');
}
