import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Materialized count of canonical `burn_blocks` rows on `chain_tip`, so the paginated
 * `/extended/v3/bitcoin-blocks` list reports its `total` from a single-row lookup instead of a
 * `COUNT(*)` over `burn_blocks` on every request. Burn heights are not guaranteed contiguous
 * (raw-event archives can be partially pruned), so the tip height cannot stand in for it.
 *
 * Maintained incrementally on burn block ingestion, delta-corrected on burnchain forks.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.addColumn('chain_tip', {
    burn_block_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
  });
  pgm.sql(`
    UPDATE chain_tip SET
      burn_block_count = (SELECT COUNT(*) FROM burn_blocks WHERE canonical = true)
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropColumn('chain_tip', 'burn_block_count');
}
