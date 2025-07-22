/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.createIndex('txs', 'status', {
    where: 'canonical = TRUE AND microblock_canonical = TRUE',
    name: 'idx_txs_status_optimized'
  });
};

exports.down = pgm => {
  pgm.dropIndex('txs', 'status', {
    name: 'idx_txs_status_optimized'
  });
};
