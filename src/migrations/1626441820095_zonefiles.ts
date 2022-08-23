/* eslint-disable @typescript-eslint/camelcase */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('zonefiles', {
    id: {
      type: 'serial',
      primaryKey: true,
    },
    name: {
      type: 'string',
      notNull: true,
    },
    zonefile: {
      type: 'string',
      notNull: true,
    },
    zonefile_hash: {
      type: 'string',
      notNull: true,
    },
    tx_id: {
      type: 'bytea',
      notNull: false,
    },
    index_block_hash: {
      type: 'bytea',
      notNull: false,
    }
  });

  pgm.addIndex('zonefiles', 'zonefile_hash');
  pgm.addConstraint(
    'zonefiles',
    'unique_name_zonefile_hash_tx_id_index_block_hash',
    'UNIQUE(name, zonefile_hash, tx_id, index_block_hash)'
  );
}
