/* eslint-disable camelcase */

/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.addColumn('txs', {
    stacks_block_time: {
      type: 'integer',
      notNull: true,
      default: '0'
    }
  });

  pgm.addColumn('blocks', {
    stacks_block_time: {
      type: 'integer',
      notNull: true,
      default: '0'
    }
  });

};
