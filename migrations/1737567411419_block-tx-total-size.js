/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.addColumn('blocks', {
    tx_total_size: {
      type: 'int',
      notNull: true,
      default: 0,
    },
  });
  pgm.sql(`
    UPDATE blocks
    SET tx_total_size = (
      SELECT SUM(OCTET_LENGTH(raw_tx))
      FROM txs
      WHERE index_block_hash = blocks.index_block_hash
    )  
  `);
};

exports.down = pgm => {
  pgm.dropColumn('blocks', ['tx_total_size']);
};
