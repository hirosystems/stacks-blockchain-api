/* eslint-disable camelcase */

/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {

  pgm.addColumn('blocks', {
    signer_bitvec: {
      type: 'bit varying',
    }
  });

};
