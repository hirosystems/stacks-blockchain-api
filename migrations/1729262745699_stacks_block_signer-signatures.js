/* eslint-disable camelcase */

/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {

  pgm.addColumn('blocks', {
    signer_signatures: {
      type: 'bytea[]',
    }
  });

  pgm.createIndex('blocks', 'signer_signatures', { method: 'gin' });

};
