/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.alterColumn('namespaces', 'nonalpha_discount', {
    type: 'numeric'
  })
  pgm.alterColumn('namespaces', 'no_vowel_discount', {
    type: 'numeric'
  })
};

exports.down = pgm => {
  pgm.alterColumn('namespaces', 'nonalpha_discount', {
    type: 'numeric'
  })
  pgm.alterColumn('namespaces', 'no_vowel_discount', {
    type: 'numeric'
  })
};
