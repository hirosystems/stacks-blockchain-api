/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.createIndex('contract_logs', 'contract_identifier');
}
