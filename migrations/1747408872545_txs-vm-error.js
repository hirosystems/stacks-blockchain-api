/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.addColumn('txs', {
    vm_error: {
      type: 'text',
    }
  });
};
