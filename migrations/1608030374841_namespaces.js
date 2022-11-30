/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.createTable('namespaces', {
    id: {
      type: 'serial',
      primaryKey: true,
    },
    namespace_id: {
      type: 'string',
      notNull: true,
    },
    launched_at: {
      type: 'integer',
      notNull: false,
    },
    address: {
      type: 'string',
      notNull: true,
    },
    reveal_block: {
      type: 'integer',
      notNull: true,
    },
    ready_block: {
      type: 'integer',
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
      type: 'integer',
      notNull: true,
    },
    no_vowel_discount: {
      type: 'integer',
      notNull: true,
    },
    lifetime: {
      type: 'integer',
      notNull: true,
    },
    status: {
      type: 'string',
      notNull: false,
    },
    tx_id: {
      type: 'bytea',
      notNull: false,
    },
    tx_index: {
      type: 'smallint',
      notNull: true,
    },
    canonical: {
      type: 'boolean',
      notNull: true,
      default: true
    },
    index_block_hash: {
      type: 'bytea',
      notNull: false
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

  pgm.createIndex('namespaces', 'index_block_hash');
  pgm.createIndex('namespaces', [
    { name: 'ready_block', sort: 'DESC' },
    { name: 'microblock_sequence', sort: 'DESC' },
    { name: 'tx_index', sort: 'DESC' },
  ]);
  pgm.addConstraint(
    'namespaces',
    'unique_namespace_id_tx_id_index_block_hash_microblock_hash',
    'UNIQUE(namespace_id, tx_id, index_block_hash, microblock_hash)'
  );
}
