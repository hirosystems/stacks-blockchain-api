/* eslint-disable camelcase */

exports.shorthands = undefined;

function replaceIndex(pgm, table, column, method = 'btree') {
  pgm.dropIndex(table, column);
  pgm.createIndex(table, column, { method: method });
}

exports.up = pgm => {
  pgm.dropIndex('txs', [{ name: 'tx_index', sort: 'DESC' }], { ifExists: true });
  pgm.dropIndex('txs', 'tx_id', { ifExists: true });
  replaceIndex(pgm, 'txs', 'token_transfer_recipient_address');
  replaceIndex(pgm, 'txs', 'sponsor_address');
  replaceIndex(pgm, 'txs', 'smart_contract_contract_id');
  replaceIndex(pgm, 'txs', 'sender_address');
  replaceIndex(pgm, 'txs', 'microblock_hash');
  replaceIndex(pgm, 'txs', 'contract_call_contract_id');

  replaceIndex(pgm, 'stx_events', 'tx_id');
  replaceIndex(pgm, 'stx_events', 'sender');
  replaceIndex(pgm, 'stx_events', 'recipient');
  replaceIndex(pgm, 'stx_events', 'microblock_hash');

  replaceIndex(pgm, 'miner_rewards', 'recipient');

  pgm.dropIndex('stx_lock_events', 'block_height', { ifExists: true });
  replaceIndex(pgm, 'stx_lock_events', 'tx_id');
  replaceIndex(pgm, 'stx_lock_events', 'microblock_hash');
  replaceIndex(pgm, 'stx_lock_events', 'locked_address');

  replaceIndex(pgm, 'ft_events', 'tx_id');
  replaceIndex(pgm, 'ft_events', 'sender');
  replaceIndex(pgm, 'ft_events', 'recipient');
  replaceIndex(pgm, 'ft_events', 'microblock_hash');

  replaceIndex(pgm, 'nft_events', 'tx_id');
  replaceIndex(pgm, 'nft_events', 'sender');
  replaceIndex(pgm, 'nft_events', 'recipient');
  replaceIndex(pgm, 'nft_events', 'microblock_hash');
  replaceIndex(pgm, 'nft_events', 'asset_identifier');

  replaceIndex(pgm, 'contract_logs', 'tx_id');
  replaceIndex(pgm, 'contract_logs', 'microblock_hash');

  replaceIndex(pgm, 'smart_contracts', 'contract_id');
  replaceIndex(pgm, 'smart_contracts', 'microblock_hash');

  pgm.dropIndex('principal_stx_txs', 'principal', { ifExists: true });
  replaceIndex(pgm, 'principal_stx_txs', 'tx_id');

  pgm.dropIndex('mempool_txs', 'tx_id', { ifExists: true });
  replaceIndex(pgm, 'mempool_txs', 'token_transfer_recipient_address');
  replaceIndex(pgm, 'mempool_txs', 'sponsor_address');
  replaceIndex(pgm, 'mempool_txs', 'smart_contract_contract_id');
  replaceIndex(pgm, 'mempool_txs', 'sender_address');
  replaceIndex(pgm, 'mempool_txs', 'contract_call_contract_id');
};

exports.down = pgm => {
  pgm.createIndex('txs', [{ name: 'tx_index', sort: 'DESC' }]);
  pgm.createIndex('txs', 'tx_id', { method: 'hash' });
  replaceIndex(pgm, 'txs', 'token_transfer_recipient_address', 'hash');
  replaceIndex(pgm, 'txs', 'sponsor_address', 'hash');
  replaceIndex(pgm, 'txs', 'smart_contract_contract_id', 'hash');
  replaceIndex(pgm, 'txs', 'sender_address', 'hash');
  replaceIndex(pgm, 'txs', 'microblock_hash', 'hash');
  replaceIndex(pgm, 'txs', 'contract_call_contract_id', 'hash');

  replaceIndex(pgm, 'stx_events', 'tx_id', 'hash');
  replaceIndex(pgm, 'stx_events', 'sender', 'hash');
  replaceIndex(pgm, 'stx_events', 'recipient', 'hash');
  replaceIndex(pgm, 'stx_events', 'microblock_hash', 'hash');

  replaceIndex(pgm, 'miner_rewards', 'recipient', 'hash');

  pgm.createIndex('stx_lock_events', [{ name: 'block_height', sort: 'DESC' }]);
  replaceIndex(pgm, 'stx_lock_events', 'tx_id', 'hash');
  replaceIndex(pgm, 'stx_lock_events', 'microblock_hash', 'hash');
  replaceIndex(pgm, 'stx_lock_events', 'locked_address', 'hash');

  replaceIndex(pgm, 'ft_events', 'tx_id', 'hash');
  replaceIndex(pgm, 'ft_events', 'sender', 'hash');
  replaceIndex(pgm, 'ft_events', 'recipient', 'hash');
  replaceIndex(pgm, 'ft_events', 'microblock_hash', 'hash');

  replaceIndex(pgm, 'nft_events', 'tx_id', 'hash');
  replaceIndex(pgm, 'nft_events', 'sender', 'hash');
  replaceIndex(pgm, 'nft_events', 'recipient', 'hash');
  replaceIndex(pgm, 'nft_events', 'microblock_hash', 'hash');
  replaceIndex(pgm, 'nft_events', 'asset_identifier', 'hash');

  replaceIndex(pgm, 'contract_logs', 'tx_id', 'hash');
  replaceIndex(pgm, 'contract_logs', 'microblock_hash', 'hash');

  replaceIndex(pgm, 'smart_contracts', 'contract_id', 'hash');
  replaceIndex(pgm, 'smart_contracts', 'microblock_hash', 'hash');

  pgm.createIndex('principal_stx_txs', 'principal', { method: 'hash' });
  replaceIndex(pgm, 'principal_stx_txs', 'tx_id', 'hash');

  pgm.createIndex('mempool_txs', 'tx_id', { method: 'hash' });
  replaceIndex(pgm, 'mempool_txs', 'token_transfer_recipient_address', 'hash');
  replaceIndex(pgm, 'mempool_txs', 'sponsor_address', 'hash');
  replaceIndex(pgm, 'mempool_txs', 'smart_contract_contract_id', 'hash');
  replaceIndex(pgm, 'mempool_txs', 'sender_address', 'hash');
  replaceIndex(pgm, 'mempool_txs', 'contract_call_contract_id', 'hash');
};
