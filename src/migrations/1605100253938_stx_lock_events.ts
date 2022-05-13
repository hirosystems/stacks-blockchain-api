import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

const INDEX_METHOD = process.env.PG_IDENT_INDEX_TYPE as any;

export async function up(pgm: MigrationBuilder): Promise<void> {
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
  });

  pgm.createIndex('stx_lock_events', 'tx_id', { method: INDEX_METHOD });
  pgm.createIndex('stx_lock_events', 'index_block_hash', { method: INDEX_METHOD });
  pgm.createIndex('stx_lock_events', 'microblock_hash', { method: INDEX_METHOD });
  pgm.createIndex('stx_lock_events', 'locked_address', { method: INDEX_METHOD });
  pgm.createIndex('stx_lock_events', [{ name: 'block_height', sort: 'DESC' }]);
  pgm.createIndex('stx_lock_events', [{ name: 'unlock_height', sort: 'DESC' }]);
}
