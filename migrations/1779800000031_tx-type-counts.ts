import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Supports the `type` filter on `/extended/v3/transactions`.
 *
 * `tx_type_counts` materializes the number of canonical transactions per `type_id`, so a
 * type-filtered list reports its `total` by summing a handful of rows instead of a `COUNT(*)` over
 * `txs`. Maintained on block ingestion and delta-corrected on re-orgs, alongside
 * `chain_tip.tx_count`. Unlike `tx_count`, it also counts the genesis boot transactions that block 1
 * adopts from block 0, so its rows match a `COUNT(*)` of canonical `txs` exactly.
 *
 * The index lets each requested type be paged in canonical order without walking past the rows of
 * every other type, which matters for rare types like `smart_contract`.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.createTable('tx_type_counts', {
    type_id: {
      type: 'smallint',
      primaryKey: true,
    },
    count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
  });
  pgm.sql(`
    INSERT INTO tx_type_counts (type_id, count)
    SELECT type_id, COUNT(*)
    FROM txs
    WHERE canonical = true AND microblock_canonical = true
    GROUP BY type_id
  `);
  pgm.createIndex(
    'txs',
    [
      'type_id',
      { name: 'block_height', sort: 'DESC' },
      { name: 'microblock_sequence', sort: 'DESC' },
      { name: 'tx_index', sort: 'DESC' },
    ],
    {
      name: 'txs_type_id_canonical_order_index',
      where: 'canonical = true AND microblock_canonical = true',
    }
  );
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropIndex('txs', [], { name: 'txs_type_id_canonical_order_index' });
  pgm.dropTable('tx_type_counts');
}
