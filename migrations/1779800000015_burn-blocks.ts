import type { MigrationBuilder } from 'node-pg-migrate';

/**
 * Persists per-burn-block data from `/new_burn_block` events, most importantly `burn_amount`: the
 * total BTC burned by the block's commits. Historically this value was only stored as a column
 * duplicated onto `burnchain_rewards` rows, so burn blocks with zero reward recipients (every pox-1
 * through pox-4 prepare-phase block, where commits burn 100%) never persisted it at all. This table
 * records it for every burn block, with the same one-canonical-hash-per-height semantics as the
 * other burnchain tables.
 *
 * The backfill sources historical blocks from the raw `/new_burn_block` payloads in
 * `event_observer_requests`, then fills any remaining gaps from `burnchain_rewards` (which only
 * covers blocks that paid at least one recipient). Canonical winners are resolved per height from
 * the strongest evidence available (a canonical Stacks block anchor, then raw-event arrival order,
 * with legacy-table state consulted only for heights raw events don't cover) and then propagated
 * back to the legacy burnchain tables, repairing forks those tables couldn't represent (e.g. a
 * zero-recipient replacement block orphaning a reward-paying rival). Note `burn_amount` never
 * included the 2.0-era PoX sunset-ramp surcharge (`sunset_burn` was a separate commit field the
 * node never reported).
 */
