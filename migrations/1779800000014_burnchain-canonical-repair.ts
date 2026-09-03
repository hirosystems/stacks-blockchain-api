import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * Repairs canonical state for burnchain-level tables and enforces natural-key uniqueness.
 *
 * Historical write paths allowed several kinds of corruption in `burnchain_rewards`,
 * `burn_block_pox_txs` and `reward_slot_holders`:
 *  - duplicate rows from re-delivered `/new_burn_block` events (no unique constraint),
 *  - rows from orphaned burnchain forks left canonical forever,
 *  - canonical flips driven by Stacks-level re-orgs, which don't correspond to burnchain forks, and
 *  - rows above a re-delivered old burn block's height wrongly orphaned (`reward_slot_holders`).
 *
 * The burnchain is linear, so exactly one burn block hash is canonical per height. This migration
 * dedupes rows, recomputes canonical per height (preferring a hash anchored by a canonical Stacks
 * block, falling back to the most recently inserted rows), adds the unique constraints the write
 * path now relies on for idempotency, and reseeds the pox tx counts table.
 */
export const up = (pgm: MigrationBuilder) => {
  // Remove duplicate reward rows from re-delivered events, keeping the latest insert.
  pgm.sql(`
    DELETE FROM burnchain_rewards a
    USING burnchain_rewards b
    WHERE a.burn_block_hash = b.burn_block_hash
      AND a.reward_index = b.reward_index
      AND a.id < b.id
  `);
  // One canonical hash per burn block height. A hash anchored by a canonical Stacks block is proven
  // canonical on the burnchain; otherwise the last-received hash wins, matching the order in which
  // the node announces replacement blocks during a burnchain fork.
  pgm.sql(`
    WITH winners AS (
      SELECT DISTINCT ON (burn_block_height) burn_block_height, burn_block_hash
      FROM burnchain_rewards r
      ORDER BY burn_block_height,
        EXISTS (
          SELECT 1 FROM blocks b
          WHERE b.burn_block_hash = r.burn_block_hash AND b.canonical = true
        ) DESC,
        id DESC
    )
    UPDATE burnchain_rewards r
    SET canonical = (r.burn_block_hash = w.burn_block_hash)
    FROM winners w
    WHERE r.burn_block_height = w.burn_block_height
      AND r.canonical != (r.burn_block_hash = w.burn_block_hash)
  `);
  pgm.addConstraint(
    'burnchain_rewards',
    'burnchain_rewards_unique_idx',
    'UNIQUE(burn_block_hash, reward_index)'
  );
  // Same dedup and per-height repair for reward slot holders. Beyond fork/duplicate damage, this
  // also restores rows the legacy write path wrongly orphaned above a re-delivered old burn block's
  // height. Resolved before pox txs so the shared evidence chain (blocks anchor, then rewards, then
  // slot holders, then a last-resort tie-break) yields one winner per height across all tables.
  pgm.sql(`
    DELETE FROM reward_slot_holders a
    USING reward_slot_holders b
    WHERE a.burn_block_hash = b.burn_block_hash
      AND a.slot_index = b.slot_index
      AND a.id < b.id
  `);
  pgm.sql(`
    WITH winners AS (
      SELECT DISTINCT ON (burn_block_height) burn_block_height, burn_block_hash
      FROM reward_slot_holders s
      ORDER BY burn_block_height,
        EXISTS (
          SELECT 1 FROM blocks b
          WHERE b.burn_block_hash = s.burn_block_hash AND b.canonical = true
        ) DESC,
        EXISTS (
          SELECT 1 FROM burnchain_rewards r
          WHERE r.burn_block_hash = s.burn_block_hash AND r.canonical = true
        ) DESC,
        id DESC
    )
    UPDATE reward_slot_holders s
    SET canonical = (s.burn_block_hash = w.burn_block_hash)
    FROM winners w
    WHERE s.burn_block_height = w.burn_block_height
      AND s.canonical != (s.burn_block_hash = w.burn_block_hash)
  `);
  pgm.addConstraint(
    'reward_slot_holders',
    'reward_slot_holders_unique_idx',
    'UNIQUE(burn_block_hash, slot_index)'
  );
  // Same per-height repair for pox txs, deferring to the tables repaired above so every table
  // crowns the same hash per height. The table has no insert-order column, so the lexicographic
  // tie-break only ever applies when it is the sole table holding rows for a height.
  pgm.sql(`
    WITH winners AS (
      SELECT DISTINCT ON (burn_block_height) burn_block_height, burn_block_hash
      FROM burn_block_pox_txs p
      ORDER BY burn_block_height,
        EXISTS (
          SELECT 1 FROM blocks b
          WHERE b.burn_block_hash = p.burn_block_hash AND b.canonical = true
        ) DESC,
        EXISTS (
          SELECT 1 FROM burnchain_rewards r
          WHERE r.burn_block_hash = p.burn_block_hash AND r.canonical = true
        ) DESC,
        EXISTS (
          SELECT 1 FROM reward_slot_holders s
          WHERE s.burn_block_hash = p.burn_block_hash AND s.canonical = true
        ) DESC,
        burn_block_hash DESC
    )
    UPDATE burn_block_pox_txs p
    SET canonical = (p.burn_block_hash = w.burn_block_hash)
    FROM winners w
    WHERE p.burn_block_height = w.burn_block_height
      AND p.canonical != (p.burn_block_hash = w.burn_block_hash)
  `);
  pgm.sql(`
    DELETE FROM burn_block_pox_tx_counts
  `);
  pgm.sql(`
    INSERT INTO burn_block_pox_tx_counts (recipient, count)
    (SELECT recipient, COUNT(*) AS count FROM burn_block_pox_txs WHERE canonical = true GROUP BY recipient)
  `);
};

export const down = (pgm: MigrationBuilder) => {
  // The data repair is one-way; only the constraints are reversible.
  pgm.dropConstraint('burnchain_rewards', 'burnchain_rewards_unique_idx');
  pgm.dropConstraint('reward_slot_holders', 'reward_slot_holders_unique_idx');
};
