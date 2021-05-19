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
    latest: {
      type: 'boolean',
      notNull: true,
      default: true
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
    microblock_canonical: {
      type: 'boolean',
      notNull: true,
    },
  });

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
    zonefile: {
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
    latest: {
      type: 'boolean',
      notNull: true,
      default: true
    },
    tx_id: {
      type: 'bytea',
      notNull: false,
    },
    status:{
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
    microblock_canonical: {
      type: 'boolean',
      notNull: true,
    },
    atch_resolved: {
      type: 'boolean',
      notNull: false,
      default: true,
    },
  });

  pgm.createIndex('names', 'namespace_id');
  pgm.createIndex('names', 'latest');
  pgm.createIndex('names', 'canonical');
  pgm.createIndex('names', 'zonefile_hash');
  pgm.createIndex('names', 'tx_id');
  pgm.createIndex('names', 'index_block_hash');
  pgm.createIndex('names', 'parent_index_block_hash');
  pgm.createIndex('names', 'microblock_hash');
  pgm.createIndex('names', 'microblock_canonical');
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('names');
  pgm.dropTable('namespaces');
}
