/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.createTable('pox_events', {
    id: {
      type: 'bigserial',
      primaryKey: true,
    },
    event_index: {
      type: 'integer',
      notNull: true,
    },
    tx_id: {
      notNull: true,
      type: 'bytea',
    },
    tx_index: {
      type: 'smallint',
      notNull: true,
    },
    block_height: {
      type: 'integer',
      notNull: true,
    },
    index_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    parent_index_block_hash: {
      type: 'bytea',
      notNull: true,
    },
    microblock_hash: {
      type: 'bytea',
      notNull: true,
    },
    microblock_sequence: {
      type: 'integer',
      notNull: true,
    },
    microblock_canonical: {
      type: 'boolean',
      notNull: true,
    },
    canonical: {
      type: 'boolean',
      notNull: true,
    },
    contract_identifier: {
      type: 'string',
      notNull: true,
    },
    stacker: {
      type: 'string',
      notNull: true,
    },
    locked: {
      type: 'numeric',
      notNull: true,
    },
    balance: {
      type: 'numeric',
      notNull: true,
    },
    burnchain_unlock_height: {
      type: 'bigint',
      notNull: true,
    },
    name: {
      type: 'string',
      notNull: true,
    },
    pox_addr: {
      type: 'string',
      notNull: true,
    },
    pox_addr_raw: {
      type: 'bytea',
      notNull: true,
    },
    value: {
      type: 'bytea',
      notNull: true,
    },
    delegator: {
      type: 'string',
    },
    lock_period: {
      type: 'numeric'
    },
    lock_amount: {
      type: 'numeric'
    }
  });

  pgm.createIndex('pox_events', 'tx_id');
  pgm.createIndex('pox_events', 'index_block_hash');
  pgm.createIndex('pox_events', 'microblock_hash');

  pgm.createIndex('pox_events', 'stacker');
}
