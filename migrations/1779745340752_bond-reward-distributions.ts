import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export function up(pgm: MigrationBuilder): void {
  pgm.createTable('bond_reward_distributions', {
    bond_index: {
      type: 'integer',
      notNull: true,
    },
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
    // Per-bond reward distribution, from the pox-5 `bond-distribution` event
    // (emitted once per bond during a `calculate-rewards` call).
    target_yield: {
      type: 'numeric',
      notNull: true,
    },
    // sBTC rewards earned by this bond in this calculation.
    bond_rewards: {
      type: 'numeric',
      notNull: true,
    },
    // Total sats staked in the bond at the time of this calculation.
    bond_staked_sats: {
      type: 'numeric',
      notNull: true,
    },
    // Per-sat rewards accrued in this calculation.
    accrued_rewards_per_sat: {
      type: 'numeric',
      notNull: true,
    },
    // Running per-sat reward total for the bond after this calculation.
    cumulative_rewards_per_sat: {
      type: 'numeric',
      notNull: true,
    },
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable('bond_reward_distributions');
}
