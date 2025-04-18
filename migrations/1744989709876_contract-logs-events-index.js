/* eslint-disable camelcase */

exports.shorthands = undefined;

exports.up = pgm => {
  pgm.dropIndex('contract_logs', 'contract_identifier');
  pgm.dropIndex('contract_logs', [
    { name: 'block_height', sort: 'DESC' },
    { name: 'microblock_sequence', sort: 'DESC' },
    { name: 'tx_index', sort: 'DESC' },
    { name: 'event_index', sort: 'DESC' },
  ]);

  pgm.createIndex(
    'contract_logs',
    [
      'contract_identifier',
      { name: 'block_height', sort: 'DESC' },
      { name: 'microblock_sequence', sort: 'DESC' },
      { name: 'tx_index', sort: 'DESC' },
      { name: 'event_index', sort: 'DESC' },
    ],
    { where: 'canonical = TRUE AND microblock_canonical = TRUE' }
  );
};

exports.down = pgm => {
  pgm.dropIndex(
    'contract_logs',
    [
      'contract_identifier',
      { name: 'block_height', sort: 'DESC' },
      { name: 'microblock_sequence', sort: 'DESC' },
      { name: 'tx_index', sort: 'DESC' },
      { name: 'event_index', sort: 'DESC' },
    ],
    { where: 'canonical = TRUE AND microblock_canonical = TRUE' }
  );

  pgm.createIndex('contract_logs', 'contract_identifier');
  pgm.createIndex('contract_logs', [
    { name: 'block_height', sort: 'DESC' },
    { name: 'microblock_sequence', sort: 'DESC' },
    { name: 'tx_index', sort: 'DESC' },
    { name: 'event_index', sort: 'DESC' },
  ]);
};
