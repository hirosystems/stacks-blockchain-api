import {  MigrationBuilder } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('smart_contracts', {
    id: {
      type: 'serial',
      primaryKey: true,
    },
    tx_id: {
      type: 'bytea',
      notNull: true,
    },
    canonical: {
      type: 'boolean',
      notNull: true,
    },
    contract_id: {
      type: 'string',
      notNull: true,
    },
    block_height: {
      type: 'integer',
      notNull: true,
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
    source_code: {
      type: 'string',
      notNull: true,
    },
    abi: {
      type: 'jsonb',
      notNull: true,
    },
  });

  pgm.createIndex('smart_contracts', 'tx_id');
  pgm.createIndex('smart_contracts', 'block_height');
  pgm.createIndex('smart_contracts', 'index_block_hash');
  pgm.createIndex('smart_contracts', 'parent_index_block_hash');
  pgm.createIndex('smart_contracts', 'microblock_hash');
  pgm.createIndex('smart_contracts', 'microblock_sequence');
  pgm.createIndex('smart_contracts', 'microblock_canonical');
  pgm.createIndex('smart_contracts', 'canonical');
  pgm.createIndex('smart_contracts', 'contract_id');
  
  pgm.createIndex('smart_contracts', 'abi', { method: 'gin' });

  pgm.createIndex('smart_contracts', [
    { name: 'contract_id', sort: 'DESC' },
    { name: 'canonical', sort: 'DESC' },
    { name: 'microblock_canonical', sort: 'DESC' },
    { name: 'block_height', sort: 'DESC' }
  ]);
  
}
