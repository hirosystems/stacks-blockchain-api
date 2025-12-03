import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('chain_tip', {
    id: {
      type: 'bool',
      primaryKey: true,
      default: true,
    },
    block_height: {
      type: 'integer',
      notNull: true,
    },
    block_count: {
      type: 'integer',
      notNull: true,
    },
    block_hash: {
      type: 'bytea',
      notNull: true,
    },
    index_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    burn_block_height: {
      type: 'integer',
      notNull: true,
    },
    microblock_hash: {
      type: 'bytea',
    },
    microblock_sequence: {
      type: 'integer',
    },
    microblock_count: {
      type: 'integer',
      notNull: true,
    },
    tx_count: {
      type: 'integer',
      notNull: true,
    },
    tx_count_unanchored: {
      type: 'integer',
      notNull: true,
    },
    mempool_tx_count: {
      type: 'int',
      notNull: true,
    },
    mempool_updated_at: {
      type: 'timestamptz',
      notNull: true,
    },
  });

  pgm.addConstraint('chain_tip', 'chain_tip_one_row', 'CHECK(id)');
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('chain_tip');
}

