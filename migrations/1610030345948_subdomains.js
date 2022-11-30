/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.createTable('subdomains', {
    id: {
      type: 'serial',
      primaryKey: true,
    },
    name: {
      type: 'string',
      notNull: true,
    },
    namespace_id: {
      type: 'string',
      notNull: true
    },
    fully_qualified_subdomain: {
      type: 'string',
      notNull: true
    },
    owner: {
      type: 'string',
      notNull: true,
    },
    zonefile_hash: {
      type: 'string',
      notNull: true,
    },
    parent_zonefile_hash: {
      type: 'string',
      notNull: true,
    },
    parent_zonefile_index: {
      type: 'integer',
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
    zonefile_offset: {
      type: 'integer',
      notNull: false,
    },
    resolver: {
      type: 'string',
      notNull: false,
    },
    tx_id: {
      type: 'bytea',
      notNull: false,
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

  pgm.createIndex('subdomains', 'name');
  pgm.createIndex('subdomains', 'index_block_hash');
  pgm.createIndex('subdomains', [
    { name: 'block_height', sort: 'DESC' },
    { name: 'microblock_sequence', sort: 'DESC' },
    { name: 'tx_index', sort: 'DESC' },
  ]);
  pgm.addConstraint(
    'subdomains',
    'unique_fqs_tx_id_index_block_hash_microblock_hash',
    'UNIQUE(fully_qualified_subdomain, tx_id, index_block_hash, microblock_hash)'
  );
}
