/* eslint-disable @typescript-eslint/camelcase */
import { MigrationBuilder, ColumnDefinitions } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

export async function up(pgm: MigrationBuilder): Promise<void> {
  pgm.createMaterializedView('chain_tip', {}, `
    WITH block_s AS (
      SELECT MAX(block_height) AS blocks
      FROM blocks
      WHERE canonical = TRUE
    ), microblock_s AS (
      SELECT COUNT(*)::INTEGER AS microblocks
      FROM microblocks
      WHERE canonical = TRUE AND microblock_canonical = TRUE
    ), tx_s AS (
      SELECT COUNT(*)::INTEGER AS txs
      FROM txs
      WHERE canonical = TRUE AND microblock_canonical = TRUE
        AND block_height <= (SELECT MAX(block_height) FROM blocks WHERE canonical = TRUE)
    ), tx_s_unanchored AS (
      SELECT COUNT(*)::INTEGER AS txs_unanchored
      FROM txs
      WHERE canonical = TRUE AND microblock_canonical = TRUE
    )
    SELECT block_s.blocks AS block_height, *
    FROM block_s
    CROSS JOIN microblock_s
    CROSS JOIN tx_s
    CROSS JOIN tx_s_unanchored
  `);
}
