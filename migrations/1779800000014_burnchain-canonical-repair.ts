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
  pgm.addConstraint(
    'burnchain_rewards',
    'burnchain_rewards_unique_idx',
    'UNIQUE(burn_block_hash, reward_index)'
  );
  // Same dedup for reward slot holders.
  pgm.sql(`
    DELETE FROM reward_slot_holders a
    USING reward_slot_holders b
    WHERE a.burn_block_hash = b.burn_block_hash
      AND a.slot_index = b.slot_index
      AND a.id < b.id
  `);
  pgm.addConstraint(
    'reward_slot_holders',
    'reward_slot_holders_unique_idx',
    'UNIQUE(burn_block_hash, slot_index)'
  );
  // One shared winner per burn block height, computed over the union of every hash any burnchain
  // table has seen -- a hash present in only one table must still compete at its height, or tables
  // could each crown their own only-candidate and diverge. Evidence order: a canonical Stacks block
  // anchor is proof; otherwise arrival order in `burnchain_rewards`, then in `reward_slot_holders`
  // (the tables with insert-order ids); a lexicographic tie-break is the last resort for hashes
  // seen only by `burn_block_pox_txs`. Applied uniformly to all three tables below.
  pgm.sql(`
    CREATE TEMPORARY TABLE burnchain_canonical_winners AS
    WITH candidates AS (
      SELECT burn_block_height, burn_block_hash, MAX(id) AS max_reward_id, NULL::int AS max_slot_id
      FROM burnchain_rewards GROUP BY 1, 2
      UNION ALL
      SELECT burn_block_height, burn_block_hash, NULL, MAX(id)
      FROM reward_slot_holders GROUP BY 1, 2
      UNION ALL
      SELECT burn_block_height, burn_block_hash, NULL, NULL
      FROM burn_block_pox_txs GROUP BY 1, 2
    ),
    merged AS (
      SELECT burn_block_height, burn_block_hash,
        MAX(max_reward_id) AS max_reward_id,
        MAX(max_slot_id) AS max_slot_id
      FROM candidates GROUP BY 1, 2
    )
    SELECT DISTINCT ON (burn_block_height) burn_block_height, burn_block_hash
    FROM merged m
    ORDER BY burn_block_height,
      EXISTS (
        SELECT 1 FROM blocks b
        WHERE b.burn_block_hash = m.burn_block_hash AND b.canonical = true
      ) DESC,
      max_reward_id DESC NULLS LAST,
      max_slot_id DESC NULLS LAST,
      burn_block_hash DESC
  `);
  pgm.sql(`
    UPDATE burnchain_rewards r
    SET canonical = (r.burn_block_hash = w.burn_block_hash)
    FROM burnchain_canonical_winners w
    WHERE r.burn_block_height = w.burn_block_height
      AND r.canonical != (r.burn_block_hash = w.burn_block_hash)
  `);
  pgm.sql(`
    UPDATE reward_slot_holders s
    SET canonical = (s.burn_block_hash = w.burn_block_hash)
    FROM burnchain_canonical_winners w
    WHERE s.burn_block_height = w.burn_block_height
      AND s.canonical != (s.burn_block_hash = w.burn_block_hash)
  `);
  pgm.sql(`
    UPDATE burn_block_pox_txs p
    SET canonical = (p.burn_block_hash = w.burn_block_hash)
    FROM burnchain_canonical_winners w
    WHERE p.burn_block_height = w.burn_block_height
      AND p.canonical != (p.burn_block_hash = w.burn_block_hash)
  `);
  pgm.sql(`
    DROP TABLE burnchain_canonical_winners
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
