import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Supports the principal NFT balances endpoint, which lists a principal's owned
 * NFT instances keyset-paginated by `(asset_identifier, value)`. The existing
 * `(recipient, asset_identifier)` index does not include `value`, so this adds
 * it as the trailing key, letting the
 * `WHERE recipient = $1 ... ORDER BY asset_identifier, value` scan be served
 * directly from the index.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.createIndex('nft_custody', [
    { name: 'recipient' },
    { name: 'asset_identifier' },
    { name: 'value' },
  ]);
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropIndex('nft_custody', [
    { name: 'recipient' },
    { name: 'asset_identifier' },
    { name: 'value' },
  ]);
}
