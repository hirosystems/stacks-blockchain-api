import { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export function up(pgm: MigrationBuilder) {
  pgm.createTable('principal_tx_balance_changes', {
    principal: {
      type: 'text',
      notNull: true,
    },
    tx_id: {
      type: 'bytea',
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
    microblock_hash: {
      type: 'bytea',
      notNull: true,
    },
    microblock_sequence: {
      type: 'integer',
      notNull: true,
    },
    tx_index: {
      type: 'smallint',
      notNull: true,
    },
    canonical: {
      type: 'boolean',
      notNull: true,
    },
    microblock_canonical: {
      type: 'boolean',
      notNull: true,
    },
    asset_type: {
      type: 'smallint', // 1: STX, 2: FT, 3: NFT
      notNull: true,
    },
    asset_identifier: {
      type: 'text',
      notNull: true,
    },
    sent: {
      type: 'numeric',
      notNull: true,
    },
    received: {
      type: 'numeric',
      notNull: true,
    },
  });

  pgm.addConstraint(
    'principal_tx_balance_changes',
    'unique_principal_tx_balance_changes',
    'UNIQUE(principal, tx_id, index_block_hash, microblock_hash, asset_type, asset_identifier)'
  );

  pgm.createIndex('principal_tx_balance_changes', 'tx_id');
  pgm.createIndex('principal_tx_balance_changes', ['index_block_hash', 'canonical']);
  pgm.createIndex('principal_tx_balance_changes', 'microblock_hash');

  pgm.addColumn('principal_txs', {
    balance_change_count: {
      type: 'integer',
      notNull: true,
      default: 0,
    },
  });
}
