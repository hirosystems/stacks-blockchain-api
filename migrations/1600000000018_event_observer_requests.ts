import { MigrationBuilder, ColumnDefinitions} from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

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

  pgm.createIndex('event_observer_requests', [
    'event_path',
    { name: 'receive_timestamp', sort: 'DESC' },
  ]);
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropTable('event_observer_requests');
}

