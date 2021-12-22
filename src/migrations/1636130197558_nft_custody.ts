/* eslint-disable @typescript-eslint/camelcase */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createMaterializedView('nft_custody', {}, `
    SELECT
      DISTINCT ON(asset_identifier, value) asset_identifier, value, recipient, tx_id
    FROM
      nft_events
    WHERE
      canonical = true AND microblock_canonical = true
    ORDER BY
      asset_identifier DESC,
      value DESC,
      block_height DESC,
      microblock_sequence DESC,
      tx_index DESC,
      event_index DESC
  `);

  pgm.createIndex('nft_custody', ['asset_identifier', 'value']);
  pgm.createIndex('nft_custody', 'asset_identifier');
  pgm.createIndex('nft_custody', 'recipient');
}
