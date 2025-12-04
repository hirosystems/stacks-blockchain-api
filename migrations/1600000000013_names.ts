import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
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
      type: 'string',
    },
    grace_period: {
      type: 'string',
    },
    renewal_deadline: {
      type: 'integer',
    },
    resolver: {
      type: 'string',
    },
    tx_id: {
      type: 'bytea',
    },
    tx_index: {
      type: 'smallint',
      notNull: true,
    },
    event_index: {
      type: 'integer',
    },
    status: {
      type: 'string',
    },
    canonical: {
      type: 'boolean',
      default: true,
    },
    index_block_hash: {
      type: 'bytea',
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
  pgm.createIndex('names', ['index_block_hash', 'canonical']);
  pgm.createIndex('names', [
    { name: 'registered_at', sort: 'DESC' },
    { name: 'microblock_sequence', sort: 'DESC' },
    { name: 'tx_index', sort: 'DESC' },
    { name: 'event_index', sort: 'DESC' },
  ]);
  pgm.addConstraint(
    'names',
    'unique_name_tx_id_index_block_hash_microblock_hash_event_index',
    'UNIQUE(name, tx_id, index_block_hash, microblock_hash, event_index)'
  );
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('names');
}
