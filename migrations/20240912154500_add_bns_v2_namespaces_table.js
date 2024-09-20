/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.createTable('namespaces_v2', {
    id: {
      type: 'serial',
      primaryKey: true,
    },
    namespace_id: {
      type: 'string',
      notNull: true,
    },
    namespace_manager: {
      type: 'string',
      notNull: false,
    },
    manager_transferable: {
      type: 'boolean',
      notNull: true,
    },
    manager_frozen: {
      type: 'boolean',
      notNull: true,
    },
    namespace_import: {
      type: 'string',
      notNull: true,
    },
    reveal_block: {
      type: 'integer',
      notNull: true,
    },
    launched_at: {
      type: 'integer',
      notNull: false,
    },
    launch_block: {
      type: 'integer',
      notNull: true,
    },
    lifetime: {
      type: 'integer',
      notNull: true,
    },
    can_update_price_function: {
      type: 'boolean',
      notNull: true,
    },
    buckets: {
      type: 'string',
      notNull: true,
    },
    base: {
      type: 'numeric',
      notNull: true,
    },
    coeff: {
      type: 'numeric',
      notNull: true,
    },
    nonalpha_discount: {
      type: 'numeric',
      notNull: true,
    },
    no_vowel_discount: {
      type: 'numeric',
      notNull: true,
    },
    status: {
      type: 'string',
      notNull: false,
    },
    tx_id: {
      type: 'bytea',
      notNull: true,
    },
    tx_index: {
      type: 'smallint',
      notNull: true,
    },
    canonical: {
      type: 'boolean',
      notNull: true,
      default: true,
    },
    index_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    parent_index_block_hash: {
      type: 'bytea',
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
  });

  pgm.createIndex('namespaces_v2', 'index_block_hash');
  pgm.createIndex('namespaces_v2', [
    { name: 'launch_block', sort: 'DESC' },
    { name: 'microblock_sequence', sort: 'DESC' },
    { name: 'tx_index', sort: 'DESC' },
  ]);
  pgm.addConstraint(
    'namespaces_v2',
    'unique_namespace_v2_id_tx_id_index_block_hash_microblock_hash',
    'UNIQUE(namespace_id, tx_id, index_block_hash, microblock_hash)'
  );
  pgm.addConstraint('namespaces_v2', 'unique_namespace_id', 'UNIQUE(namespace_id)');
};

exports.down = pgm => {
  pgm.dropTable('namespaces_v2');
};
