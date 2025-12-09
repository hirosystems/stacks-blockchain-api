/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.createTable('nft_custody', {
    asset_identifier: {
      type: 'string',
      notNull: true,
    },
    value: {
      type: 'bytea',
      notNull: true,
    },
    recipient: {
      type: 'text',
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
    tx_id: {
      type: 'bytea',
      notNull: true,
    },
    tx_index: {
      type: 'smallint',
      notNull: true,
    },
    event_index: {
      type: 'integer',
      notNull: true,
    },
  });

  pgm.createConstraint('nft_custody', 'nft_custody_unique', 'UNIQUE(asset_identifier, value)');
  pgm.createIndex('nft_custody', ['recipient', 'asset_identifier']);
  pgm.createIndex('nft_custody', 'value');
  pgm.createIndex('nft_custody', [
    { name: 'block_height', sort: 'DESC' },
    { name: 'microblock_sequence', sort: 'DESC' },
    { name: 'tx_index', sort: 'DESC' },
    { name: 'event_index', sort: 'DESC' },
  ]);
}

exports.down = pgm => {
  pgm.dropTable('nft_custody');
}

