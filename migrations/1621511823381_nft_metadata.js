/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.createTable('nft_metadata', {
    id: {
      type: 'serial',
      primaryKey: true,
    },
    name: {
      type: 'string',
      notNull: true,
    },
    token_uri: {
      type: 'string',
      notNull: true,
    },
    description: {
      type: 'string',
      notNull: true,
    },
    image_uri: {
      type: 'string',
      notNull: true,
    }, 
    image_canonical_uri: {
      type: 'string', 
      notNull: true,
    }, 
    contract_id: {
      type: 'string', 
      notNull: true, 
      unique: true,
    },
    tx_id: {
      type: 'bytea',
      notNull: true,
    },
    sender_address: {
      type: 'string', 
      notNull: true, 
    }
  });

  pgm.createIndex('nft_metadata', 'contract_id', { method: 'hash' });
}
