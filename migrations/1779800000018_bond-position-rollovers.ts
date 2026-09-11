import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Backfill, step 1: drop pox-5 STX-only locks superseded by a later canonical `register-for-bond`
 * (a stake → bond roll-over ingested before the write store mirrored it). Same rule as
 * `recomputeStxLockedBalances`: the staker's latest canonical lock-changing pox-5 event decides.
 * Exported so the backfill can be exercised by tests.
 */
export const BACKFILL_STALE_STX_LOCKS_SQL = `
  DELETE FROM stx_locked_balances slb
  USING (
    SELECT DISTINCT ON (data->>'staker') data->>'staker' AS principal, name
    FROM pox5_events
    WHERE canonical = true AND microblock_canonical = true
      AND name IN ('stake', 'stake-update', 'unstake', 'register-for-bond')
    ORDER BY data->>'staker',
      block_height DESC, microblock_sequence DESC, tx_index DESC, event_index DESC
  ) latest
  WHERE slb.principal = latest.principal
    AND slb.pox_version = 5
    AND latest.name = 'register-for-bond'
`;

/**
 * Backfill, step 2: roll over bond positions superseded by a later canonical roll-over event (a
 * `stake`, or a `register-for-bond` for a different bond) ingested before the write store mirrored
 * it. For each live position the earliest such event after the position's own tx is the roll-over:
 * record it as a `bond_position_rollovers` row (applied), mark the position `rolled_over` with
 * nothing locked, and release its amounts from the bond and principal aggregates — exactly what
 * `applyBondPositionRollovers` does on ingestion. The position's current amounts are the amounts
 * at roll-over time, since the contract rejects registration updates / sBTC unstakes on a replaced
 * membership. Exported so the backfill can be exercised by tests.
 */
export const BACKFILL_BOND_POSITION_ROLLOVERS_SQL = `
  WITH rolled AS (
    SELECT DISTINCT ON (p.principal, p.bond_index)
      p.principal, p.bond_index,
      p.status AS previous_status, p.active AS previous_active,
      p.btc_locked AS released_btc, p.stx_locked AS released_stx,
      e.tx_id, e.tx_index, e.block_height, e.block_hash, e.block_time, e.index_block_hash,
      e.parent_block_hash, e.parent_index_block_hash, e.burn_block_height, e.burn_block_time,
      e.microblock_hash, e.microblock_sequence, e.microblock_canonical, e.canonical
    FROM principal_bond_positions p
    JOIN pox5_events e
      ON e.canonical = true AND e.microblock_canonical = true
      AND e.data->>'staker' = p.principal
      AND (
        e.name = 'stake'
        OR (e.name = 'register-for-bond' AND (e.data->>'bond_index')::int <> p.bond_index)
      )
      AND (e.block_height, e.microblock_sequence, e.tx_index)
        > (p.block_height, p.microblock_sequence, p.tx_index)
    WHERE p.canonical = true AND p.microblock_canonical = true
      AND p.status <> 4 -- DbPrincipalBondPositionStatus.RolledOver
      AND (p.btc_locked > 0 OR p.stx_locked > 0)
    ORDER BY p.principal, p.bond_index,
      e.block_height ASC, e.microblock_sequence ASC, e.tx_index ASC, e.event_index ASC
  ),
  inserted AS (
    INSERT INTO bond_position_rollovers (
      principal, bond_index, previous_status, previous_active, released_btc, released_stx,
      tx_id, tx_index, block_height, block_hash, block_time, index_block_hash,
      parent_block_hash, parent_index_block_hash, burn_block_height, burn_block_time,
      microblock_hash, microblock_sequence, microblock_canonical, canonical
    )
    SELECT
      principal, bond_index, previous_status, previous_active, released_btc, released_stx,
      tx_id, tx_index, block_height, block_hash, block_time, index_block_hash,
      parent_block_hash, parent_index_block_hash, burn_block_height, burn_block_time,
      microblock_hash, microblock_sequence, microblock_canonical, canonical
    FROM rolled
    RETURNING 1
  ),
  positions AS (
    UPDATE principal_bond_positions p
    SET status = 4, active = false, btc_locked = 0, stx_locked = 0
    FROM rolled r
    WHERE p.principal = r.principal AND p.bond_index = r.bond_index
      AND p.canonical = true AND p.microblock_canonical = true
    RETURNING 1
  ),
  bond_changes AS (
    SELECT bond_index, SUM(released_btc) AS btc_change, SUM(released_stx) AS stx_change
    FROM rolled
    GROUP BY bond_index
  ),
  bond_update AS (
    UPDATE bonds b
    SET btc_locked = b.btc_locked - c.btc_change,
      stx_locked = b.stx_locked - c.stx_change
    FROM bond_changes c
    WHERE b.bond_index = c.bond_index
      AND b.canonical = true AND b.microblock_canonical = true
    RETURNING 1
  ),
  principal_changes AS (
    SELECT principal, SUM(released_btc) AS btc_change, SUM(released_stx) AS stx_change
    FROM rolled
    GROUP BY principal
  )
  INSERT INTO principal_staking_totals (principal, bond_btc_locked, bond_stx_locked)
  SELECT principal, -btc_change, -stx_change FROM principal_changes
  ON CONFLICT (principal) DO UPDATE SET
    bond_btc_locked = principal_staking_totals.bond_btc_locked + EXCLUDED.bond_btc_locked,
    bond_stx_locked = principal_staking_totals.bond_stx_locked + EXCLUDED.bond_stx_locked
`;

