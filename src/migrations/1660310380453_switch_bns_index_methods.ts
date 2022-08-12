/* eslint-disable @typescript-eslint/naming-convention */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.dropIndex('subdomains', 'owner');
  pgm.dropIndex('subdomains', 'zonefile_hash');
  pgm.dropIndex('subdomains', 'fully_qualified_subdomain');
  pgm.dropIndex('subdomains', 'index_block_hash');
  pgm.dropIndex('subdomains', 'microblock_hash');
  pgm.dropIndex('zonefiles', 'zonefile_hash');
  pgm.dropIndex('names', 'tx_id');
  pgm.dropIndex('names', 'name');
  pgm.dropIndex('names', 'index_block_hash');
  pgm.dropIndex('names', 'microblock_hash');
  pgm.dropIndex('namespaces', 'index_block_hash');
  pgm.dropIndex('namespaces', 'microblock_hash');

  pgm.createIndex('subdomains', 'owner');
  pgm.createIndex('subdomains', 'zonefile_hash');
  pgm.createIndex('subdomains', 'fully_qualified_subdomain');
  pgm.createIndex('subdomains', 'index_block_hash');
  pgm.createIndex('subdomains', 'microblock_hash');
  pgm.createIndex('zonefiles', 'zonefile_hash');
  pgm.createIndex('names', 'tx_id');
  pgm.createIndex('names', 'name');
  pgm.createIndex('names', 'index_block_hash');
  pgm.createIndex('names', 'microblock_hash');
  pgm.createIndex('namespaces', 'index_block_hash');
  pgm.createIndex('namespaces', 'microblock_hash');

  pgm.createIndex('mempool_txs', 'receipt_block_height');
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropIndex('subdomains', 'owner');
  pgm.dropIndex('subdomains', 'zonefile_hash');
  pgm.dropIndex('subdomains', 'fully_qualified_subdomain');
  pgm.dropIndex('subdomains', 'index_block_hash');
  pgm.dropIndex('subdomains', 'microblock_hash');
  pgm.dropIndex('zonefiles', 'zonefile_hash');
  pgm.dropIndex('names', 'tx_id');
  pgm.dropIndex('names', 'name');
  pgm.dropIndex('names', 'index_block_hash');
  pgm.dropIndex('names', 'microblock_hash');
  pgm.dropIndex('namespaces', 'index_block_hash');
  pgm.dropIndex('namespaces', 'microblock_hash');
  pgm.dropIndex('mempool_txs', 'receipt_block_height');

  pgm.createIndex('subdomains', 'owner', { method: 'hash' });
  pgm.createIndex('subdomains', 'zonefile_hash', { method: 'hash' });
  pgm.createIndex('subdomains', 'fully_qualified_subdomain', { method: 'hash' });
  pgm.createIndex('subdomains', 'index_block_hash', { method: 'hash' });
  pgm.createIndex('subdomains', 'microblock_hash', { method: 'hash' });
  pgm.createIndex('zonefiles', 'zonefile_hash', { method: 'hash' });
  pgm.createIndex('names', 'tx_id', { method: 'hash' });
  pgm.createIndex('names', 'name', { method: 'hash' });
  pgm.createIndex('names', 'index_block_hash', { method: 'hash' });
  pgm.createIndex('names', 'microblock_hash', { method: 'hash' });
  pgm.createIndex('namespaces', 'index_block_hash', { method: 'hash' });
  pgm.createIndex('namespaces', 'microblock_hash', { method: 'hash' });
}
