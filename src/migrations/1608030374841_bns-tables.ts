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
      notNull: true,
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
      notNull: true,
    },
    latest: {
      type: 'boolean',
      notNull: true,
      default: true
    }
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
    latest: {
      type: 'boolean',
      notNull: true,
      default: true
    },
  
  });

  pgm.createIndex('names', 'namespace_id');
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('names');
  pgm.dropTable('namespaces');
}
