import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('stx_events', {
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
    asset_event_type_id: {
      type: 'smallint',
      notNull: true,
    },
    amount: {
      type: 'bigint',
      notNull: true,
    },
    sender: 'string',
    recipient: 'string',
  });

  pgm.createIndex('stx_events', 'tx_id');
  pgm.createIndex('stx_events', 'block_height');
  pgm.createIndex('stx_events', 'index_block_hash');
  pgm.createIndex('stx_events', 'parent_index_block_hash');
  pgm.createIndex('stx_events', 'microblock_hash');
  pgm.createIndex('stx_events', 'microblock_sequence');
  pgm.createIndex('stx_events', 'microblock_canonical');
  pgm.createIndex('stx_events', 'canonical');
  pgm.createIndex('stx_events', 'sender');
  pgm.createIndex('stx_events', 'recipient');
  pgm.createIndex('stx_events', 'event_index');

  pgm.createIndex('stx_events', ['canonical', 'microblock_canonical']);
  pgm.createIndex('stx_events', ['sender', 'block_height']);
  pgm.createIndex('stx_events', ['recipient', 'block_height']);

  // TODO(mb): this and other tx metadata rows could probably only use a composite index on (parent_index_block_hash, microblock_hash)?
  // also maybe only a composite index on (canonical, microblock_canonical)?

  pgm.addConstraint('stx_events', 'valid_asset_transfer', `CHECK (asset_event_type_id != 1 OR (
    NOT (sender, recipient) IS NULL
  ))`);

  pgm.addConstraint('stx_events', 'valid_asset_mint', `CHECK (asset_event_type_id != 2 OR (
    sender IS NULL AND recipient IS NOT NULL
  ))`);

  pgm.addConstraint('stx_events', 'valid_asset_burn', `CHECK (asset_event_type_id != 3 OR (
    recipient IS NULL AND sender IS NOT NULL
  ))`);

}
