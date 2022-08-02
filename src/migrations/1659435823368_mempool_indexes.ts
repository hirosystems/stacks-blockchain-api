import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createIndex('mempool_txs', [{ name: 'fee_rate', sort: 'DESC' }]);
  pgm.createIndex('mempool_txs', 'pruned');
}
