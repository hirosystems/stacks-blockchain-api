import type { MigrationBuilder } from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder) => {
  pgm.createIndex(
    'mempool_txs',
    [
      { name: 'receipt_time', sort: 'DESC' },
      { name: 'tx_id', sort: 'DESC' },
    ],
    {
      name: 'mempool_txs_unpruned_receipt_time_tx_id_idx',
      where: 'pruned = FALSE',
    }
  );
};

export const down = (pgm: MigrationBuilder) => {
  pgm.dropIndex('mempool_txs', [], { name: 'mempool_txs_unpruned_receipt_time_tx_id_idx' });
};
