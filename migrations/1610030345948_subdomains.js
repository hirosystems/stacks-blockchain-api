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

  pgm.createIndex('subdomains', 'owner', { method: 'hash' });
  pgm.createIndex('subdomains', 'zonefile_hash', { method: 'hash' });
  pgm.createIndex('subdomains', 'fully_qualified_subdomain', { method: 'hash' });
  pgm.createIndex('subdomains', 'index_block_hash', { method: 'hash' });
  pgm.createIndex('subdomains', 'microblock_hash', { method: 'hash' });
  pgm.createIndex('subdomains', [{ name: 'block_height', sort: 'DESC' }]);
}
