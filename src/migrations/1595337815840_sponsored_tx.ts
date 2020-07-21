import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumn('txs', {
    sponsor_address: {
      type: 'string'
    },
  });
  pgm.addColumn('mempool_txs', {
    sponsor_address: {
      type: 'string'
    },
  });

  pgm.addIndex('txs', 'sponsor_address');
  pgm.addIndex('mempool_txs', 'sponsor_address');
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropIndex('txs', 'sponsor_address');
  pgm.dropIndex('mempool_txs', 'sponsor_address');

  pgm.dropColumn('txs', 'sponsor_address');
  pgm.dropColumn('mempool_txs', 'sponsor_address');
}
