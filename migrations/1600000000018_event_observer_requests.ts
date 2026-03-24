import type { MigrationBuilder } from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder) => {
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

export const down = (pgm: MigrationBuilder) => {
  pgm.dropTable('event_observer_requests');
}

