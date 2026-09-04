import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Materialized network-wide staking reward totals as counters on `chain_tip`, so the
 * `/extended/v3/staking/rewards` endpoint is a single-row lookup instead of full-table aggregates
 * over `burn_blocks` on every request (the `stx_supply` pattern).
 *
 *  - `staking_reward_amount`: sats of staking rewards generated across all history, counted on the
 *    funding side: BTC paid by block commits to reward recipients. Through pox-4 those are the
 *    stacker reward addresses directly; from pox-5 on it is the sBTC peg custody address, whose
 *    inflows fund the sBTC staking rewards distributed through the pox-5 contract.
 *  - `staking_burn_amount`: sats burned by block commits across all history.
 *
 * Maintained incrementally on burn block ingestion, delta-corrected on burnchain forks.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.addColumn('chain_tip', {
    staking_reward_amount: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
    staking_burn_amount: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
  });
  pgm.sql(`
    UPDATE chain_tip SET
      staking_reward_amount = (
        SELECT COALESCE(SUM(reward_amount), 0) FROM burn_blocks WHERE canonical = true
      ),
      staking_burn_amount = (
        SELECT COALESCE(SUM(burn_amount), 0) FROM burn_blocks WHERE canonical = true
      )
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropColumn('chain_tip', 'staking_reward_amount');
  pgm.dropColumn('chain_tip', 'staking_burn_amount');
}
