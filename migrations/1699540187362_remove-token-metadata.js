/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.dropTable('token_metadata_queue');
  pgm.dropTable('nft_metadata');
  pgm.dropTable('ft_metadata');
};

exports.down = pgm => {
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
  pgm.createTable('ft_metadata', {
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
    symbol: {
      type: 'string',
      notNull: true,
    },
    decimals: {
      type: 'integer',
      notNull: true,
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
  pgm.createIndex('ft_metadata', 'contract_id', { method: 'hash' });
}
