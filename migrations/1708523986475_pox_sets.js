/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.createTable('pox_sets', {
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
    pox_ustx_threshold: {
      type: 'numeric',
      notNull: true,
    },
    canonical: {
      type: 'boolean',
      notNull: true,
    },
    signing_key: {
      type: 'bytea',
      notNull: true,
    },
    weight: {
      type: 'int',
      notNull: true,
    },
    stacked_amount: {
      type: 'numeric',
      notNull: true,
    },
    weight_percent: {
      type: 'double precision',
      notNull: true,
    },
    stacked_amount_percent: {
      type: 'double precision',
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
  });

  pgm.createIndex('pox_sets', 'block_height');
  pgm.createIndex('pox_sets', 'index_block_hash');
  pgm.createIndex('pox_sets', 'signing_key');
  pgm.createIndex('pox_sets', 'cycle_number');
}
