import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Per-staker reward claims, one row per pox-5 `claim-staker-rewards-for-signer`
 * event. These are the source rows behind each position's running
 * `principal_bond_positions.claimed_rewards` total: claims with a `bond_index`
 * are bond (sBTC) reward claims and feed that total; claims with a NULL
 * `bond_index` are STX-staking reward claims (no bond position attached).
 * Keeping the per-claim rows lets us re-derive or delta-correct the running
 * totals under reorgs.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.createTable('principal_bond_reward_claims', {
    id: {
      type: 'bigserial',
      primaryKey: true,
    },
    // The staker whose rewards were claimed.
    principal: {
      type: 'string',
      notNull: true,
    },
    // The signer manager that performed the claim.
    signer_manager: {
      type: 'string',
      notNull: true,
    },
    reward_cycle: {
      type: 'integer',
      notNull: true,
    },
    // Bond the claimed rewards accrued against; NULL for STX-staking rewards.
    bond_index: {
      type: 'integer',
    },
    rewards_claimed: {
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

  pgm.createIndex('principal_bond_reward_claims', 'tx_id');
  pgm.createIndex('principal_bond_reward_claims', ['index_block_hash', 'canonical']);
  pgm.createIndex('principal_bond_reward_claims', ['principal', 'bond_index']);
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable('principal_bond_reward_claims');
}
