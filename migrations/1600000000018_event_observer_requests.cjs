/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
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

exports.down = pgm => {
  pgm.dropTable('event_observer_requests');
}

