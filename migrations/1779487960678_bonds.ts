import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export const up = (pgm: MigrationBuilder) => {
  pgm.createTable('bonds', {
    id: {
      type: 'bigserial',
      primaryKey: true,
    },
    tx_id: {
      type: 'bytea',
      notNull: true,
    },
    tx_index: {
      type: 'smallint',
      notNull: true,
    },
    block_height: {
      type: 'integer',
      notNull: true,
    },
    block_hash: {
      type: 'bytea',
      notNull: true,
    },
    block_time: {
      type: 'bigint',
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
    parent_index_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    burn_block_height: {
      type: 'integer',
      notNull: true,
    },
    burn_block_time: {
      type: 'bigint',
      notNull: true,
    },
    microblock_hash: {
      type: 'bytea',
      notNull: true,
    },
    microblock_sequence: {
      type: 'integer',
      notNull: true,
    },
    microblock_canonical: {
      type: 'boolean',
      notNull: true,
    },
    canonical: {
      type: 'boolean',
      notNull: true,
    },
    bond_index: {
      type: 'integer',
      notNull: true,
    },
    target_rate: {
      type: 'integer',
      notNull: true,
    },
    stx_value_ratio: {
      type: 'integer',
      notNull: true,
    },
    min_ustx_ratio: {
      type: 'integer',
      notNull: true,
    },
    early_unlock_bytes: {
      type: 'text',
      notNull: true,
    },
    early_unlock_admin: {
      type: 'text',
    },
    first_reward_cycle: {
      type: 'integer',
      notNull: true,
    },
    bond_start_height: {
      type: 'integer',
      notNull: true,
    },
    unlock_cycle: {
      type: 'integer',
      notNull: true,
    },
    unlock_burn_height: {
      type: 'integer',
      notNull: true,
    },
    btc_capacity: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
    btc_locked: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
    stx_locked: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
    btc_paid_out: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
    allowed_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    registered_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
  });
  pgm.createIndex(
    'bonds',
    [
      { name: 'block_height', sort: 'DESC' },
      { name: 'microblock_sequence', sort: 'DESC' },
      { name: 'tx_index', sort: 'DESC' },
    ],
    {
      where: 'canonical = TRUE AND microblock_canonical = TRUE',
    }
  );
  pgm.createIndex('bonds', 'bond_index', {
    where: 'canonical = TRUE AND microblock_canonical = TRUE',
  });

  // Add bond count to chain tip table to track the number of bonds in the chain
  pgm.addColumn('chain_tip', {
    bond_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
  });
};

export const down = (pgm: MigrationBuilder) => {
  pgm.dropTable('bonds');
  pgm.dropColumn('chain_tip', 'bond_count');
};
