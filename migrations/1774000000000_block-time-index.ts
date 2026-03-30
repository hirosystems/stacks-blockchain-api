import type { MigrationBuilder } from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder) => {
  pgm.createIndex('blocks', [{ name: 'block_time', sort: 'DESC' }], {
    where: 'canonical = true',
    name: 'blocks_canonical_block_time_desc_idx',
  });
};

export const down = (pgm: MigrationBuilder) => {
  pgm.dropIndex('blocks', [], { name: 'blocks_canonical_block_time_desc_idx' });
};
