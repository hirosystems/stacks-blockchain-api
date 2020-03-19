import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('txs', {
    tx_id: {
      primaryKey: true,
      type: 'bytea',
    },
    block_hash: {
      notNull: true,
      type: 'bytea'
    },
    tx_type: {
      notNull: true,
      type: 'smallint',
    },
    raw_tx: {
      notNull: true,
      type: 'bytea'
    }
  });
  pgm.createIndex('txs', 'block_hash')
  pgm.createIndex('txs', 'tx_type');
}

/*
export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('txs');
}
*/
