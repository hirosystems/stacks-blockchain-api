/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.addColumn('txs', {
    burn_block_height: {
      type: 'integer',
      notNull: false,
    },
  });
  pgm.sql(`
    UPDATE txs
    SET burn_block_height = blocks.burn_block_height
    FROM blocks
    WHERE txs.index_block_hash = blocks.index_block_hash  
  `);
  pgm.alterColumn('txs', 'burn_block_height', { notNull: true });
};

/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.down = pgm => {
  pgm.dropColumn('txs', 'burn_block_height');
};
