/* eslint-disable camelcase */

/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {

  pgm.addColumn('blocks', {
    signer_signature: {
      type: 'bytea[]',
    }
  });

  pgm.createIndex('blocks', 'signer_signature', { method: 'gin' });

};
