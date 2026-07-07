import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export function up(pgm: MigrationBuilder): void {
  pgm.createTable('principal_bond_positions', {
    id: {
      type: 'bigserial',
      primaryKey: true,
    },
    principal: {
      type: 'string',
      notNull: true,
    },
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
    status: {
      type: 'smallint',
      notNull: true,
    },
    active: {
      type: 'boolean',
      notNull: true,
    },
    btc_locked: {
      type: 'numeric',
      notNull: true,
    },
    stx_locked: {
      type: 'numeric',
      notNull: true,
    },
    btc_paid_out: {
      type: 'numeric',
      notNull: true,
    },
    // Running sBTC reward sats accrued to this position, distributed from the
    // bond's per-sat reward rate by this participant's staked weight. Maintained
    // incrementally on write (and via signed deltas on reorg).
    accrued_rewards: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
    // Running sBTC reward sats already claimed against this position, from
    // pox-5 `claim-staker-rewards-for-signer` events. Claimable rewards are
    // `accrued_rewards - claimed_rewards`. Maintained incrementally on write
    // (and via signed deltas on reorg).
    claimed_rewards: {
      type: 'numeric',
      notNull: true,
      default: 0,
    },
  });

  pgm.createIndex('principal_bond_positions', ['principal', 'bond_index'], {
    unique: true,
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropTable('principal_bond_positions');
}
