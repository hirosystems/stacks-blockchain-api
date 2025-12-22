/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
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

exports.down = pgm => {
  pgm.dropTable('event_observer_timestamps');
}