export const up = (pgm: MigrationBuilder) => {
  pgm.createTable('burn_blocks', {
    id: {
      type: 'serial',
      primaryKey: true,
    },
    canonical: {
      type: 'boolean',
      notNull: true,
    },
    burn_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    burn_block_height: {
      type: 'integer',
      notNull: true,
    },
    burn_amount: {
      type: 'numeric',
      notNull: true,
    },
    reward_amount: {
      type: 'numeric',
      notNull: true,
    },
  });
  pgm.addConstraint('burn_blocks', 'burn_blocks_unique_idx', 'UNIQUE(burn_block_hash)');
  pgm.createIndex('burn_blocks', [{ name: 'burn_block_height', sort: 'DESC' }]);

  // Backfill from raw events: the latest payload per burn block hash, inserted in event order so
  // ids preserve arrival order for the canonical tie-break below.
  pgm.sql(`
    WITH latest_events AS (
      SELECT DISTINCT ON (payload->>'burn_block_hash')
        decode(substring(payload->>'burn_block_hash' from 3), 'hex') AS burn_block_hash,
        (payload->>'burn_block_height')::int AS burn_block_height,
        (payload->>'burn_amount')::numeric AS burn_amount,
        (
          SELECT COALESCE(SUM((r->>'amt')::numeric), 0)
          FROM jsonb_array_elements(payload->'reward_recipients') AS r
        ) AS reward_amount,
        id
      FROM event_observer_requests
      WHERE event_path = '/new_burn_block'
      ORDER BY payload->>'burn_block_hash', id DESC
    )
    INSERT INTO burn_blocks (canonical, burn_block_hash, burn_block_height, burn_amount, reward_amount)
    SELECT false, burn_block_hash, burn_block_height, burn_amount, reward_amount
    FROM latest_events
    ORDER BY id
  `);
  // Resolve winners among raw-event rows first: a canonical Stacks block anchoring a hash is the
  // strongest evidence, then raw-event arrival order (the node announces replacement blocks after
  // the blocks they orphan). This runs before the rewards gap-fill so legacy-table state -- which
  // cannot represent zero-recipient replacement blocks -- can never override raw-event evidence.
  pgm.sql(`
    WITH winners AS (
      SELECT DISTINCT ON (burn_block_height) burn_block_height, burn_block_hash
      FROM burn_blocks c
      ORDER BY burn_block_height,
        EXISTS (
          SELECT 1 FROM blocks b
          WHERE b.burn_block_hash = c.burn_block_hash AND b.canonical = true
        ) DESC,
        id DESC
    )
    UPDATE burn_blocks c
    SET canonical = (c.burn_block_hash = w.burn_block_hash)
    FROM winners w
    WHERE c.burn_block_height = w.burn_block_height
      AND c.canonical != (c.burn_block_hash = w.burn_block_hash)
  `);
  // Fill gaps from burnchain_rewards for eras where raw events were pruned or disabled. Rewards
  // rows duplicate the block-level burn_amount per recipient, so any row's value works. Groups are
  // ordered by their latest reward-row id so the assigned burn_blocks ids preserve arrival order.
  pgm.sql(`
    INSERT INTO burn_blocks (canonical, burn_block_hash, burn_block_height, burn_amount, reward_amount)
    SELECT false, burn_block_hash, burn_block_height, MAX(burn_amount), SUM(reward_amount)
    FROM burnchain_rewards
    GROUP BY burn_block_hash, burn_block_height
    ORDER BY MAX(id)
    ON CONFLICT ON CONSTRAINT burn_blocks_unique_idx DO NOTHING
  `);
  // Resolve winners for heights with no raw-event evidence (no canonical row yet): prefer a
  // canonical Stacks block anchor, then the hash canonical in the (already repaired) rewards
  // table, then arrival order. Heights already resolved from raw events are left untouched.
  pgm.sql(`
    WITH winners AS (
      SELECT DISTINCT ON (burn_block_height) burn_block_height, burn_block_hash
      FROM burn_blocks c
      WHERE NOT EXISTS (
        SELECT 1 FROM burn_blocks c2
        WHERE c2.burn_block_height = c.burn_block_height AND c2.canonical = true
      )
      ORDER BY burn_block_height,
        EXISTS (
          SELECT 1 FROM blocks b
          WHERE b.burn_block_hash = c.burn_block_hash AND b.canonical = true
        ) DESC,
        EXISTS (
          SELECT 1 FROM burnchain_rewards r
          WHERE r.burn_block_hash = c.burn_block_hash AND r.canonical = true
        ) DESC,
        id DESC
    )
    UPDATE burn_blocks c
    SET canonical = (c.burn_block_hash = w.burn_block_hash)
    FROM winners w
    WHERE c.burn_block_height = w.burn_block_height
      AND c.canonical != (c.burn_block_hash = w.burn_block_hash)
  `);
  // Anchor override across all rows, regardless of source: a hash anchored by a canonical Stacks
  // block is proof of burnchain canonicality and must win even when the passes above resolved its
  // height from weaker evidence e.g. a partially pruned raw archive where only the losing fork
  // side's event survives while the anchored winner was gap-filled from burnchain_rewards. At most
  // one hash per height can carry a canonical anchor (the canonical Stacks chain sees one linear
  // burnchain), so this pass is deterministic.
  pgm.sql(`
    WITH anchored AS (
      SELECT DISTINCT ON (burn_block_height) burn_block_height, burn_block_hash
      FROM burn_blocks c
      WHERE EXISTS (
        SELECT 1 FROM blocks b
        WHERE b.burn_block_hash = c.burn_block_hash AND b.canonical = true
      )
      ORDER BY burn_block_height, id DESC
    )
    UPDATE burn_blocks c
    SET canonical = (c.burn_block_hash = a.burn_block_hash)
    FROM anchored a
    WHERE c.burn_block_height = a.burn_block_height
      AND c.canonical != (c.burn_block_hash = a.burn_block_hash)
  `);
  // Propagate the resolved winners back to the legacy burnchain tables so they agree with the
  // raw-event evidence. In particular, a zero-recipient replacement block (visible only in raw
  // events) orphans the rival hash's rewards, slot holders, and pox txs -- the historical
  // counterpart of what the write path now does on ingestion.
  pgm.sql(`
    UPDATE burnchain_rewards r
    SET canonical = (r.burn_block_hash = w.burn_block_hash)
    FROM burn_blocks w
    WHERE w.canonical = true
      AND w.burn_block_height = r.burn_block_height
      AND r.canonical != (r.burn_block_hash = w.burn_block_hash)
  `);
  pgm.sql(`
    UPDATE reward_slot_holders s
    SET canonical = (s.burn_block_hash = w.burn_block_hash)
    FROM burn_blocks w
    WHERE w.canonical = true
      AND w.burn_block_height = s.burn_block_height
      AND s.canonical != (s.burn_block_hash = w.burn_block_hash)
  `);
  pgm.sql(`
    UPDATE burn_block_pox_txs p
    SET canonical = (p.burn_block_hash = w.burn_block_hash)
    FROM burn_blocks w
    WHERE w.canonical = true
      AND w.burn_block_height = p.burn_block_height
      AND p.canonical != (p.burn_block_hash = w.burn_block_hash)
  `);
  pgm.sql(`
    DELETE FROM burn_block_pox_tx_counts
  `);
  pgm.sql(`
    INSERT INTO burn_block_pox_tx_counts (recipient, count)
    (SELECT recipient, COUNT(*) AS count FROM burn_block_pox_txs WHERE canonical = true GROUP BY recipient)
  `);
  // `burn_amount` is a block-level fact now owned by this table; the copy duplicated onto every
  // reward row (and absent for zero-recipient blocks) is redundant. Reads join through
  // `burn_blocks` instead.
  pgm.dropColumn('burnchain_rewards', 'burn_amount');
};

export const down = (pgm: MigrationBuilder) => {
  // Restore the legacy per-reward column and refill it from this table before dropping it, so
  // historical API `burn_amount` reads survive a rollback. Only blocks with no reward rows (which
  // the legacy column never represented anyway) lose their burn amounts.
  pgm.addColumn('burnchain_rewards', {
    burn_amount: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
  });
  pgm.sql(`
    UPDATE burnchain_rewards r
    SET burn_amount = b.burn_amount
    FROM burn_blocks b
    WHERE b.burn_block_hash = r.burn_block_hash
  `);
  pgm.dropTable('burn_blocks');
};
