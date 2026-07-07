import type { MigrationBuilder } from 'node-pg-migrate';

export const up = (pgm: MigrationBuilder) => {
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

export const down = (pgm: MigrationBuilder) => {
  pgm.dropTable('event_observer_timestamps');
}

