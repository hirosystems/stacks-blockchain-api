/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.createIndex('blocks', ['tenure_height', { name: 'block_height', sort: 'DESC' }]);
};

exports.down = pgm => {
  pgm.dropIndex('blocks', ['tenure_height', { name: 'block_height', sort: 'DESC' }]);
};
