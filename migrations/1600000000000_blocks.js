/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.createTable('blocks', {
    index_block_hash: {
      type: 'bytea',
      primaryKey: true,
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
    burn_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    burn_block_height: {
      type: 'integer',
      notNull: true,
    },
    miner_txid: {
      type: 'bytea',
      notNull: true,
    },
    parent_index_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    parent_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    parent_microblock_hash: {
      type: 'bytea',
      notNull: true,
    },
    parent_microblock_sequence: {
      type: 'integer',
      notNull: true,
    },
    canonical: {
      type: 'boolean',
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
    tx_count: {
      type: 'int',
      notNull: true,
      default: 1,
    },
    block_time: {
      type: 'integer',
      notNull: true,
      default: '0',
    },
    signer_bitvec: {
      type: 'bit varying',
    },
    tenure_height: {
      type: 'integer',
    },
    signer_signatures: {
      type: 'bytea[]',
    },
    tx_total_size: {
      type: 'int',
    },
  });

  pgm.createIndex('blocks', 'block_hash', { method: 'hash' });
  pgm.createIndex('blocks', [{ name: 'block_height', sort: 'DESC' }]);
  pgm.createIndex('blocks', 'burn_block_hash', { method: 'hash' });
  pgm.createIndex('blocks', [{ name: 'burn_block_height', sort: 'DESC' }]);
  pgm.createIndex('blocks', 'index_block_hash', { method: 'hash' });
  pgm.createIndex('blocks', 'signer_signatures', { method: 'gin' });
  pgm.createIndex('blocks', ['tenure_height', { name: 'block_height', sort: 'DESC' }]);
}

exports.down = pgm => {
  pgm.dropTable('blocks');
}

