import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('event_observer_timestamps', {
    event_path: {
      type: 'string',
      primaryKey: true,
    },
    id: {
      type: 'bigint',
      notNull: true,
    },
    receive_timestamp: {
      type: 'timestamptz',
      notNull: true,
    },
  });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('event_observer_timestamps');
}

