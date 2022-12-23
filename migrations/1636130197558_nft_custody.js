/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
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
      txs.tx_index DESC,
      nft.event_index DESC
  `);

  pgm.createIndex('nft_custody', ['recipient', 'asset_identifier']);
  pgm.createIndex('nft_custody', ['asset_identifier', 'value'], { unique: true });
  pgm.createIndex('nft_custody', 'value');
}
