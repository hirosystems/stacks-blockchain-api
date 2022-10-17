/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.createIndex('nft_custody', 'value', { method: 'hash' });
  pgm.createIndex('nft_custody_unanchored', 'value', { method: 'hash' });
}
