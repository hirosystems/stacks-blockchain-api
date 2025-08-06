/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.createIndex('mempool_txs', ['sender_address', 'nonce']);
  pgm.createIndex('mempool_txs', ['sponsor_address', 'nonce']);
};
