/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.dropIndex('txs', ['sender_address']);
  pgm.createIndex('txs', ['sender_address', 'nonce'], {
    where: 'canonical = true AND microblock_canonical = true',
  });
  pgm.dropIndex('txs', ['sponsor_address']);
  pgm.createIndex('txs', ['sponsor_address', 'nonce'], {
    where: 'sponsor_address IS NOT NULL AND canonical = true AND microblock_canonical = true',
  });
};

exports.down = pgm => {
  pgm.dropIndex('txs', ['sender_address', 'nonce']);
  pgm.createIndex('txs', ['sender_address']);
  pgm.dropIndex('txs', ['sponsor_address', 'nonce']);
  pgm.createIndex('txs', ['sponsor_address']);
};
