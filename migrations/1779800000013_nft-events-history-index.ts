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
 * Supports `/v3/tokens/nft/:asset_identifier/:value/history`, which keyset-paginates one token
 * instance's event history by chain position, newest first.
 *
 * The existing `(asset_identifier, value)` index can find the rows but carries no ordering, so a
 * page needs a sort over the instance's whole history. That index is left in place: it is
 * non-partial and is also used over non-canonical rows when `nft_custody` is rebuilt on reorg.
 *
 * The planner only picks this index once an instance has a long history; for the short histories
 * that are the norm it prefers the existing index plus a top-N sort, which is cheaper. That is
 * the intent — this index exists to bound the pathological case.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.createIndex('nft_events', ['asset_identifier', 'value', ...POSITION_COLUMNS], {
    name: 'nft_events_asset_value_position_index',
    where: CANONICAL,
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropIndex('nft_events', [], { name: 'nft_events_asset_value_position_index' });
}
