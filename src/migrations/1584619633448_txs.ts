import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('txs', {
    id: {
      type: 'serial',
      primaryKey: true,
    },
    tx_id: {
      type: 'bytea',
      notNull: true,
    },
    tx_index: {
      type: 'smallint',
      notNull: true,
    },
    raw_result: {
      type: 'bytea',
      notNull: true,
    },
    index_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    block_hash: {
      type: 'bytea',
      notNull: true,
    },
    block_height: {
      type: 'integer',
      notNull: true,
    },
    parent_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    burn_block_time: {
      type: 'integer',
      notNull: true,
    },
    parent_burn_block_time: {
      type: 'integer',
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
    canonical: {
      type: 'boolean',
      notNull: true,
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
    sender_address: {
      type: 'string',
      notNull: true,
    },
    origin_hash_mode: {
      type: 'smallint',
      notNull: true,
    },
    event_count: {
      type: 'integer',
      notNull: true,
    },
    execution_cost_read_count: {
      type: 'bigint',
      notNull: true,
    },
    execution_cost_read_length: {
      type: 'bigint',
      notNull: true,
    },
    execution_cost_runtime: {
      type: 'bigint',
      notNull: true,
    },
    execution_cost_write_count: {
      type: 'bigint',
      notNull: true,
    },
    execution_cost_write_length: {
      type: 'bigint',
      notNull: true,
    },

    raw_tx: {
      type: 'bytea',
      notNull: true,
    },

    microblock_canonical: {
      type: 'boolean',
      notNull: true,
    },
    // Set to -1 for batched txs (txs that were not in a microblock)
    microblock_sequence: {
      type: 'integer',
      notNull: true,
    },
    // TODO(mb): allow this to be null instead of empty bytes for batched txs?
    microblock_hash: {
      type: 'bytea',
      notNull: true,
    },
    parent_index_block_hash: {
      type: 'bytea',
      notNull: true,
    },

    // `token-transfer` tx types
    token_transfer_recipient_address: 'string',
    token_transfer_amount: 'bigint',
    token_transfer_memo: 'bytea',

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
  });

  pgm.createIndex('txs', 'contract_call_contract_id');
  pgm.createIndex('txs', 'index_block_hash');
  pgm.createIndex('txs', 'microblock_hash');
  pgm.createIndex('txs', 'parent_index_block_hash');
  pgm.createIndex('txs', 'sender_address');
  pgm.createIndex('txs', 'smart_contract_contract_id');
  pgm.createIndex('txs', 'sponsor_address');
  pgm.createIndex('txs', 'status');
  pgm.createIndex('txs', 'token_transfer_recipient_address');
  pgm.createIndex('txs', 'type_id');
  pgm.createIndex('txs', [
    { name: 'block_height', sort: 'DESC' },
    { name: 'microblock_sequence', sort: 'DESC' },
    { name: 'tx_index', sort: 'DESC' },
  ]);
  pgm.createIndex('txs', [
    { name: 'microblock_sequence', sort: 'DESC' },
    { name: 'tx_index', sort: 'DESC' },
  ]);
  pgm.createIndex('txs', [
    { name: 'tx_index', sort: 'DESC' },
  ]);

  pgm.addConstraint('txs', 'unique_tx_id_index_block_hash_microblock_hash', `UNIQUE(tx_id, index_block_hash, microblock_hash)`);

  // TODO(mb): a unique constraint that enforced something like UNIQUE(tx_id, canonical = true, microblock_canonical = true)
  // pgm.addConstraint('txs', 'unique_tx_id_index_block_hash', `UNIQUE(tx_id, canonical)`);

  pgm.addConstraint('txs', 'valid_token_transfer', `CHECK (type_id != 0 OR (
    NOT (token_transfer_recipient_address, token_transfer_amount, token_transfer_memo) IS NULL
  ))`);

  pgm.addConstraint('txs', 'valid_smart_contract', `CHECK (type_id != 1 OR (
    NOT (smart_contract_contract_id, smart_contract_source_code) IS NULL
  ))`);

  pgm.addConstraint('txs', 'valid_contract_call', `CHECK (type_id != 2 OR (
    NOT (contract_call_contract_id, contract_call_function_name, contract_call_function_args) IS NULL
  ))`);

  pgm.addConstraint('txs', 'valid_poison_microblock', `CHECK (type_id != 3 OR (
    NOT (poison_microblock_header_1, poison_microblock_header_2) IS NULL
  ))`);

  pgm.addConstraint('txs', 'valid_coinbase', `CHECK (type_id != 4 OR (
    NOT (coinbase_payload) IS NULL
  ))`);
}
