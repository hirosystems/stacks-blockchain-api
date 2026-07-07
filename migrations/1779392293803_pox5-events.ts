import type { MigrationBuilder } from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder) => {
  pgm.createTable('pox5_events', {
    id: {
      type: 'bigserial',
      primaryKey: true,
    },
    event_index: {
      type: 'integer',
      notNull: true,
    },
    tx_id: {
      notNull: true,
      type: 'bytea',
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
    },
    block_time: {
      type: 'bigint',
    },
    index_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    parent_block_hash: {
      type: 'bytea',
    },
    parent_index_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    burn_block_height: {
      type: 'integer',
    },
    burn_block_time: {
      type: 'bigint',
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
    name: {
      type: 'text',
      notNull: true,
    },
    data: {
      type: 'jsonb',
      notNull: true,
    },
  });

  pgm.createIndex(
    'pox5_events',
    [
      { name: 'block_height', sort: 'DESC' },
      { name: 'microblock_sequence', sort: 'DESC' },
      { name: 'tx_index', sort: 'DESC' },
      { name: 'event_index', sort: 'DESC' },
    ],
    {
      where: 'canonical = TRUE AND microblock_canonical = TRUE',
    }
  );
  pgm.createIndex('pox5_events', 'tx_id');
  pgm.createIndex('pox5_events', ['index_block_hash', 'canonical']);
  pgm.createIndex('pox5_events', 'microblock_hash');

  // Add pox_v5_unlock_height to pox_state table to track the unlock height for pox v5
  pgm.addColumn('pox_state', {
    pox_v4_unlock_height: {
      type: 'bigint',
      notNull: true,
      default: 0,
    },
  });
};

export const down = (pgm: MigrationBuilder) => {
  pgm.dropTable('pox5_events');
  pgm.dropColumn('pox_state', 'pox_v4_unlock_height');
};
