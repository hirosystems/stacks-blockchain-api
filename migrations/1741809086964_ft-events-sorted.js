// @ts-check
/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.createIndex(
    'ft_events', 
    [
      'sender',
      { name: 'block_height', sort: 'DESC' },
      { name: 'microblock_sequence', sort: 'DESC' },
      { name: 'tx_index', sort: 'DESC' },
      { name: 'event_index', sort: 'DESC' }
    ],
    {
      name: 'idx_ft_events_optimized_sender',
      where: 'canonical = TRUE AND microblock_canonical = TRUE',
    }
  );

  pgm.createIndex(
    'ft_events', 
    [
      'recipient',
      { name: 'block_height', sort: 'DESC' },
      { name: 'microblock_sequence', sort: 'DESC' },
      { name: 'tx_index', sort: 'DESC' },
      { name: 'event_index', sort: 'DESC' }
    ],
    {
      name: 'idx_ft_events_optimized_recipient',
      where: 'canonical = TRUE AND microblock_canonical = TRUE',
    }
  );
};
