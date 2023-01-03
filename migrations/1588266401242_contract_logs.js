/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.createTable('contract_logs', {
    id: {
      type: 'serial',
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
    topic: {
      type: 'string',
      notNull: true,
    },
    value: {
      type: 'bytea',
      notNull: true,
    },
  });

  pgm.createIndex('contract_logs', 'tx_id', { method: 'hash' });
  pgm.createIndex('contract_logs', 'index_block_hash', { method: 'hash' });
  pgm.createIndex('contract_logs', 'microblock_hash', { method: 'hash' });
  pgm.createIndex('contract_logs', 'event_index');
}
