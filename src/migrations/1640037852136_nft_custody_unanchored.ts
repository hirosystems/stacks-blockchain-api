/* eslint-disable @typescript-eslint/camelcase */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createMaterializedView('nft_custody_unanchored', {}, `
    SELECT
      DISTINCT ON(asset_identifier, value) asset_identifier, value, recipient, tx_id
    FROM
      nft_events
    ORDER BY
      asset_identifier DESC,
      value DESC,
      block_height DESC,
      microblock_sequence DESC,
      tx_index DESC,
      event_index DESC
  `);

  pgm.createIndex('nft_custody_unanchored', ['asset_identifier', 'value']);
  pgm.createIndex('nft_custody_unanchored', 'asset_identifier');
  pgm.createIndex('nft_custody_unanchored', 'recipient');
}
