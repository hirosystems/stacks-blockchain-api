/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.dropIndex('blocks', 'signer_signatures', { ifExists: true });
};

exports.down = pgm => {
  pgm.createIndex('blocks', 'signer_signatures', { ifNotExists: true, method: 'gin' });
};
