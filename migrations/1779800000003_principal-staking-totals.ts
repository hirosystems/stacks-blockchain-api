import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Materialized per-principal staking summary — one row per principal, holding
 * every total the staking-summary endpoint needs so it's a single-row lookup
 * rather than an on-read aggregate. Maintained incrementally on write (and
 * delta-corrected on reorg), like `ft_balances`:
 *
 *  - `stx_*` columns: the principal's pox-5 STX-staking sBTC rewards, fed by
 *    `principal_stx_reward_distributions` (accruals) and the NULL-`bond_index`
 *    rows of `principal_bond_reward_claims` (claims).
 *  - `bond_*` columns: a rollup of the principal's `principal_bond_positions`
 *    rows (count + summed locked amounts and sBTC rewards) — the per-principal
 *    analogue of the per-bond totals on the `bonds` table.
 *
 * The pox-5 STX *locked* amount is not materialized here: it depends on the
 * current burn height (expiry) with no event firing at expiry, so it stays
 * resolved-on-read from `stx_locked_balances`.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.createTable('principal_staking_totals', {
    principal: {
      type: 'text',
      notNull: true,
      primaryKey: true,
    },
    // STX-staking sBTC reward totals.
    stx_accrued_rewards: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
    stx_claimed_rewards: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
    // Rollup of the principal's bond positions.
    bond_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    bond_btc_locked: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
    bond_stx_locked: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
    bond_accrued_rewards: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
    bond_claimed_rewards: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable('principal_staking_totals');
}
