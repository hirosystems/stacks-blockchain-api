/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.createTable('token_metadata_queue', {
    queue_id: {
      type: 'serial',
      primaryKey: true,
    },
    tx_id: {
      type: 'bytea',
      notNull: true,
    },
    contract_id: {
      type: 'string',
      notNull: true,
    },
    contract_abi: {
      type: 'string',
      notNull: true,
    },
    block_height: {
      type: 'integer',
      notNull: true,
    },
    processed: {
      type: 'boolean',
      notNull: true,
    },
    retry_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    }
  });

  pgm.createIndex('token_metadata_queue', [{ name: 'block_height', sort: 'DESC' }]);
}
