/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.dropIndex('ft_balances', ['token']);
  pgm.dropIndex('mempool_txs', ['sender_address']);
  pgm.dropIndex('mempool_txs', ['sponsor_address']);
  pgm.dropIndex('nft_events', ['asset_identifier']);
};

exports.down = pgm => {
  pgm.createIndex('ft_balances', ['token']);
  pgm.createIndex('mempool_txs', ['sender_address']);
  pgm.createIndex('mempool_txs', ['sponsor_address']);
  pgm.createIndex('nft_events', ['asset_identifier']);
};
