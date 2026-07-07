import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Materialized current STX lock state, one row per principal — so a principal's
 * locked balance is a single-row lookup instead of recomputing it from the
 * latest applicable lock event across pox versions on every read.
 *
 * Locked STX is NOT additive: every lock/stake event carries an absolute
 * `locked_amount` + `unlock_burn_height`, a principal has at most one active
 * lock at a time, and a lock auto-expires once the burn height reaches
 * `unlock_burn_height` (no event fires at expiry). So this table is a
 * "latest lock state per principal" (SET/replace), read with a height
 * comparison:
 *   locked = (current_burn_height < unlock_burn_height
 *             AND force-unlock for `pox_version` not yet reached) ? locked_amount : 0
 *
 * Maintained on write from pox-4 lock events and pox-5 stake/stake-update/
 * unstake events; recomputed for affected principals on reorg.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.createTable('stx_locked_balances', {
    // One active lock per principal.
    principal: {
      type: 'text',
      notNull: true,
      primaryKey: true,
    },
    // Locked µSTX from the latest lock event.
    locked_amount: {
      type: 'numeric',
      notNull: true,
    },
    // Burn height at which the lock expires (locked is 0 once reached).
    unlock_burn_height: {
      type: 'bigint',
      notNull: true,
    },
    // Which pox contract set this lock (e.g. 4, 5) — needed to apply the
    // per-version force-unlock heights (e.g. `pox_v4_unlock_height`).
    pox_version: {
      type: 'smallint',
      notNull: true,
    },
    // Lock provenance, materialized so the balance response needs no extra query.
    lock_tx_id: {
      type: 'bytea',
      notNull: true,
    },
    // Stacks block height where the lock was created.
    lock_block_height: {
      type: 'integer',
      notNull: true,
    },
    // Burn height where the lock was created.
    burnchain_lock_height: {
      type: 'bigint',
      notNull: true,
    },
  });

  // Supports "who is still locked at burn height H" style scans.
  pgm.createIndex('stx_locked_balances', 'unlock_burn_height');

  // Backfill the table from existing pox-1..4 lock events (pox-5 locks are
  // materialized by the synthetic stake/unstake handlers, so they're excluded
  // here). For each principal, take their latest canonical lock event and keep
  // it only if the lock is still active (positive amount, unlock height beyond
  // the current canonical burn tip). This is a no-op on a fresh database.
  pgm.sql(`
    INSERT INTO stx_locked_balances (
      principal, locked_amount, unlock_burn_height, pox_version,
      lock_tx_id, lock_block_height, burnchain_lock_height
    )
    SELECT DISTINCT ON (e.locked_address)
      e.locked_address,
      e.locked_amount,
      e.unlock_height,
      CASE e.contract_name
        WHEN 'pox' THEN 1
        WHEN 'pox-2' THEN 2
        WHEN 'pox-3' THEN 3
        WHEN 'pox-4' THEN 4
        ELSE 0
      END AS pox_version,
      e.tx_id,
      e.block_height,
      b.burn_block_height
    FROM stx_lock_events e
    JOIN blocks b ON b.index_block_hash = e.index_block_hash
    WHERE e.canonical = true
      AND e.microblock_canonical = true
      AND e.contract_name <> 'pox-5'
      AND e.locked_amount > 0
      AND e.unlock_height > (
        SELECT COALESCE(MAX(burn_block_height), 0) FROM blocks WHERE canonical = true
      )
    ORDER BY
      e.locked_address,
      e.block_height DESC,
      e.microblock_sequence DESC,
      e.tx_index DESC,
      e.event_index DESC
  `);
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable('stx_locked_balances');
}
