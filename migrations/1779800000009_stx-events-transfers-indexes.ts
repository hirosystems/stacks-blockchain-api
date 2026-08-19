import type { MigrationBuilder } from 'node-pg-migrate';

const POSITION_COLUMNS = [
  { name: 'block_height', sort: 'DESC' },
  { name: 'microblock_sequence', sort: 'DESC' },
  { name: 'tx_index', sort: 'DESC' },
  { name: 'event_index', sort: 'DESC' },
] as const;

// Supports the `/v3/principals/:principal/transfers/stx/inbound` and `/outbound` endpoints:
// keyset pagination of a principal's STX events (transfers and mints for the recipient side,
// transfers and burns for the sender side), newest first.
//
// The indexes cover all asset event types and are intentionally NOT partial: their leading
// columns replace the previous single-column `recipient` and `sender` indexes (dropped below),
// which also served queries spanning all event types (e.g. STX balance sums include mints and
// burns) and, in some cases, rows regardless of canonicality.
export const up = (pgm: MigrationBuilder) => {
  pgm.createIndex('stx_events', ['recipient', ...POSITION_COLUMNS], {
    name: 'stx_events_recipient_position_index',
  });
  pgm.createIndex('stx_events', ['sender', ...POSITION_COLUMNS], {
    name: 'stx_events_sender_position_index',
  });
  // Redundant now that the composite indexes above lead with the same columns.
  pgm.dropIndex('stx_events', 'recipient');
  pgm.dropIndex('stx_events', 'sender');
};

export const down = (pgm: MigrationBuilder) => {
  pgm.createIndex('stx_events', 'recipient');
  pgm.createIndex('stx_events', 'sender');
  pgm.dropIndex('stx_events', [], { name: 'stx_events_recipient_position_index' });
  pgm.dropIndex('stx_events', [], { name: 'stx_events_sender_position_index' });
};
