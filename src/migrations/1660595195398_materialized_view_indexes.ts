/* eslint-disable @typescript-eslint/camelcase */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  // Add LIMIT 1 to chain_tip view so we can add the uniqueness index for `block_height`.
  pgm.dropMaterializedView('chain_tip');
  pgm.createMaterializedView('chain_tip', {}, `
    WITH block_tip AS (
      SELECT block_height, block_hash, index_block_hash
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

  pgm.addIndex('chain_tip', 'block_height', { unique: true });
  pgm.addIndex('mempool_digest', 'digest', { unique: true });
  pgm.addIndex('nft_custody', ['asset_identifier', 'value'], { unique: true });
  pgm.addIndex('nft_custody_unanchored', ['asset_identifier', 'value'], { unique: true });
}

export async function down(pgm: MigrationBuilder): Promise<void> {
  pgm.dropIndex('chain_tip', 'block_height', { unique: true, ifExists: true });
  pgm.dropIndex('mempool_digest', 'digest', { unique: true, ifExists: true });
  pgm.dropIndex('nft_custody', ['asset_identifier', 'value'], { unique: true, ifExists: true });
  pgm.dropIndex('nft_custody_unanchored', ['asset_identifier', 'value'], { unique: true, ifExists: true });

  pgm.dropMaterializedView('chain_tip');
  pgm.createMaterializedView('chain_tip', {}, `
    WITH block_tip AS (
      SELECT block_height, block_hash, index_block_hash
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
  `);
}
