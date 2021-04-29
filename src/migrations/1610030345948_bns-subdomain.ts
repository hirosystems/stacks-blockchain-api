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
    zonefile: {
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
    atch_resolved: {
      type: 'boolean',
      notNull: false,
      default: true,
    },
    
  });

  pgm.createIndex('subdomains', 'fully_qualified_subdomain');
  pgm.createIndex('subdomains', 'tx_id');
  pgm.createIndex('subdomains', 'canonical');
  pgm.createIndex('subdomains', 'latest');
  pgm.createIndex('subdomains', 'atch_resolved');
  pgm.createIndex('subdomains', 'resolver');
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('subdomains');
}
