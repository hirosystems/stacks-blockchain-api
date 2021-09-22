/* eslint-disable @typescript-eslint/camelcase */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
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

  pgm.createIndex('subdomains', 'fully_qualified_subdomain');
  pgm.createIndex('subdomains', 'owner');
  pgm.createIndex('subdomains', 'tx_id');
  pgm.createIndex('subdomains', 'canonical');
  pgm.createIndex('subdomains', 'resolver');

  pgm.createIndex('subdomains', 'index_block_hash');
  pgm.createIndex('subdomains', 'parent_index_block_hash');
  pgm.createIndex('subdomains', 'microblock_hash');
  pgm.createIndex('subdomains', 'microblock_canonical');

  pgm.createIndex('subdomains', ['canonical', 'microblock_canonical']);

  pgm.createIndex('subdomains', [
    { name: 'fully_qualified_subdomain' },
    { name: 'canonical', sort: 'DESC' },
    { name: 'microblock_canonical', sort: 'DESC' },
    { name: 'block_height', sort: 'DESC' },
    { name: 'tx_index', sort: 'DESC' },
  ]);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('subdomains');
}
