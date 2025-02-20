/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.createIndex('event_observer_requests', [
    'event_path',
    { name: 'receive_timestamp', sort: 'DESC' },
  ]);
};
