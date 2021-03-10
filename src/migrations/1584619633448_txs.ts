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
    burn_block_time: {
      type: 'integer',
      notNull: true,
    },
    type_id: {
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
    sender_address: {
      type: 'string',
      notNull: true,
    },
    origin_hash_mode: {
      type: 'smallint',
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

  pgm.createIndex('txs', 'tx_id');
  pgm.createIndex('txs', 'index_block_hash');
  pgm.createIndex('txs', 'type_id');
  pgm.createIndex('txs', 'block_height');
  pgm.createIndex('txs', 'canonical');
  pgm.createIndex('txs', 'status');
  pgm.createIndex('txs', 'sender_address');
  pgm.createIndex('txs', 'token_transfer_recipient_address');
  pgm.createIndex('txs', 'contract_call_contract_id');
  pgm.createIndex('txs', 'smart_contract_contract_id');

  pgm.addConstraint('txs', 'unique_tx_id_index_block_hash', `UNIQUE(tx_id, index_block_hash)`);

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

/*
export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('txs');
}
*/
