import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.addColumn('mempool_txs', {
    tx_size: {
      type: 'integer',
      notNull: true,
      expressionGenerated: 'length(raw_tx)'
    }
  });

  pgm.createIndex('mempool_txs', ['type_id', 'receipt_block_height'], { where: 'pruned = false'});
  pgm.createIndex('mempool_txs', ['type_id', 'fee_rate'], { where: 'pruned = false'});
  pgm.createIndex('mempool_txs', ['type_id', 'tx_size'], { where: 'pruned = false'});

}
