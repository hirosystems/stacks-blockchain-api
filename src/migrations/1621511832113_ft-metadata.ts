/* eslint-disable @typescript-eslint/camelcase */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
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

  pgm.createIndex('ft_metadata', 'name');
  pgm.createIndex('ft_metadata', 'symbol');
  pgm.createIndex('ft_metadata', 'contract_id');
  pgm.createIndex('ft_metadata', 'tx_id');
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('ft_metadata');
}
