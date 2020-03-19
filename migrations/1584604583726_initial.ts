import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('blocks', {
    block_hash: {
      primaryKey: true,
      type: 'text'
    },
    index_block_hash: {
      type: 'text',
      notNull: true,
    },
    parent_block_hash: {
      type: 'text',
      notNull: true,
    },
    parent_microblock: {
      type: 'text',
      notNull: true,
    },
  })
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('blocks');
}
