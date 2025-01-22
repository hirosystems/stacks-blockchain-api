/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.addColumn('blocks', {
    size: {
      type: 'int',
      notNull: true,
      default: 0,
    },
  });
  // TODO: Add migration here for past blocks.
};

exports.down = pgm => {
  pgm.dropColumn('blocks', ['size']);
};
