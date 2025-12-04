import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('pox_cycles', {
    id: {
      type: 'bigserial',
      primaryKey: true,
    },
    block_height: {
      type: 'integer',
      notNull: true,
    },
    index_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    parent_index_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    cycle_number: {
      type: 'int',
      notNull: true,
    },
    canonical: {
      type: 'boolean',
      notNull: true,
    },
    total_weight: {
      type: 'int',
      notNull: true,
    },
    total_stacked_amount: {
      type: 'numeric',
      notNull: true,
    },
    total_signers: {
      type: 'int',
      notNull: true,
    },
  });

  pgm.createConstraint('pox_cycles', 'pox_cycles_unique', 'UNIQUE(cycle_number, index_block_hash)');
  pgm.createIndex('pox_cycles', 'block_height');
  pgm.createIndex('pox_cycles', 'index_block_hash');
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('pox_cycles');
}

