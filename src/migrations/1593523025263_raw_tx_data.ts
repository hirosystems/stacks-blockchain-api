import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  /*
  pgm.createTable('proxied_txs', {
    id: {
      type: 'serial',
      primaryKey: true,
    },
    time_received: {
      type: 'timestamp',
      notNull: true,
    },
    raw_tx: {
      type: 'bytea',
      notNull: true,
    },
  });
  */

  pgm.addColumn('txs', {
    raw_tx: {
      type: 'bytea',
      notNull: true,
      default: '\\x', // default to empty byte array
    },
  });

  pgm.addColumn('mempool_txs', {
    raw_tx: {
      type: 'bytea',
      notNull: true,
      default: '\\x', // default to empty byte array
    },
    receipt_time: {
      type: 'int',
      notNull: true,
    },
  });

  pgm.addIndex('mempool_txs', 'receipt_time');
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  // pgm.dropTable('proxied_txs');
  pgm.dropColumn('txs', 'raw_tx');

  pgm.dropIndex('mempool_txs', 'receipt_time');
  pgm.dropColumn('mempool_txs', ['raw_tx', 'receipt_time']);
}
