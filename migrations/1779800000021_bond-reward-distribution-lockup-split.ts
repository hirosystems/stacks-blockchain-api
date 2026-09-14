import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Backfill: rebuild every distribution's lockup split from the canonical pox-5 events that precede
 * its transaction (side-fork rows are rebuilt from the canonical history too, the best available
 * approximation of what their own fork held). A participant's BTC in a bond at a point in time is
 * decided by their latest earlier event: `register-for-bond` for the bond (`sats_total`),
 * `update-bond-registration` (`amount_sats`), `unstake-sbtc` (`new_amount_sats`), or a roll-over
 * out of the bond via `stake` or a `register-for-bond` for a different bond (0). The lockup type
 * comes from the participant's latest `register-for-bond` for the bond (`btc_lockup.type`: `l1`
 * native, `l2` sBTC). Rows whose bond has no participants get 0 / 0. Exported so the backfill can
 * be exercised by tests.
 */
export const BACKFILL_DISTRIBUTION_LOCKUP_SPLIT_SQL = `
  WITH split AS (
    SELECT
      d.tx_id, d.index_block_hash, d.bond_index,
      COALESCE(SUM(CASE WHEN p.lockup = 'l1' THEN p.sats ELSE 0 END), 0) AS native_staked_sats,
      COALESCE(SUM(CASE WHEN p.lockup = 'l2' THEN p.sats ELSE 0 END), 0) AS sbtc_staked_sats
    FROM bond_reward_distributions d
    LEFT JOIN LATERAL (
      SELECT reg.staker, reg.lockup, COALESCE(latest.sats, 0) AS sats
      FROM (
        -- Each participant's latest registration for this bond before the distribution's tx.
        SELECT DISTINCT ON (e.data->>'staker')
          e.data->>'staker' AS staker,
          e.data->'btc_lockup'->>'type' AS lockup
        FROM pox5_events e
        WHERE e.canonical = TRUE AND e.microblock_canonical = TRUE
          AND e.name = 'register-for-bond'
          AND (e.data->>'bond_index')::int = d.bond_index
          AND (e.block_height, e.microblock_sequence, e.tx_index)
            < (d.block_height, d.microblock_sequence, d.tx_index)
        ORDER BY e.data->>'staker',
          e.block_height DESC, e.microblock_sequence DESC, e.tx_index DESC, e.event_index DESC
      ) reg
      LEFT JOIN LATERAL (
        -- The participant's latest BTC-changing event for this bond before the distribution's tx.
        SELECT
          CASE e.name
            WHEN 'register-for-bond' THEN
              CASE WHEN (e.data->>'bond_index')::int = d.bond_index
                THEN (e.data->>'sats_total')::numeric ELSE 0 END
            WHEN 'update-bond-registration' THEN (e.data->>'amount_sats')::numeric
            WHEN 'unstake-sbtc' THEN (e.data->>'new_amount_sats')::numeric
            WHEN 'stake' THEN 0
          END AS sats
        FROM pox5_events e
        WHERE e.canonical = TRUE AND e.microblock_canonical = TRUE
          AND e.data->>'staker' = reg.staker
          AND (
            e.name IN ('stake', 'register-for-bond')
            OR (
              e.name IN ('update-bond-registration', 'unstake-sbtc')
              AND (e.data->>'bond_index')::int = d.bond_index
            )
          )
          AND (e.block_height, e.microblock_sequence, e.tx_index)
            < (d.block_height, d.microblock_sequence, d.tx_index)
        ORDER BY e.block_height DESC, e.microblock_sequence DESC, e.tx_index DESC, e.event_index DESC
        LIMIT 1
      ) latest ON TRUE
    ) p ON TRUE
    GROUP BY d.tx_id, d.index_block_hash, d.bond_index
  )
  UPDATE bond_reward_distributions d
  SET native_staked_sats = s.native_staked_sats,
    sbtc_staked_sats = s.sbtc_staked_sats
  FROM split s
  WHERE d.tx_id = s.tx_id AND d.index_block_hash = s.index_block_hash
    AND d.bond_index = s.bond_index
`;

/**
 * Snapshot of how a bond's staked BTC was locked at each reward distribution: proven Bitcoin L1
 * lockups (`native_staked_sats`) vs sBTC lockups (`sbtc_staked_sats`), summed from the bond's
 * positions when the `bond-distribution` event is ingested. The contract reports only the bond's
 * total (`bond_staked_sats`) per distribution; this split lets a finished cycle report native vs
 * sBTC from the same snapshot as its total. Existing rows are backfilled from `pox5_events`.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.addColumns('bond_reward_distributions', {
    native_staked_sats: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
    sbtc_staked_sats: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
  });
  // Every existing row gets its real split from the event history (see above).
  pgm.sql(BACKFILL_DISTRIBUTION_LOCKUP_SPLIT_SQL);
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropColumns('bond_reward_distributions', ['native_staked_sats', 'sbtc_staked_sats']);
}
