/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.createIndex('blocks', [{ name: 'block_time', sort: 'DESC' }], {
    where: 'canonical = true',
    name: 'blocks_canonical_block_time_desc_idx',
  });
};

/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.down = pgm => {
  pgm.dropIndex('blocks', [], { name: 'blocks_canonical_block_time_desc_idx' });
};
