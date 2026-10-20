import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Stores each Bitcoin block's header time on its `burn_blocks` row. The node reports a Bitcoin
 * block's time only on the Stacks blocks anchored to it (`/new_burn_block` carries none), so the
 * time is copied from the first Stacks block ingested for that Bitcoin block hash, whichever of the
 * two arrives first. A header time belongs to the Bitcoin block hash, not to its canonical status,
 * so re-orgs never need to revert it. Bitcoin blocks no Stacks block anchored to (e.g. missed
 * sortitions) stay `NULL`.
 *
 * The backfill reads every `blocks` row once, aggregated per Bitcoin block hash (every Stacks
 * block anchored to one hash reports the same header time).
 */
export const BACKFILL_BURN_BLOCK_TIMES_SQL = `
  UPDATE burn_blocks AS bb
  SET burn_block_time = b.burn_block_time
  FROM (
    SELECT burn_block_hash, MIN(burn_block_time) AS burn_block_time
    FROM blocks
    GROUP BY burn_block_hash
  ) AS b
  WHERE bb.burn_block_hash = b.burn_block_hash
`;

export function up(pgm: MigrationBuilder): void {
  pgm.addColumn('burn_blocks', {
    burn_block_time: {
      type: 'integer',
    },
  });
  pgm.sql(BACKFILL_BURN_BLOCK_TIMES_SQL);
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropColumn('burn_blocks', 'burn_block_time');
}
