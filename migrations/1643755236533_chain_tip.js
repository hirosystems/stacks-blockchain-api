/** @param { import("node-pg-migrate").MigrationBuilder } pgm */
exports.up = pgm => {
  pgm.createMaterializedView('chain_tip', {}, `
    WITH block_tip AS (
      SELECT block_height, block_hash, index_block_hash, burn_block_height
        FROM blocks
        WHERE block_height = (SELECT MAX(block_height) FROM blocks WHERE canonical = TRUE)
    ),
    microblock_tip AS (
      SELECT microblock_hash, microblock_sequence
      FROM microblocks, block_tip
      WHERE microblocks.parent_index_block_hash = block_tip.index_block_hash
      AND microblock_canonical = true AND canonical = true
      ORDER BY microblock_sequence DESC
      LIMIT 1
    ),
    microblock_count AS (
      SELECT COUNT(*)::INTEGER AS microblock_count
      FROM microblocks
      WHERE canonical = TRUE AND microblock_canonical = TRUE
    ),
    tx_count AS (
      SELECT COUNT(*)::INTEGER AS tx_count
      FROM txs
      WHERE canonical = TRUE AND microblock_canonical = TRUE
        AND block_height <= (SELECT MAX(block_height) FROM blocks WHERE canonical = TRUE)
    ),
    tx_count_unanchored AS (
      SELECT COUNT(*)::INTEGER AS tx_count_unanchored
      FROM txs
      WHERE canonical = TRUE AND microblock_canonical = TRUE
    )
    SELECT *, block_tip.block_height AS block_count
    FROM block_tip
    LEFT JOIN microblock_tip ON TRUE
    LEFT JOIN microblock_count ON TRUE
    LEFT JOIN tx_count ON TRUE
    LEFT JOIN tx_count_unanchored ON TRUE
    LIMIT 1
  `);

  pgm.createIndex('chain_tip', 'block_height', { unique: true });
}
