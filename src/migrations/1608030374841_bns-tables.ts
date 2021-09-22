import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
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
      type: 'integer',
      notNull: true,
    },
    coeff: {
      type: 'integer',
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

  pgm.createIndex('namespaces', 'namespace_id');
  pgm.createIndex('namespaces', 'ready_block');
  pgm.createIndex('namespaces', 'microblock_hash');
  pgm.createIndex('namespaces', 'microblock_canonical');
  pgm.createIndex('namespaces', 'canonical');
  pgm.createIndex('namespaces', [
    { name: 'namespace_id' },
    { name: 'canonical', sort: 'DESC' },
    { name: 'microblock_canonical', sort: 'DESC' },
    { name: 'ready_block', sort: 'DESC' },
    { name: 'tx_index', sort: 'DESC' },
  ]);
  
  pgm.createTable('names', {
    id: {
      type: 'serial',
      primaryKey: true,
    },
    name: {
      type: 'string',
      notNull: true,
    },
    address: {
      type: 'string',
      notNull: true,
    },
    registered_at: {
      type: 'integer',
      notNull: true,
    },
    expire_block: {
      type: 'integer',
      notNull: true,
    },
    zonefile_hash: {
      type: 'string',
      notNull: true,
    },
    namespace_id: {
      notNull: true,
      type: 'string'
    },
    grace_period: {
      type: 'string',
      notNull: false,
    },
    renewal_deadline: {
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
    tx_index: {
      type: 'smallint',
      notNull: true,
    },
    status: {
      type: 'string',
      notNull: false
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

  pgm.createIndex('names', 'namespace_id');
  pgm.createIndex('names', 'canonical');
  pgm.createIndex('names', 'zonefile_hash');
  pgm.createIndex('names', 'registered_at');
  pgm.createIndex('names', 'tx_id');
  pgm.createIndex('names', 'tx_index');
  pgm.createIndex('names', 'index_block_hash');
  pgm.createIndex('names', 'parent_index_block_hash');
  pgm.createIndex('names', 'microblock_hash');
  pgm.createIndex('names', 'microblock_canonical');
  pgm.createIndex('names', [
    { name: 'name' },
    { name: 'canonical', sort: 'DESC' },
    { name: 'microblock_canonical', sort: 'DESC' },
    { name: 'registered_at', sort: 'DESC' },
    { name: 'tx_index', sort: 'DESC' },
  ]);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('names');
  pgm.dropTable('namespaces');
}
