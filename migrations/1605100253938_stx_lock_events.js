/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.createTable('stx_lock_events', {
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
    locked_amount: {
      type: 'numeric',
      notNull: true,
    },
    unlock_height: {
      type: 'integer',
      notNull: true,
    },
    locked_address: {
      type: 'string',
      notNull: true,
    },
    contract_name: {
      type: 'string',
      notNull: true,
    }
  });

  pgm.createIndex('stx_lock_events', [
    { name: 'block_height', sort: 'DESC' },
    { name: 'microblock_sequence', sort: 'DESC' },
    { name: 'tx_index', sort: 'DESC' },
  ]);

  pgm.createIndex('stx_lock_events', 'tx_id', { method: 'hash' });
  pgm.createIndex('stx_lock_events', 'index_block_hash', { method: 'hash' });
  pgm.createIndex('stx_lock_events', 'microblock_hash', { method: 'hash' });
  pgm.createIndex('stx_lock_events', 'locked_address', { method: 'hash' });
  pgm.createIndex('stx_lock_events', [{ name: 'block_height', sort: 'DESC' }]);
  pgm.createIndex('stx_lock_events', [{ name: 'unlock_height', sort: 'DESC' }]);
  pgm.createIndex('stx_lock_events', 'contract_name');
}
