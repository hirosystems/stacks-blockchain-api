/* eslint-disable camelcase */

/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.addColumn('txs', {
    block_time: {
      type: 'integer',
      notNull: true,
      default: '0'
    }
  });

  pgm.addColumn('blocks', {
    block_time: {
      type: 'integer',
      notNull: true,
      default: '0'
    }
  });

};