/**
 * pox-5 bond position roll-overs, one row per bond position a staker rolled out of. pox-5 keeps a
 * staker in exactly one live position: `register-for-bond` replaces any earlier bond membership and
 * `stake` deletes it, with the node carrying the single account lock into the new position. The API
 * mirrors that by marking the earlier `principal_bond_positions` row `rolled_over` and releasing
 * its locked STX/BTC from the bond and principal aggregates.
 *
 * That is an in-place mutation of a row from an older block, which the reorg flip of
 * `principal_bond_positions` (keyed by the row's own `index_block_hash`) cannot undo. These rows
 * are the flag-carrying source behind it: they are flipped by the roll-over tx's block like every
 * other pox-5 source row, and the flip restores the position (from `previous_*` / `released_*`)
 * when the block is orphaned, or applies the roll-over when a side-fork block becomes canonical.
 *
 * `previous_status` is NULL while the roll-over has not been applied to the position (side-fork
 * row, or a position that was not eligible at apply time); `released_*` are 0 in that state.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.createTable('bond_position_rollovers', {
    id: {
      type: 'bigserial',
      primaryKey: true,
    },
    // The staker and the bond position that was rolled out of.
    principal: {
      type: 'text',
      notNull: true,
    },
    bond_index: {
      type: 'integer',
      notNull: true,
    },
    // Position state captured when the roll-over was applied, for restoration on orphan.
    previous_status: {
      type: 'smallint',
    },
    previous_active: {
      type: 'boolean',
    },
    released_btc: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
    released_stx: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
    // The roll-over tx (`register-for-bond` or `stake`).
    tx_id: {
      type: 'bytea',
      notNull: true,
    },
    tx_index: {
      type: 'smallint',
      notNull: true,
    },
    block_height: {
      type: 'integer',
      notNull: true,
    },
    block_hash: {
      type: 'bytea',
    },
    block_time: {
      type: 'bigint',
    },
    index_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    parent_block_hash: {
      type: 'bytea',
    },
    parent_index_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    burn_block_height: {
      type: 'integer',
    },
    burn_block_time: {
      type: 'bigint',
    },
    microblock_hash: {
      type: 'bytea',
      notNull: true,
    },
    microblock_sequence: {
      type: 'integer',
      notNull: true,
    },
    microblock_canonical: {
      type: 'boolean',
      notNull: true,
    },
    canonical: {
      type: 'boolean',
      notNull: true,
    },
  });

  pgm.createIndex('bond_position_rollovers', ['index_block_hash', 'canonical']);
  pgm.createIndex('bond_position_rollovers', ['principal', 'bond_index']);

  // Repair pox-5 state ingested before the write store mirrored roll-overs. One-time pass over the
  // (small) pox-5 tables; a no-op on a fresh database.
  pgm.sql(BACKFILL_STALE_STX_LOCKS_SQL);
  pgm.sql(BACKFILL_BOND_POSITION_ROLLOVERS_SQL);
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable('bond_position_rollovers');
}
