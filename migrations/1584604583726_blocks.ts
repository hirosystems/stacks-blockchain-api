import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('blocks', {
    block_hash: {
      primaryKey: true,
      type: 'bytea',
    },
    block_height: {
      type: 'integer',
      notNull: true,
    },
    index_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    parent_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    parent_microblock: {
      type: 'bytea',
      notNull: true,
    },
    canonical: {
      type: 'boolean',
      notNull: true,
    },
  });
  pgm.createIndex('blocks', 'block_height');
  pgm.createIndex('blocks', 'parent_block_hash');
  pgm.createIndex('blocks', 'canonical');
}

/*
export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('blocks');
}
*/
