import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('txs', {
    tx_id: {
      primaryKey: true,
      type: 'bytea',
    },
    tx_index: {
      notNull: true,
      type: 'smallint'
    },
    block_hash: {
      type: 'bytea',
      notNull: true,
    },
    block_height: {
      type: 'integer',
      notNull: true, 
    },
    type_id: {
      notNull: true,
      type: 'smallint',
    },
    status: {
      notNull: true,
      type: 'smallint',
    },
    canonical: {
      type: 'boolean',
      notNull: true,
    },
    post_conditions: {
      type: 'bytea',
    },
  });
  pgm.createIndex('txs', 'block_hash')
  pgm.createIndex('txs', 'type_id');
  pgm.createIndex('txs', 'block_height');
  pgm.createIndex('txs', 'canonical');
}

/*
export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('txs');
}
*/
