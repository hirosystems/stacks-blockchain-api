import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Re-keys the sponsor indexes on `txs` and `mempool_txs` from `(sponsor_address, nonce)` to
 * `(sponsor_address, sponsor_nonce)`.
 *
 * A sponsored transaction consumes two account nonces: its origin's `nonce` and its sponsor's
 * `sponsor_nonce`. Replace-by-fee detection and mempool pruning/restoring look up conflicting
 * transactions by the sponsor's nonce slot, which the old index could only serve as a scan over
 * every transaction the sponsor ever paid for (its `nonce` column is the origin's nonce, not the
 * sponsor's). Every other query over these indexes filters by `sponsor_address` alone or reads
 * `MAX(sponsor_nonce)`, which the new key serves at least as well, so the old indexes are replaced
 * rather than kept alongside: index count and write-path cost are unchanged.
 *
 * The partial predicates are kept as they were. `mempool_txs` is small enough to index in full; the
 * `txs` index only covers canonical sponsored transactions, a small share of the table.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.dropIndex('txs', ['sponsor_address', 'nonce']);
  pgm.createIndex('txs', ['sponsor_address', 'sponsor_nonce'], {
    where: 'sponsor_address IS NOT NULL AND canonical = true AND microblock_canonical = true',
  });
  pgm.dropIndex('mempool_txs', ['sponsor_address', 'nonce']);
  pgm.createIndex('mempool_txs', ['sponsor_address', 'sponsor_nonce']);
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropIndex('mempool_txs', ['sponsor_address', 'sponsor_nonce']);
  pgm.createIndex('mempool_txs', ['sponsor_address', 'nonce']);
  pgm.dropIndex('txs', ['sponsor_address', 'sponsor_nonce']);
  pgm.createIndex('txs', ['sponsor_address', 'nonce'], {
    where: 'sponsor_address IS NOT NULL AND canonical = true AND microblock_canonical = true',
  });
}
