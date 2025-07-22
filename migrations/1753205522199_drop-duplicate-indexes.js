/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.dropIndex('ft_balances', ['token']);
  pgm.dropIndex('mempool_txs', ['sender_address']);
  pgm.dropIndex('mempool_txs', ['sponsor_address']);
  pgm.dropIndex('nft_events', ['asset_identifier']);
};
