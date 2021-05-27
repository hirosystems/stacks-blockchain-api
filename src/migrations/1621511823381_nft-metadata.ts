/* eslint-disable @typescript-eslint/camelcase */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('nft_metadata', {
    id: {
      type: 'serial',
      primaryKey: true,
    },
    name: {
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
    }
    });

    pgm.createIndex('nft_metadata', 'name');
    pgm.createIndex('nft_metadata', 'description');
    pgm.createIndex('nft_metadata', 'image_uri');
    pgm.createIndex('nft_metadata', 'image_canonical_uri');
    pgm.createIndex('nft_metadata', 'contract_id');

}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('nft_metadata')
}
