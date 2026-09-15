import type { ColumnDefinitions, MigrationBuilder } from 'node-pg-migrate';

export const shorthands: ColumnDefinitions | undefined = undefined;

/**
 * Per-staker lookup of the pox-5 STX-only stake state events (`stake`, `stake-update`, `unstake`),
 * newest first. The staking cycle endpoint derives a cycle's STX-only stake as of the cycle's start
 * from each staker's latest such event before that height (the contract fixes a cycle's shares when
 * it starts, and stakes rolled into a bond keep their shares through their original term even
 * though their materialized lock row is gone) so this is a DISTINCT ON per staker over those
 * events. Partial on the three event names; the table's other indexes lead with block position, tx
 * or block hash.
 */
export function up(pgm: MigrationBuilder): void {
  pgm.createIndex(
    'pox5_events',
    [
      "(data->>'staker')",
      { name: 'block_height', sort: 'DESC' },
      { name: 'microblock_sequence', sort: 'DESC' },
      { name: 'tx_index', sort: 'DESC' },
      { name: 'event_index', sort: 'DESC' },
    ],
    {
      name: 'pox5_events_stake_state_by_staker_idx',
      where: "name IN ('stake', 'stake-update', 'unstake')",
    }
  );
}

export function down(pgm: MigrationBuilder): void {
  pgm.dropIndex('pox5_events', [], { name: 'pox5_events_stake_state_by_staker_idx' });
}
