/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.createTable('burn_block_pox_txs', {
    burn_block_height: {
      type: 'integer',
      notNull: true,
    },
    burn_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    tx_id: {
      type: 'bytea',
      notNull: true,
    },
    recipient: {
      type: 'string',
      notNull: true,
    },
    utxo_idx: {
      type: 'integer',
      notNull: true,
    },
    amount: {
      type: 'numeric',
      notNull: true,
    },
    canonical: {
      type: 'boolean',
      notNull: true,
    },
  });
  pgm.addConstraint(
    'burn_block_pox_txs',
    'burn_block_pox_txs_unique_idx',
    `UNIQUE(burn_block_height, burn_block_hash, tx_id, utxo_idx)`
  );
  pgm.createIndex('burn_block_pox_txs', [
    'recipient',
    { name: 'burn_block_height', sort: 'DESC' },
  ], { where: 'canonical = true' });
  pgm.createIndex('burn_block_pox_txs', [
    'recipient',
    'burn_block_hash',
    { name: 'burn_block_height', sort: 'DESC' },
  ], { where: 'canonical = true' });
};

exports.down = pgm => {
  pgm.dropTable('burn_block_pox_txs');
};
