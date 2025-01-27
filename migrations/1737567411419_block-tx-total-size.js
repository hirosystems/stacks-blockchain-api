/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.addColumn('blocks', {
    tx_total_size: {
      type: 'int',
    },
  });
};

exports.down = pgm => {
  pgm.dropColumn('blocks', ['tx_total_size']);
};
