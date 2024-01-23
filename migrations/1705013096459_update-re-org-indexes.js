/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.dropIndex('txs', 'index_block_hash');
  pgm.createIndex('txs', ['index_block_hash', 'canonical']);

  pgm.dropIndex('miner_rewards', 'index_block_hash');
  pgm.createIndex('miner_rewards', ['index_block_hash', 'canonical']);

  pgm.dropIndex('stx_lock_events', 'index_block_hash');
  pgm.createIndex('stx_lock_events', ['index_block_hash', 'canonical']);

  pgm.dropIndex('stx_events', 'index_block_hash');
  pgm.createIndex('stx_events', ['index_block_hash', 'canonical']);

  pgm.dropIndex('ft_events', 'index_block_hash');
  pgm.createIndex('ft_events', ['index_block_hash', 'canonical']);

  pgm.dropIndex('nft_events', 'index_block_hash');
  pgm.createIndex('nft_events', ['index_block_hash', 'canonical']);

  pgm.dropIndex('pox2_events', 'index_block_hash');
  pgm.createIndex('pox2_events', ['index_block_hash', 'canonical']);

  pgm.dropIndex('pox3_events', 'index_block_hash');
  pgm.createIndex('pox3_events', ['index_block_hash', 'canonical']);

  pgm.dropIndex('pox4_events', 'index_block_hash');
  pgm.createIndex('pox4_events', ['index_block_hash', 'canonical']);

  pgm.dropIndex('contract_logs', 'index_block_hash');
  pgm.createIndex('contract_logs', ['index_block_hash', 'canonical']);

  pgm.dropIndex('smart_contracts', 'index_block_hash');
  pgm.createIndex('smart_contracts', ['index_block_hash', 'canonical']);

  pgm.dropIndex('names', 'index_block_hash');
  pgm.createIndex('names', ['index_block_hash', 'canonical']);

  pgm.dropIndex('namespaces', 'index_block_hash');
  pgm.createIndex('namespaces', ['index_block_hash', 'canonical']);

  pgm.dropIndex('subdomains', 'index_block_hash');
  pgm.createIndex('subdomains', ['index_block_hash', 'canonical']);
};

exports.down = pgm => {
  pgm.dropIndex('txs', ['index_block_hash', 'canonical']);
  pgm.createIndex('txs', 'index_block_hash', { method: 'hash' });

  pgm.dropIndex('miner_rewards', ['index_block_hash', 'canonical']);
  pgm.createIndex('miner_rewards', 'index_block_hash', { method: 'hash' });

  pgm.dropIndex('stx_lock_events', ['index_block_hash', 'canonical']);
  pgm.createIndex('stx_lock_events', 'index_block_hash', { method: 'hash' });

  pgm.dropIndex('stx_events', ['index_block_hash', 'canonical']);
  pgm.createIndex('stx_events', 'index_block_hash', { method: 'hash' });

  pgm.dropIndex('ft_events', ['index_block_hash', 'canonical']);
  pgm.createIndex('ft_events', 'index_block_hash', { method: 'hash' });

  pgm.dropIndex('nft_events', ['index_block_hash', 'canonical']);
  pgm.createIndex('nft_events', 'index_block_hash', { method: 'hash' });

  pgm.dropIndex('pox2_events', ['index_block_hash', 'canonical']);
  pgm.createIndex('pox2_events', 'index_block_hash', { method: 'hash' });

  pgm.dropIndex('pox3_events', ['index_block_hash', 'canonical']);
  pgm.createIndex('pox3_events', 'index_block_hash', { method: 'hash' });

  pgm.dropIndex('pox4_events', ['index_block_hash', 'canonical']);
  pgm.createIndex('pox4_events', 'index_block_hash', { method: 'hash' });

  pgm.dropIndex('contract_logs', ['index_block_hash', 'canonical']);
  pgm.createIndex('contract_logs', 'index_block_hash', { method: 'hash' });

  pgm.dropIndex('smart_contracts', ['index_block_hash', 'canonical']);
  pgm.createIndex('smart_contracts', 'index_block_hash', { method: 'hash' });

  pgm.dropIndex('names', ['index_block_hash', 'canonical']);
  pgm.createIndex('names', 'index_block_hash', { method: 'hash' });

  pgm.dropIndex('namespaces', ['index_block_hash', 'canonical']);
  pgm.createIndex('namespaces', 'index_block_hash', { method: 'hash' });

  pgm.dropIndex('subdomains', ['index_block_hash', 'canonical']);
  pgm.createIndex('subdomains', 'index_block_hash', { method: 'hash' });
};
