import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

const POSITION_COLUMNS = [
  { name: 'block_height', sort: 'DESC' },
  { name: 'microblock_sequence', sort: 'DESC' },
  { name: 'tx_index', sort: 'DESC' },
  { name: 'event_index', sort: 'DESC' },
] as const;

const CANONICAL = 'canonical = TRUE AND microblock_canonical = TRUE';

/**
 * Supports `/v3/principals/:principal/transfers/ft/:asset_identifier`, which pages a principal's
 * events for a single fungible token, newest first, merging the sender and recipient sides.
 *
 * These are additions, not replacements. `idx_ft_events_optimized_{sender,recipient}` lead with the
 * same principal column but put the chain position immediately after it; inserting
 * `asset_identifier` in between breaks the prefix property, so those indexes are still needed to
 * order a principal's FT events across *all* assets (queried from several places in `pg-store.ts`
 * and `pg-store-v2.ts`). Without the new indexes, filtering to one asset means scanning every event
 * the principal has for every token — the whole reason this endpoint exists.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.createIndex('ft_events', ['sender', 'asset_identifier', ...POSITION_COLUMNS], {
    name: 'ft_events_sender_asset_position_index',
    where: CANONICAL,
  });
  pgm.createIndex('ft_events', ['recipient', 'asset_identifier', ...POSITION_COLUMNS], {
    name: 'ft_events_recipient_asset_position_index',
    where: CANONICAL,
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropIndex('ft_events', [], { name: 'ft_events_sender_asset_position_index' });
  pgm.dropIndex('ft_events', [], { name: 'ft_events_recipient_asset_position_index' });
}
