import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('token_offering_locked', {
    id: {
      type: 'serial',
      primaryKey: true,
    },
    address: {
      type: 'string',
      notNull: true,
    },
    value: {
      type: 'bigint',
      notNull: true,
    },
    block: {
      type: 'integer',
      notNull: true,
    },
  });

  pgm.createIndex('token_offering_locked', 'address', { method: 'hash' });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('token_offering_locked');
}

