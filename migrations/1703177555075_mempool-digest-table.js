/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.addColumn('chain_tip', {
    mempool_tx_count: {
      type: 'int',
      default: 0,
    },
    mempool_updated_at: {
      type: 'timestamptz',
      default: pgm.func('(NOW())'),
    },
  });
  pgm.sql(`
    UPDATE chain_tip SET
      mempool_tx_count = (SELECT COUNT(*)::int FROM mempool_txs WHERE pruned = FALSE),
      mempool_updated_at = NOW()
  `);
  pgm.alterColumn('chain_tip', 'mempool_tx_count', { notNull: true });
  pgm.alterColumn('chain_tip', 'mempool_updated_at', { notNull: true });
};

exports.down = pgm => {
  pgm.dropColumn('chain_tip', ['mempool_tx_count', 'mempool_updated_at']);
};
