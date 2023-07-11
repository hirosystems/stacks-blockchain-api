/** @param { import("node-pg-migrate").MigrationBuilder } pgm */

const INDEX_METHOD = process.env.PG_IDENT_INDEX_TYPE;

exports.up = pgm => {
  pgm.createTable('smart_contracts', {
    id: {
      type: 'serial',
      primaryKey: true,
    },
    tx_id: {
      type: 'bytea',
      notNull: true,
    },
    canonical: {
      type: 'boolean',
      notNull: true,
    },
    contract_id: {
      type: 'string',
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
    clarity_version: {
      type: 'smallint',
    },
    source_code: {
      type: 'string',
      notNull: true,
    },
    abi: {
      type: 'jsonb',
      notNull: true,
    },
  });

  pgm.createIndex('smart_contracts', 'index_block_hash', { method: INDEX_METHOD });
  pgm.createIndex('smart_contracts', 'microblock_hash', { method: INDEX_METHOD });
  pgm.createIndex('smart_contracts', 'contract_id', { method: INDEX_METHOD });
}
