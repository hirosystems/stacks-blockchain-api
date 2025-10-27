/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  /**
   * Stores all `tx_id`s of transactions that affect a principal's STX balance since that cannot be
   * directly determined from the `txs` table (an expensive JOIN with `stx_events` is required).
   */
  pgm.createTable('principal_txs', {
    principal: {
      type: 'string',
      notNull: true,
    },
    tx_id: {
      type: 'bytea',
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
};
