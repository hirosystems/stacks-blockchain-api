/* eslint-disable camelcase */

exports.shorthands = undefined;

/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.dropTable('principal_stx_txs');

  pgm.createTable('principal_txs', {
    principal: {
      type: 'string',
      notNull: true,
    },
    tx_id: {
      type: 'bytea',
      notNull: true,
    },
    block_height: {
      type: 'integer',
      notNull: true,
    },
    index_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    microblock_hash: {
      type: 'bytea',
      notNull: true,
    },
    microblock_sequence: {
      type: 'integer',
      notNull: true,
    },
    tx_index: {
      type: 'smallint',
      notNull: true,
    },
    canonical: {
      type: 'boolean',
      notNull: true,
    },
    microblock_canonical: {
      type: 'boolean',
      notNull: true,
    },
    stx_balance_affected: {
      type: 'boolean',
      notNull: true,
    },
    ft_balance_affected: {
      type: 'boolean',
      notNull: true,
    },
    nft_balance_affected: {
      type: 'boolean',
      notNull: true,
    },
    stx_sent: {
      type: 'bigint',
      notNull: true,
    },
    stx_received: {
      type: 'bigint',
      notNull: true,
    },
    stx_transfer_event_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    stx_mint_event_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    stx_burn_event_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    stx_lock_event_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    ft_transfer_event_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    ft_mint_event_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    ft_burn_event_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    nft_transfer_event_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    nft_mint_event_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
    nft_burn_event_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
  });
  pgm.createIndex('principal_txs', 'tx_id');
  pgm.createIndex(
    'principal_txs',
    [
      { name: 'principal' },
      { name: 'block_height', sort: 'DESC' },
      { name: 'microblock_sequence', sort: 'DESC' },
      { name: 'tx_index', sort: 'DESC' },
    ],
    {
      where: 'canonical = TRUE AND microblock_canonical = TRUE',
    }
  );
  pgm.addConstraint(
    'principal_txs',
    'unique_principal_tx_id_index_block_hash_microblock_hash',
    `UNIQUE(principal, tx_id, index_block_hash, microblock_hash)`
  );
};

exports.down = pgm => {
  pgm.dropTable('principal_txs');
  pgm.createTable('principal_stx_txs', {
    id: {
      type: 'serial',
      primaryKey: true,
    },
    principal: {
      type: 'string',
      notNull: true,
    },
    tx_id: {
      type: 'bytea',
      notNull: true,
    },
    block_height: {
      type: 'integer',
      notNull: true,
    },
    index_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    microblock_hash: {
      type: 'bytea',
      notNull: true,
    },
    microblock_sequence: {
      type: 'integer',
      notNull: true,
    },
    tx_index: {
      type: 'smallint',
      notNull: true,
    },
    canonical: {
      type: 'boolean',
      notNull: true,
    },
    microblock_canonical: {
      type: 'boolean',
      notNull: true,
    },
  });
  pgm.createIndex('principal_stx_txs', 'tx_id');
  pgm.createIndex(
    'principal_stx_txs',
    [
      { name: 'principal' },
      { name: 'block_height', sort: 'DESC' },
      { name: 'microblock_sequence', sort: 'DESC' },
      { name: 'tx_index', sort: 'DESC' },
    ],
    {
      name: 'idx_principal_stx_txs_optimized',
      where: 'canonical = TRUE AND microblock_canonical = TRUE',
    }
  );
  pgm.createIndex('principal_stx_txs', [
    { name: 'block_height', sort: 'DESC' },
    { name: 'microblock_sequence', sort: 'DESC' },
    { name: 'tx_index', sort: 'DESC' }
  ]);
  pgm.addConstraint(
    'principal_stx_txs',
    'unique_principal_tx_id_index_block_hash_microblock_hash',
    `UNIQUE(principal, tx_id, index_block_hash, microblock_hash)`
  );
};

