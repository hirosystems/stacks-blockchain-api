/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.addColumn('event_observer_requests', {
    sequence_id: {
      type: 'string'
    }
  });
};

exports.down = pgm => {
  pgm.dropColumn('event_observer_requests', 'sequence_id');
};
