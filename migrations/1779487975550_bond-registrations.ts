import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export const up = (pgm: MigrationBuilder) => {
  pgm.createTable('bond_registrations', {
    id: {
      type: 'bigserial',
      primaryKey: true,
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
    bond_index: {
      type: 'integer',
      notNull: true,
    },
    signer: {
      type: 'text',
      notNull: true,
    },
    staker: {
      type: 'text',
      notNull: true,
    },
    amount_ustx: {
      type: 'text',
      notNull: true,
    },
    sats_total: {
      type: 'text',
      notNull: true,
    },
    first_reward_cycle: {
      type: 'integer',
      notNull: true,
    },
    unlock_burn_height: {
      type: 'integer',
      notNull: true,
    },
    unlock_cycle: {
      type: 'integer',
      notNull: true,
    },
    // How the BTC backing this registration was locked, as a `DbBondLockupType`
    // smallint (0 = proven Bitcoin L1 lockup, 1 = sBTC lockup).
    btc_lockup_type: {
      type: 'smallint',
      notNull: true,
    },
    // The proven L1 lockup outputs (array of `{ txid, output_index }`) for an
    // 'l1' lockup; null for an 'l2' (sBTC) lockup.
    btc_lockup_txs: {
      type: 'jsonb',
    },
  });

  pgm.createIndex(
    'bond_registrations',
    [
      'bond_index',
      { name: 'block_height', sort: 'DESC' },
      { name: 'microblock_sequence', sort: 'DESC' },
      { name: 'tx_index', sort: 'DESC' },
      { name: 'id', sort: 'DESC' },
    ],
    {
      where: 'canonical = TRUE AND microblock_canonical = TRUE',
    }
  );
  pgm.createIndex('bond_registrations', ['bond_index', 'staker'], {
    where: 'canonical = TRUE AND microblock_canonical = TRUE',
  });
};

export const down = (pgm: MigrationBuilder) => {
  pgm.dropTable('bond_registrations');
};
