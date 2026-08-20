import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Materialized total liquid STX supply (µSTX) as a single counter on `chain_tip`,
 * so reading the supply is a single-row lookup instead of a full-table aggregate
 * over `stx_events` and `miner_rewards` on every request (what the v1 endpoint
 * does).
 *
 * supply = mints − burns + matured miner coinbase rewards
 *
 * Maintained incrementally on block ingestion and delta-corrected on reorg,
 * mirroring the `ft_balances` 'stx' updates (which cover the same event set).
 */
export function up(pgm: MigrationBuilder): void {
  pgm.addColumn('chain_tip', {
    stx_supply: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
  });
  // One-time backfill from the event tables.
  pgm.sql(`
    UPDATE chain_tip SET stx_supply = (
      SELECT SUM(amount)
      FROM (
          SELECT COALESCE(SUM(amount), 0) amount
          FROM stx_events
          WHERE canonical = true AND microblock_canonical = true
          AND asset_event_type_id = 2 -- Mint
        UNION ALL
          SELECT COALESCE(SUM(amount), 0) * -1 amount
          FROM stx_events
          WHERE canonical = true AND microblock_canonical = true
          AND asset_event_type_id = 3 -- Burn
        UNION ALL
          SELECT COALESCE(SUM(coinbase_amount), 0) amount
          FROM miner_rewards
          WHERE canonical = true
      ) totals
    )
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropColumn('chain_tip', 'stx_supply');
}
