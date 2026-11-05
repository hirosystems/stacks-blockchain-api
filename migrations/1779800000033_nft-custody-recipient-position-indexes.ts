import type { MigrationBuilder } from 'node-pg-migrate';

const POSITION_DESC = [
  { name: 'block_height', sort: 'DESC' },
  { name: 'microblock_sequence', sort: 'DESC' },
  { name: 'tx_index', sort: 'DESC' },
  { name: 'event_index', sort: 'DESC' },
] as const;

/**
 * Supports the principal NFT balances endpoint, which lists a principal's owned NFT instances
 * newest first by the position of the event that gave them each instance, keyset-paginated
 * optionally within one asset class. The v1 `/tokens/nft/holdings` endpoint sorts the same way.
 *
 * The `(recipient, asset_identifier, <position>)` index also serves every `recipient` +
 * `asset_identifier` lookup (BNS names), so it replaces both the `(recipient, asset_identifier)`
 * and `(recipient, asset_identifier, value)` indexes, leaving the per-write index count unchanged.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.createIndex('nft_custody', [{ name: 'recipient' }, ...POSITION_DESC], {
    name: 'nft_custody_recipient_position_index',
  });
  pgm.createIndex(
    'nft_custody',
    [{ name: 'recipient' }, { name: 'asset_identifier' }, ...POSITION_DESC],
    {
      name: 'nft_custody_recipient_asset_identifier_position_index',
    }
  );
  pgm.dropIndex('nft_custody', ['recipient', 'asset_identifier']);
  pgm.dropIndex('nft_custody', [
    { name: 'recipient' },
    { name: 'asset_identifier' },
    { name: 'value' },
  ]);
}

export function down(pgm: MigrationBuilder): void {
  pgm.createIndex('nft_custody', ['recipient', 'asset_identifier']);
  pgm.createIndex('nft_custody', [
    { name: 'recipient' },
    { name: 'asset_identifier' },
    { name: 'value' },
  ]);
  pgm.dropIndex('nft_custody', [], {
    name: 'nft_custody_recipient_asset_identifier_position_index',
  });
  pgm.dropIndex('nft_custody', [], { name: 'nft_custody_recipient_position_index' });
}
