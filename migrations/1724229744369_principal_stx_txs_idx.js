/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.createIndex(
    'principal_stx_txs', 
    [
      'principal',
      { name: 'block_height', order: 'DESC' },
      { name: 'microblock_sequence', order: 'DESC' },
      { name: 'tx_index', order: 'DESC' }],
    {
      name: 'idx_principal_stx_txs_optimized',
      where: 'canonical = TRUE AND microblock_canonical = TRUE',
    }
  );
};

/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.down = pgm => {
  pgm.dropIndex('principal_stx_txs', ['principal', 'block_height', 'microblock_sequence', 'tx_index'], {
    name: 'idx_principal_stx_txs_optimized',
  });
};
