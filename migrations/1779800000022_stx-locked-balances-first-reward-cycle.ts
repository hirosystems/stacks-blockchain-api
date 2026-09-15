import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Backfill: each pox-5 lock's first reward cycle from its staker's latest canonical `stake` /
 * `unstake` event (both carry `first_reward_cycle`; a `stake-update` never changes it). Rows for
 * pox-1..4 locks keep the default 0 — only pox-5 locks are ever read per cycle. Exported so the
 * backfill can be exercised by tests.
 */
export const BACKFILL_STX_LOCK_FIRST_REWARD_CYCLE_SQL = `
  UPDATE stx_locked_balances slb
  SET first_reward_cycle = fc.first_reward_cycle
  FROM (
    SELECT DISTINCT ON (data->>'staker')
      data->>'staker' AS principal,
      (data->>'first_reward_cycle')::int AS first_reward_cycle
    FROM pox5_events
    WHERE canonical = TRUE AND microblock_canonical = TRUE
      AND name IN ('stake', 'unstake')
    ORDER BY data->>'staker',
      block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
  ) fc
  WHERE slb.principal = fc.principal AND slb.pox_version = 5
`;

/**
 * The first PoX reward cycle a materialized pox-5 STX-only lock counts for. A \`stake\` made during
 * cycle N takes effect from N + 1 (the account lock starts immediately, the stake's shares do not),
 * so a cycle's staked STX must exclude locks that began during it. Set from the pox-5 \`stake\` /
 * \`unstake\` events, carried over on \`stake-update\`, and backfilled from \`pox5_events\`. 0 for
 * pox-1..4 locks, which are never read per cycle.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.addColumns('stx_locked_balances', {
    first_reward_cycle: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
  });
  pgm.sql(BACKFILL_STX_LOCK_FIRST_REWARD_CYCLE_SQL);
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropColumns('stx_locked_balances', ['first_reward_cycle']);
}
