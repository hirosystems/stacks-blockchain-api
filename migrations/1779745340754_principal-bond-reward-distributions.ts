import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Per-participant reward distribution source rows. Each pox-5 `bond-distribution`
 * event is split across the bond's participants by their staked weight; one row
 * is written here per participant per distribution (the amount that participant
 * accrued). These rows are the source of truth for reorg adjustments to the
 * running `principal_bond_positions.accrued_rewards` total — analogous to how
 * `ft_events` rows back the running `ft_balances` totals.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.createTable('principal_bond_reward_distributions', {
    id: {
      type: 'bigserial',
      primaryKey: true,
    },
    principal: {
      type: 'text',
      notNull: true,
    },
    bond_index: {
      type: 'integer',
      notNull: true,
    },
    // sBTC reward sats this participant accrued from this distribution.
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

  pgm.createIndex('principal_bond_reward_distributions', 'tx_id');
  pgm.createIndex('principal_bond_reward_distributions', ['index_block_hash', 'canonical']);
  pgm.createIndex('principal_bond_reward_distributions', ['principal', 'bond_index']);
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable('principal_bond_reward_distributions');
}
