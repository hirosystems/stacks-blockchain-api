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
 * covers blocks that paid at least one recipient). Note `burn_amount` never included the 2.0-era
 * PoX sunset-ramp surcharge (`sunset_burn` was a separate commit field the node never reported).
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
  // Fill gaps from burnchain_rewards for eras where raw events were pruned or disabled. Rewards
  // rows duplicate the block-level burn_amount per recipient, so any row's value works. Groups are
  // ordered by their latest reward-row id so the assigned burn_blocks ids preserve arrival order
  // for the canonical tie-break below.
  pgm.sql(`
    INSERT INTO burn_blocks (canonical, burn_block_hash, burn_block_height, burn_amount, reward_amount)
    SELECT false, burn_block_hash, burn_block_height, MAX(burn_amount), SUM(reward_amount)
    FROM burnchain_rewards
    GROUP BY burn_block_hash, burn_block_height
    ORDER BY MAX(id)
    ON CONFLICT ON CONSTRAINT burn_blocks_unique_idx DO NOTHING
  `);
  // One canonical hash per height, preferring a hash anchored by a canonical Stacks block, then one
  // canonical in the (already repaired) rewards table -- keeping this table consistent with the
  // legacy tables -- and falling back to arrival order. The same rule as the other repairs.
  pgm.sql(`
    WITH winners AS (
      SELECT DISTINCT ON (burn_block_height) burn_block_height, burn_block_hash
      FROM burn_blocks c
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
  // `burn_amount` is a block-level fact now owned by this table; the copy duplicated onto every
  // reward row (and absent for zero-recipient blocks) is redundant. Reads join through
  // `burn_blocks` instead.
  pgm.dropColumn('burnchain_rewards', 'burn_amount');
};

export const down = (pgm: MigrationBuilder) => {
  // Restores the column shape only; the per-row values are not recoverable (rebuild them by
  // re-running `up`, which sources burn amounts from raw events and this table's data is lost).
  pgm.addColumn('burnchain_rewards', {
    burn_amount: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
  });
  pgm.dropTable('burn_blocks');
};
