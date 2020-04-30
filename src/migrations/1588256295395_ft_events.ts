import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('ft_events', {
    id: 'serial',
    event_index: {
      type: 'integer',
      notNull: true,
    },
    tx_id: {
      notNull: true,
      type: 'bytea',
    },
    block_height: {
      type: 'integer',
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
    amount: {
      type: 'numeric(78, 0)', // 78 is the max number of digits for a 256bit integer
      notNull: true,
    },
    sender: 'string',
    recipient: 'string',
  });

  pgm.createIndex('ft_events', 'tx_id');
  pgm.createIndex('ft_events', 'block_height');
  pgm.createIndex('ft_events', 'canonical');
  pgm.createIndex('ft_events', 'asset_identifier');
  pgm.createIndex('ft_events', 'sender');
  pgm.createIndex('ft_events', 'recipient');

  pgm.addConstraint('ft_events', 'valid_asset_transfer', `CHECK (asset_event_type_id != 1 OR (
    NOT (sender, recipient) IS NULL
  ))`);

  pgm.addConstraint('ft_events', 'valid_asset_mint', `CHECK (asset_event_type_id != 2 OR (
    sender IS NULL AND recipient IS NOT NULL
  ))`);

  pgm.addConstraint('ft_events', 'valid_asset_burn', `CHECK (asset_event_type_id != 3 OR (
    recipient IS NULL AND sender IS NOT NULL
  ))`);

}

/*
export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('txs');
}
*/
