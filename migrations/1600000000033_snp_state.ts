import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('snp_state', {
    id: {
      type: 'boolean',
      primaryKey: true,
      default: true,
    },
    last_redis_msg_id: {
      type: 'text',
      notNull: true,
      default: '0',
    },
  });

  // Ensure only a single row can exist
  pgm.addConstraint('snp_state', 'snp_state_one_row', 'CHECK(id)');
  // Create the single row
  pgm.sql('INSERT INTO snp_state VALUES(DEFAULT)');
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('snp_state');
}

