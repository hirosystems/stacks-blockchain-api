import type { MigrationBuilder } from 'node-pg-migrate';

const CANONICAL_EVENT_WHERE = 'canonical = TRUE AND microblock_canonical = TRUE';

export const up = (pgm: MigrationBuilder) => {
  pgm.createIndex('stx_events', ['tx_id', 'event_index'], {
    name: 'stx_events_canonical_tx_id_event_index_idx',
    where: CANONICAL_EVENT_WHERE,
    ifNotExists: true,
  });
  pgm.createIndex('ft_events', ['tx_id', 'event_index'], {
    name: 'ft_events_canonical_tx_id_event_index_idx',
    where: CANONICAL_EVENT_WHERE,
    ifNotExists: true,
  });
  pgm.createIndex('nft_events', ['tx_id', 'event_index'], {
    name: 'nft_events_canonical_tx_id_event_index_idx',
    where: CANONICAL_EVENT_WHERE,
    ifNotExists: true,
  });
  pgm.createIndex('stx_lock_events', ['tx_id', 'event_index'], {
    name: 'stx_lock_events_canonical_tx_id_event_index_idx',
    where: CANONICAL_EVENT_WHERE,
    ifNotExists: true,
  });
  pgm.createIndex('contract_logs', ['tx_id', 'event_index'], {
    name: 'contract_logs_canonical_tx_id_event_index_idx',
    where: CANONICAL_EVENT_WHERE,
    ifNotExists: true,
  });

  // Redundant after adding (tx_id, event_index) indexes above.
  pgm.dropIndex('stx_events', 'tx_id', { ifExists: true });
  pgm.dropIndex('ft_events', 'tx_id', { ifExists: true });
  pgm.dropIndex('nft_events', 'tx_id', { ifExists: true });
  pgm.dropIndex('stx_lock_events', 'tx_id', { ifExists: true });
  pgm.dropIndex('contract_logs', 'tx_id', { ifExists: true });
};

export const down = (pgm: MigrationBuilder) => {
  pgm.createIndex('stx_events', 'tx_id', { ifNotExists: true });
  pgm.createIndex('ft_events', 'tx_id', { ifNotExists: true });
  pgm.createIndex('nft_events', 'tx_id', { ifNotExists: true });
  pgm.createIndex('stx_lock_events', 'tx_id', { ifNotExists: true });
  pgm.createIndex('contract_logs', 'tx_id', { ifNotExists: true });

  pgm.dropIndex('stx_events', [], {
    name: 'stx_events_canonical_tx_id_event_index_idx',
    ifExists: true,
  });
  pgm.dropIndex('ft_events', [], {
    name: 'ft_events_canonical_tx_id_event_index_idx',
    ifExists: true,
  });
  pgm.dropIndex('nft_events', [], {
    name: 'nft_events_canonical_tx_id_event_index_idx',
    ifExists: true,
  });
  pgm.dropIndex('stx_lock_events', [], {
    name: 'stx_lock_events_canonical_tx_id_event_index_idx',
    ifExists: true,
  });
  pgm.dropIndex('contract_logs', [], {
    name: 'contract_logs_canonical_tx_id_event_index_idx',
    ifExists: true,
  });
};
