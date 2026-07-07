import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Cycle-level aggregate emitted once per pox-5 `calculate-rewards` call (the
 * `calculate-rewards` event), after all per-bond `bond-distribution` events have
 * been folded and the STX reward-cycle accounting committed. Per-bond reward
 * data lives in `bond_reward_distributions`.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.createTable('bond_reward_calculations', {
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
    // Burn height at which rewards were calculated.
    calculation_height: {
      type: 'integer',
      notNull: true,
    },
    // Total new rewards accrued since the last calculation.
    gross_accrued_rewards: {
      type: 'numeric',
      notNull: true,
    },
    // Portion of gross_accrued_rewards paid out to bonds.
    total_bond_rewards: {
      type: 'numeric',
      notNull: true,
    },
    // Amount added to the reserve this calculation.
    reserve_deposit: {
      type: 'numeric',
      notNull: true,
    },
    // Reserve balance after reserve_deposit was applied.
    reserve_balance: {
      type: 'numeric',
      notNull: true,
    },
    // STX reward cycle this calculation accounts for.
    stx_cycle: {
      type: 'integer',
      notNull: true,
    },
    // Rewards allocated to STX stakers for the cycle.
    total_stx_staker_rewards: {
      type: 'numeric',
      notNull: true,
    },
    // Total uSTX staked for the cycle.
    cycle_staked_ustx: {
      type: 'numeric',
      notNull: true,
    },
    // Per-uSTX rewards accrued this calculation (zero when no STX is staked).
    accrued_rewards_per_ustx: {
      type: 'numeric',
      notNull: true,
    },
    // Running per-uSTX reward total for the cycle after this calculation.
    cumulative_rewards_per_ustx: {
      type: 'numeric',
      notNull: true,
    },
  });

  pgm.createIndex('bond_reward_calculations', 'tx_id');
  pgm.createIndex('bond_reward_calculations', ['index_block_hash', 'canonical']);
  pgm.createIndex('bond_reward_calculations', 'stx_cycle');
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable('bond_reward_calculations');
}
