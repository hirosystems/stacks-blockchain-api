import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Backfills `miner_rewards.reward_index`: each reward's position within its maturing block's
 * `matured_miner_rewards` list. Rows were always inserted in the order the node reported them, so
 * the serial `id` order within a block is that position.
 */
export const BACKFILL_REWARD_INDEX_SQL = `
  UPDATE miner_rewards AS mr
  SET reward_index = r.reward_index
  FROM (
    SELECT id, (ROW_NUMBER() OVER (PARTITION BY index_block_hash ORDER BY id) - 1) AS reward_index
    FROM miner_rewards
  ) AS r
  WHERE mr.id = r.id
`;

/**
 * Backfills `principal_miner_reward_totals` from the canonical `miner_rewards` rows. Zero-value
 * rewards (typically a parent miner's empty share of streamed fees) aren't counted, matching the
 * rewards the principal mining endpoints list.
 */
export const BACKFILL_PRINCIPAL_MINER_REWARD_TOTALS_SQL = `
  INSERT INTO principal_miner_reward_totals (principal, reward_count, coinbase_amount, fees_amount)
  SELECT
    recipient,
    COUNT(*) FILTER (
      WHERE coinbase_amount + tx_fees_anchored + tx_fees_streamed_confirmed
        + tx_fees_streamed_produced > 0
    ),
    SUM(coinbase_amount),
    SUM(tx_fees_anchored + tx_fees_streamed_confirmed + tx_fees_streamed_produced)
  FROM miner_rewards
  WHERE canonical = true
  GROUP BY recipient
`;

/**
 * Supports the `/v3/principals/:principal/mining` endpoints.
 *
 * `miner_rewards.reward_index` gives every reward a stable identifier, `(index_block_hash,
 * reward_index)`. A maturing block can credit the same recipient twice (its own miner reward plus
 * its parent-miner share of streamed fees), and the serial `id` changes on event replay.
 *
 * `principal_miner_reward_totals` materializes each recipient's lifetime matured rewards, so the
 * summary and the list's `total` are a single-row lookup instead of a per-request aggregate over a
 * miner's whole reward history. Maintained on the write path and delta-corrected on re-org, like
 * `ft_balances`; it tracks `canonical = true` rows.
 *
 * The list query is served by the `(recipient, mature_block_height DESC) WHERE canonical` index
 * from migration 1779800000027; rewards sharing a maturity height are few enough for an incremental
 * sort on `reward_index`.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.addColumn('miner_rewards', {
    reward_index: {
      type: 'smallint',
    },
  });
  pgm.sql(BACKFILL_REWARD_INDEX_SQL);
  pgm.alterColumn('miner_rewards', 'reward_index', { notNull: true });

  pgm.createTable('principal_miner_reward_totals', {
    principal: {
      type: 'text',
      notNull: true,
      primaryKey: true,
    },
    reward_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    coinbase_amount: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
    // All of the rewards' transaction fees (anchored and streamed) summed together.
    fees_amount: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
  });
  pgm.sql(BACKFILL_PRINCIPAL_MINER_REWARD_TOTALS_SQL);
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable('principal_miner_reward_totals');
  pgm.dropColumn('miner_rewards', 'reward_index');
}
