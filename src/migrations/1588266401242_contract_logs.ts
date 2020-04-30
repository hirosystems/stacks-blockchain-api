import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('contract_logs', {
    id: 'serial',
    event_index: {
      type: 'integer',
      notNull: true,
    },
    tx_id: {
      notNull: true,
      type: 'bytea',
    },
    block_height: {
      type: 'integer',
      notNull: true,
    },
    canonical: {
      type: 'boolean',
      notNull: true,
    },
    contract_identifier: {
      type: 'string',
      notNull: true,
    },
    topic: {
      type: 'string',
      notNull: true,
    },
    value: {
      type: 'bytea',
      notNull: true,
    },
  });

  pgm.createIndex('contract_logs', 'tx_id');
  pgm.createIndex('contract_logs', 'block_height');
  pgm.createIndex('contract_logs', 'canonical');
  pgm.createIndex('contract_logs', 'contract_identifier');

}

/*
export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('txs');
}
*/
