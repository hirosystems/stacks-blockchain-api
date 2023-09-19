/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.createTable('mempool_txs', {
    id: {
      type: 'serial',
      primaryKey: true,
    },
    pruned: {
      type: 'boolean',
      notNull: true,
    },
    tx_id: {
      type: 'bytea',
      notNull: true,
    },
    type_id: {
      notNull: true,
      type: 'smallint',
    },
    anchor_mode: {
      notNull: true,
      type: 'smallint',
    },
    status: {
      notNull: true,
      type: 'smallint',
    },
    post_conditions: {
      type: 'bytea',
      notNull: true,
    },
    nonce: {
      type: 'integer',
      notNull: true,
    },
    fee_rate: {
      type: 'bigint',
      notNull: true,
    },
    sponsored: {
      type: 'boolean',
      notNull: true,
    },
    sponsor_address: {
      type: 'string'
    },
    sponsor_nonce: {
      type: 'integer'
    },
    sender_address: {
      type: 'string',
      notNull: true,
    },
    origin_hash_mode: {
      type: 'smallint',
      notNull: true,
    },

    raw_tx: {
      type: 'bytea',
      notNull: true,
    },
    receipt_time: {
      type: 'integer',
      notNull: true,
    },
    receipt_block_height: {
      type: 'integer',
      notNull: true,
    },

    // `token-transfer` tx types
    token_transfer_recipient_address: 'string',
    token_transfer_amount: 'bigint',
    token_transfer_memo: 'bytea',

    // `versioned-smart-contract` tx types
    smart_contract_clarity_version: 'smallint',

    // `smart-contract` tx types
    smart_contract_contract_id: 'string',
    smart_contract_source_code: 'string',

    // `contract-call` tx types
    contract_call_contract_id: 'string',
    contract_call_function_name: 'string',
    contract_call_function_args: 'bytea',

    // `poison-microblock` tx types
    poison_microblock_header_1: 'bytea',
    poison_microblock_header_2: 'bytea',

    // `coinbase` tx types
    coinbase_payload: 'bytea',

    // `coinbase-pay-to-alt` tx types
    coinbase_alt_recipient: 'string',

    tx_size: {
      type: 'integer',
      notNull: true,
      expressionGenerated: 'length(raw_tx)'
    }
  });

  pgm.createIndex('mempool_txs', 'tx_id', { method: 'hash' });
  pgm.createIndex('mempool_txs', 'contract_call_contract_id', { method: 'hash' });
  pgm.createIndex('mempool_txs', 'nonce');
  pgm.createIndex('mempool_txs', 'sender_address', { method: 'hash' });
  pgm.createIndex('mempool_txs', 'smart_contract_contract_id', { method: 'hash' });
  pgm.createIndex('mempool_txs', 'sponsor_address', { method: 'hash' });
  pgm.createIndex('mempool_txs', 'token_transfer_recipient_address', { method: 'hash' });
  pgm.createIndex('mempool_txs', [{ name: 'receipt_time', sort: 'DESC' }]);
  pgm.createIndex('mempool_txs', ['type_id', 'receipt_block_height'], { where: 'pruned = false'});
  pgm.createIndex('mempool_txs', ['type_id', 'fee_rate'], { where: 'pruned = false'});
  pgm.createIndex('mempool_txs', ['type_id', 'tx_size'], { where: 'pruned = false'});

  pgm.addConstraint('mempool_txs', 'unique_tx_id', `UNIQUE(tx_id)`);

  pgm.addConstraint('mempool_txs', 'valid_token_transfer', `CHECK (type_id != 0 OR (
    NOT (token_transfer_recipient_address, token_transfer_amount, token_transfer_memo) IS NULL
  ))`);

  pgm.addConstraint('mempool_txs', 'valid_smart_contract', `CHECK (type_id != 1 OR (
    NOT (smart_contract_contract_id, smart_contract_source_code) IS NULL
  ))`);

  pgm.addConstraint('mempool_txs', 'valid_versioned_smart_contract', `CHECK (type_id != 6 OR (
    NOT (smart_contract_clarity_version, smart_contract_contract_id, smart_contract_source_code) IS NULL
  ))`);

  pgm.addConstraint('mempool_txs', 'valid_contract_call', `CHECK (type_id != 2 OR (
    NOT (contract_call_contract_id, contract_call_function_name, contract_call_function_args) IS NULL
  ))`);

  pgm.addConstraint('mempool_txs', 'valid_poison_microblock', `CHECK (type_id != 3 OR (
    NOT (poison_microblock_header_1, poison_microblock_header_2) IS NULL
  ))`);

  pgm.addConstraint('mempool_txs', 'valid_coinbase', `CHECK (type_id != 4 OR (
    NOT (coinbase_payload) IS NULL
  ))`);

  pgm.addConstraint('mempool_txs', 'valid_coinbase-pay-to-alt', `CHECK (type_id != 5 OR (
    NOT (coinbase_payload, coinbase_alt_recipient) IS NULL
  ))`);
}
