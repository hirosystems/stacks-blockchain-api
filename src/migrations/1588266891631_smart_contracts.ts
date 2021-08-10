import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

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
    source_code: {
      type: 'string',
      notNull: true,
    },
    abi: {
      type: 'string',
      notNull: true,
    },
  });

  pgm.createIndex('smart_contracts', 'tx_id');
  pgm.createIndex('smart_contracts', 'block_height');
  pgm.createIndex('smart_contracts', 'index_block_hash');
  pgm.createIndex('smart_contracts', 'canonical');
  pgm.createIndex('smart_contracts', 'contract_id');

}
