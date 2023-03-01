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
}
