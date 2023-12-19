/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.addColumns('blocks', {
    tx_count: {
      type: 'int',
      default: 1,
    },
  });
  pgm.sql(`
    UPDATE blocks SET tx_count = (
      SELECT COUNT(*)::int
      FROM txs
      WHERE index_block_hash = blocks.index_block_hash
        AND canonical = TRUE
        AND microblock_canonical = TRUE
    )
  `);
  pgm.alterColumn('blocks', 'tx_count', { notNull: true });
};

exports.down = pgm => {
  pgm.dropColumn('blocks', ['tx_count']);
};
