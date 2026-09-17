import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Split the bond-level BTC reward total into the three figures the pox-5 contract actually
 * distinguishes:
 *
 * - `btc_distributed`: what the contract paid into the bond's reward pool, i.e. the sum of the
 *   `bond-rewards` field of its `bond-distribution` events (`bond_reward_distributions`).
 * - `btc_accrued`: what that pool credited to participants, i.e. the sum of the per-participant
 *   fan-out (`principal_bond_reward_distributions`). Always ≤ `btc_distributed`: each participant's
 *   share is floored to whole sats, so the bond keeps the rounding dust and no staker can ever
 *   claim it.
 * - `btc_claimed`: what participants have actually withdrawn, i.e. the sum of the bond's
 *   `claim-staker-rewards-for-signer` events (`principal_bond_reward_claims`). Always ≤
 *   `btc_accrued`.
 *
 * `btc_claimed` reuses the storage of the old `btc_paid_out` column, which was inert: nothing ever
 * incremented it, so every row held 0 and the API's `balances.paid_out.btc` was uniformly `"0"`.
 * The same dead column on `principal_bond_positions` is dropped outright; that table already
 * carries the live per-position figures in `accrued_rewards` / `claimed_rewards`.
 */
export function up(pgm: MigrationBuilder): void {
  // Inert column, 0 in every row: reuse it rather than adding a fourth.
  pgm.renameColumn('bonds', 'btc_paid_out', 'btc_claimed');
  pgm.addColumns('bonds', {
    btc_distributed: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
    btc_accrued: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
  });
  // Dead since it was added: written as a literal '0' on insert, never updated. The reorg
  // flip-and-delta that fed `bonds.btc_paid_out` from it therefore always applied a 0 delta.
  pgm.dropColumns('principal_bond_positions', ['btc_paid_out']);

  // Backfill all three counters from their canonical source rows. Each source table holds at most
  // one row per bond (or per staker) per distribution, so these are small grouped scans.
  pgm.sql(`
    UPDATE bonds b SET btc_distributed = d.total
    FROM (
      SELECT bond_index, SUM(bond_rewards::numeric) AS total
      FROM bond_reward_distributions
      WHERE canonical = TRUE AND microblock_canonical = TRUE
      GROUP BY bond_index
    ) d
    WHERE b.bond_index = d.bond_index
  `);
  pgm.sql(`
    UPDATE bonds b SET btc_accrued = d.total
    FROM (
      SELECT bond_index, SUM(reward_amount::numeric) AS total
      FROM principal_bond_reward_distributions
      WHERE canonical = TRUE AND microblock_canonical = TRUE
      GROUP BY bond_index
    ) d
    WHERE b.bond_index = d.bond_index
  `);
  pgm.sql(`
    UPDATE bonds b SET btc_claimed = c.total
    FROM (
      SELECT bond_index, SUM(rewards_claimed::numeric) AS total
      FROM principal_bond_reward_claims
      WHERE bond_index IS NOT NULL AND canonical = TRUE AND microblock_canonical = TRUE
      GROUP BY bond_index
    ) c
    WHERE b.bond_index = c.bond_index
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.addColumns('principal_bond_positions', {
    btc_paid_out: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
  });
  pgm.dropColumns('bonds', ['btc_distributed', 'btc_accrued']);
  pgm.renameColumn('bonds', 'btc_claimed', 'btc_paid_out');
  // The restored `bonds.btc_paid_out` keeps its claimed totals rather than reverting to 0; the
  // pre-migration column was inert, so no write path can observe the difference.
}
