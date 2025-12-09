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
      default: 0,
    },
    mempool_updated_at: {
      type: 'timestamptz',
      default: pgm.func('(NOW())'),
    },
  });

  pgm.addConstraint('chain_tip', 'chain_tip_one_row', 'CHECK(id)');

  pgm.sql(`
    INSERT INTO chain_tip (id, block_height, block_count, block_hash, index_block_hash, burn_block_height, microblock_hash, microblock_sequence, microblock_count, tx_count, tx_count_unanchored, mempool_tx_count, mempool_updated_at)
    VALUES (true, 0, 0, '\\x'::bytea, '\\x'::bytea, 0, NULL, NULL, 0, 0, 0, 0, NOW())
  `);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('chain_tip');
}

