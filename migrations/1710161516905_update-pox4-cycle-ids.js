/* eslint-disable camelcase */

exports.shorthands = undefined;

/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.addColumn('pox4_events', {
    end_cycle_id: {
      type: 'numeric',
    },
    start_cycle_id: {
      type: 'numeric',
    },
  });

  pgm.createIndex('pox4_events', 'end_cycle_id');
  pgm.createIndex('pox4_events', 'start_cycle_id');
};
