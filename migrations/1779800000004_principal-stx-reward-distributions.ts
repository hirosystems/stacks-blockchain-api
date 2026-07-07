import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Per-staker STX-staking reward distribution source rows. Each pox-5
 * `calculate-rewards` event allocates `total_stx_staker_rewards` (sBTC sats) to
 * STX stackers at a uniform `accrued_rewards_per_ustx` rate; we split that rate
 * across the current pox-5 STX lockers by their locked uSTX and write one row
 * here per staker per calculation. These rows back the running
 * `principal_staking_totals.stx_accrued_rewards` total under reorgs — analogous
 * to `principal_bond_reward_distributions` for bond rewards.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.createTable('principal_stx_reward_distributions', {
    id: {
      type: 'bigserial',
      primaryKey: true,
    },
    principal: {
      type: 'text',
      notNull: true,
    },
    reward_cycle: {
      type: 'integer',
      notNull: true,
    },
    // sBTC reward sats this staker accrued from this calculation.
    reward_amount: {
      type: 'numeric',
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
  });

  pgm.createIndex('principal_stx_reward_distributions', 'tx_id');
  pgm.createIndex('principal_stx_reward_distributions', ['index_block_hash', 'canonical']);
  pgm.createIndex('principal_stx_reward_distributions', 'principal');
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable('principal_stx_reward_distributions');
}
