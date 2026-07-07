import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Per-signer reward claim aggregate, one row per pox-5 `claim-rewards` event.
 * This is the signer-manager-level claim: the sBTC rewards a signer manager
 * claimed for a cycle, broken into the STX-staking portion (`stx_earned`) and
 * the per-bond portion (`bond_rewards`), with `total_rewards` the sum. It is
 * bookkeeping/audit data with no running totals derived from it — the
 * per-staker effects live in `principal_bond_reward_claims` /
 * `principal_staking_totals` — so reorgs only flip its canonical flag.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.createTable('signer_reward_claims', {
    id: {
      type: 'bigserial',
      primaryKey: true,
    },
    signer_manager: {
      type: 'text',
      notNull: true,
    },
    reward_cycle: {
      type: 'integer',
      notNull: true,
    },
    // sBTC reward sats earned by this signer's STX stakers for the cycle.
    stx_earned: {
      type: 'numeric',
      notNull: true,
    },
    // The cumulative per-uSTX reward rate at claim time (from `stx_rewards`).
    stx_rewards_per_token: {
      type: 'numeric',
      notNull: true,
    },
    // JSON array of `{ bond_index, earned, rewards_per_token }` per claimed bond.
    bond_rewards: {
      type: 'jsonb',
      notNull: true,
    },
    // Total sBTC reward sats claimed across all of this signer's bonds.
    bond_totals: {
      type: 'numeric',
      notNull: true,
    },
    // Total sBTC reward sats claimed (STX-staking + bonds).
    total_rewards: {
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

  pgm.createIndex('signer_reward_claims', 'tx_id');
  pgm.createIndex('signer_reward_claims', ['index_block_hash', 'canonical']);
  pgm.createIndex('signer_reward_claims', ['signer_manager', 'reward_cycle']);
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable('signer_reward_claims');
}
