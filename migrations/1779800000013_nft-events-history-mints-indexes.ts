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
 * Supports the v3 NFT endpoints, both of which keyset-paginate by chain position, newest first:
 *
 * - `/v3/tokens/nft/:asset_identifier/history`: one token instance's event history. The existing
 *   `(asset_identifier, value)` index can find the rows but carries no ordering, so a page needs a
 *   sort over the instance's whole history. That index is left in place: it is non-partial and is
 *   also used over non-canonical rows when `nft_custody` is rebuilt on reorg.
 * - `/v3/tokens/nft/:asset_identifier/mints`: an asset class's mint events. The existing partial
 *   index on `asset_identifier` for mints is a *hash* index, which cannot serve ordering at all.
 *
 * That hash index is dropped here. Hash indexes are equality-only so its entire value was locating
 * an asset class's mint rows, which `nft_events_asset_mint_position_index` now does with the same
 * leading column plus the ordering. Its only caller is `getNftMints` (`pg-store.ts`), which already
 * restricts to canonical rows and so falls inside the new index's predicate; that caller also backs
 * a v1 endpoint deprecated in this change. One fewer index on a table this size is a meaningful
 * write-path saving.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.createIndex('nft_events', ['asset_identifier', 'value', ...POSITION_COLUMNS], {
    name: 'nft_events_asset_value_position_index',
    where: CANONICAL,
  });
  pgm.createIndex('nft_events', ['asset_identifier', ...POSITION_COLUMNS], {
    name: 'nft_events_asset_mint_position_index',
    where: `${CANONICAL} AND asset_event_type_id = 2`,
  });
  // Superseded by the mint position index above.
  pgm.dropIndex('nft_events', 'asset_identifier', {
    name: 'nft_events_asset_identifier_index',
  });
}

export function down(pgm: MigrationBuilder): void {
  pgm.createIndex('nft_events', 'asset_identifier', {
    name: 'nft_events_asset_identifier_index',
    where: 'asset_event_type_id = 2',
    method: 'hash',
  });
  pgm.dropIndex('nft_events', [], { name: 'nft_events_asset_value_position_index' });
  pgm.dropIndex('nft_events', [], { name: 'nft_events_asset_mint_position_index' });
}
