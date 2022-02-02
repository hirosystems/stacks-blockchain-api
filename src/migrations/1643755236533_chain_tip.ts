/* eslint-disable @typescript-eslint/camelcase */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createMaterializedView('chain_tip', {}, `
    WITH block_stats AS (
      SELECT block_height, block_hash, index_block_hash
        FROM blocks
        WHERE block_height = (SELECT MAX(block_height) FROM blocks WHERE canonical = TRUE)
    ), microblock_stats AS (
      SELECT microblock_hash
      FROM microblocks
      WHERE canonical = TRUE AND microblock_canonical = TRUE
      ORDER BY block_height DESC
      LIMIT 1
    ), microblock_count AS (
      SELECT COUNT(*)::INTEGER AS microblock_count
      FROM microblocks
      WHERE canonical = TRUE AND microblock_canonical = TRUE
    ), tx_count AS (
      SELECT COUNT(*)::INTEGER AS tx_count
      FROM txs
      WHERE canonical = TRUE AND microblock_canonical = TRUE
        AND block_height <= (SELECT MAX(block_height) FROM blocks WHERE canonical = TRUE)
    ), tx_count_unanchored AS (
      SELECT COUNT(*)::INTEGER AS tx_count_unanchored
      FROM txs
      WHERE canonical = TRUE AND microblock_canonical = TRUE
    )
    SELECT *, block_stats.block_height AS block_count
    FROM block_stats
    CROSS JOIN microblock_stats
    CROSS JOIN microblock_count
    CROSS JOIN tx_count
    CROSS JOIN tx_count_unanchored
  `);
}
