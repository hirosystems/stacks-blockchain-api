import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createTable('event_observer_requests', {
    id: {
      type: 'bigserial',
      primaryKey: true,
    },
    receive_timestamp: {
      type: 'timestamptz',
      default: pgm.func('(now() at time zone \'utc\')'),
      notNull: true,
    },
    event_path: {
      type: 'string',
      notNull: true,
    },
    payload: {
      type: 'jsonb',
      notNull: true,
    },
  });
}
