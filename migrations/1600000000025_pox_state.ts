import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('pox_state', {
    id: {
      type: 'bool',
      primaryKey: true,
      notNull: true,
      default: true,
    },
    pox_v1_unlock_height: {
      type: 'bigint',
      notNull: true,
      default: 0,
    },
    pox_v2_unlock_height: {
      type: 'bigint',
      notNull: true,
      default: 0,
    },
    pox_v3_unlock_height: {
      type: 'bigint',
      notNull: true,
      default: 0,
    },
  });

  pgm.addConstraint('pox_state', 'only_one_row', 'CHECK(id)');

  // Create the single pox_state row
  pgm.sql('INSERT INTO pox_state VALUES(DEFAULT)');
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('pox_state');
}

