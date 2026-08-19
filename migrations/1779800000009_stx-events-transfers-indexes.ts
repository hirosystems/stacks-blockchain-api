import type { MigrationBuilder } from 'node-pg-migrate';

// Supports the `/v3/principals/:principal/transfers/stx/inbound` and `/outbound` endpoints:
// keyset pagination of a principal's STX transfer events, newest first.
export const up = (pgm: MigrationBuilder) => {
  pgm.createIndex(
    'stx_events',
    [
      'recipient',
      { name: 'block_height', sort: 'DESC' },
      { name: 'microblock_sequence', sort: 'DESC' },
      { name: 'tx_index', sort: 'DESC' },
      { name: 'event_index', sort: 'DESC' },
    ],
    {
      name: 'stx_events_inbound_transfers_index',
      where: 'canonical = TRUE AND microblock_canonical = TRUE AND asset_event_type_id = 1',
    }
  );
  pgm.createIndex(
    'stx_events',
    [
      'sender',
      { name: 'block_height', sort: 'DESC' },
      { name: 'microblock_sequence', sort: 'DESC' },
      { name: 'tx_index', sort: 'DESC' },
      { name: 'event_index', sort: 'DESC' },
    ],
    {
      name: 'stx_events_outbound_transfers_index',
      where: 'canonical = TRUE AND microblock_canonical = TRUE AND asset_event_type_id = 1',
    }
  );
};

export const down = (pgm: MigrationBuilder) => {
  pgm.dropIndex('stx_events', [], { name: 'stx_events_inbound_transfers_index' });
  pgm.dropIndex('stx_events', [], { name: 'stx_events_outbound_transfers_index' });
};
