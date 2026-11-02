import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * Supports `sort_by=fee` on `/extended/v3/mempool/transactions`, which keyset-paginates pending
 * transactions by `(fee_rate, tx_id)` descending. Partial like the `(receipt_time, tx_id)` index
 * that backs the default order, so pruned rows never enter it.
 */
export const up = (pgm: MigrationBuilder) => {
  pgm.createIndex(
    'mempool_txs',
    [
      { name: 'fee_rate', sort: 'DESC' },
      { name: 'tx_id', sort: 'DESC' },
    ],
    {
      name: 'mempool_txs_unpruned_fee_rate_tx_id_idx',
      where: 'pruned = FALSE',
    }
  );
};

export const down = (pgm: MigrationBuilder) => {
  pgm.dropIndex('mempool_txs', [], { name: 'mempool_txs_unpruned_fee_rate_tx_id_idx' });
};
