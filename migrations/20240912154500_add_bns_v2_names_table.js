/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.createTable('names_v2', {
    id: {
      type: 'serial',
      primaryKey: true,
    },
    fullName: {
      type: 'string',
      notNull: true,
    },
    name: {
      type: 'string',
      notNull: true,
    },
    namespace_id: {
      type: 'string',
      notNull: true,
    },
    registered_at: {
      type: 'integer',
      notNull: false,
    },
    imported_at: {
      type: 'integer',
      notNull: false,
    },
    hashed_salted_fqn_preorder: {
      type: 'string',
      notNull: false,
    },
    preordered_by: {
      type: 'string',
      notNull: false,
    },
    renewal_height: {
      type: 'integer',
      notNull: true,
    },
    stx_burn: {
      type: 'bigint',
      notNull: true,
    },
    owner: {
      type: 'string',
      notNull: true,
    },
    tx_id: {
      type: 'bytea',
      notNull: true,
    },
    tx_index: {
      type: 'smallint',
      notNull: true,
    },
    event_index: 'integer',
    status: {
      type: 'string',
      notNull: false,
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

  pgm.createIndex('names_v2', 'namespace_id');
  pgm.createIndex('names_v2', 'index_block_hash');
  pgm.createIndex('names_v2', [
    { name: 'registered_at', sort: 'DESC' },
    { name: 'microblock_sequence', sort: 'DESC' },
    { name: 'tx_index', sort: 'DESC' },
    { name: 'event_index', sort: 'DESC' },
  ]);
  pgm.addConstraint(
    'names_v2',
    'unique_name_v2_tx_id_index_block_hash_microblock_hash_event_index',
    'UNIQUE(fullName, tx_id, index_block_hash, microblock_hash, event_index)'
  );
  pgm.addConstraint('names_v2', 'unique_fullname', 'UNIQUE(fullName)');
};

exports.down = pgm => {
  pgm.dropTable('names_v2');
};
