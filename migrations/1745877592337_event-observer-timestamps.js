/* eslint-disable camelcase */

exports.shorthands = undefined;

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
};
