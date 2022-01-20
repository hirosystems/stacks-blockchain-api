/* eslint-disable @typescript-eslint/camelcase */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createMaterializedView('nft_custody', {}, `
    SELECT
      DISTINCT ON(asset_identifier, value) asset_identifier, value, recipient, tx_id, nft.block_height
    FROM
      nft_events AS nft
    INNER JOIN
      txs USING (tx_id)
    WHERE
      txs.canonical = true
      AND txs.microblock_canonical = true
      AND nft.canonical = true
      AND nft.microblock_canonical = true
    ORDER BY
      asset_identifier,
      value,
      txs.block_height DESC,
      txs.microblock_sequence DESC,
      txs.tx_index DESC
  `);

  pgm.createIndex('nft_custody', ['recipient', 'asset_identifier']);
}
