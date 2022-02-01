import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('nft_events', {
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
    asset_identifier: {
      type: 'string',
      notNull: true,
    },
    value: {
      type: 'bytea',
      notNull: true,
    },
    sender: 'string',
    recipient: 'string',
  });

  pgm.createIndex('nft_events', 'asset_identifier', { where: 'asset_event_type_id = 2' }); // Mints
  pgm.createIndex('nft_events', 'tx_id');
  pgm.createIndex('nft_events', [
    { name: 'block_height', sort: 'DESC'}
  ]);
  pgm.createIndex('nft_events', 'index_block_hash');
  pgm.createIndex('nft_events', 'parent_index_block_hash');
  pgm.createIndex('nft_events', 'microblock_hash');
  pgm.createIndex('nft_events', 'microblock_sequence');
  pgm.createIndex('nft_events', 'sender');
  pgm.createIndex('nft_events', 'recipient');
  pgm.createIndex('nft_events', 'event_index');
  pgm.createIndex('nft_events', ['asset_identifier', 'value']);

  pgm.addConstraint('nft_events', 'valid_asset_transfer', `CHECK (asset_event_type_id != 1 OR (
    NOT (sender, recipient) IS NULL
  ))`);

  pgm.addConstraint('nft_events', 'valid_asset_mint', `CHECK (asset_event_type_id != 2 OR (
    sender IS NULL AND recipient IS NOT NULL
  ))`);

  pgm.addConstraint('nft_events', 'valid_asset_burn', `CHECK (asset_event_type_id != 3 OR (
    recipient IS NULL AND sender IS NOT NULL
  ))`);

}
